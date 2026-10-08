if (require('node:worker_threads').isMainThread) {
    module.exports = {
        pluginOptions: [
            {
                type: "Text",
                key: "outpostX",
                default: ""
            },
            {
                type: "Text",
                key: "outpostY",
                default: ""
            },
            {
                type: "Number",
                key: "attackThresholdMinutes",
                default: 20
            },
            {
                type: "Number",
                key: "pullBackDelayMinutes",
                default: 20
            },
            {
                type: "Number",
                key: "troopAttackThreshold",
                default: 300
            },
            {
                type: "Number",
                key: "minimumSendAmount",
                default: 100
            },
            {
                type: "Checkbox",
                key: "autoPullBackTroops",
                default: true
            },
            {
                type: "Checkbox",
                key: "autoSafeCastleFromAllianceList",
                default: true
            },
            {
                type: "Number",
                key: "openGateDurationHours",
                default: 6
            },
            {
                type: "Checkbox",
                key: "confirmRubySpendForOpenGate",
                default: true
            },
            {
                type: "Checkbox",
                key: "openGateWhenSendTroopsFails",
                default: true
            },
            {
                type: "Checkbox",
                key: "sendTroopsWhenOpenGateFails",
                default: true
            },
            {
                type: "Checkbox",
                key: "skipSendTroopsDuringPeaceProtection",
                default: true
            },
            {
                type: "Text",
                key: "commanderWhitelist",
                default: "33-35"
            }
        ]
    }
    return
}

const path = require("node:path")
const { sendXT, waitForResult, events, botConfig, playerInfo } = require("../ggeBot.js")
const { movementEvents, castles, KingdomID, AreaType } = require("../protocols.js")
const { waitForCommanderAvailable, freeCommander } = require("./commander.js")

const pluginOptions = botConfig.plugins[path.basename(__filename).slice(0, -3)] ?? {}
const outpostX = Number(pluginOptions.outpostX)
const outpostY = Number(pluginOptions.outpostY)
const attackThresholdMinutes = Number(pluginOptions.attackThresholdMinutes ?? 20)
const pullBackDelayMinutes = Number(pluginOptions.pullBackDelayMinutes ?? 20)
const troopAttackThreshold = Number(pluginOptions.troopAttackThreshold ?? 300)
const minimumSendAmount = Number(pluginOptions.minimumSendAmount ?? 100)
const autoPullBackTroops = Boolean(pluginOptions.autoPullBackTroops ?? true)
const autoSafeCastleFromAllianceList = Boolean(pluginOptions.autoSafeCastleFromAllianceList ?? true)
const openGateDurationHours = Number(pluginOptions.openGateDurationHours ?? 6)
const confirmRubySpendForOpenGate = Boolean(pluginOptions.confirmRubySpendForOpenGate ?? true)
const openGateWhenSendTroopsFails = Boolean(pluginOptions.openGateWhenSendTroopsFails ?? true)
const sendTroopsWhenOpenGateFails = Boolean(pluginOptions.sendTroopsWhenOpenGateFails ?? true)
const skipSendTroopsDuringPeaceProtection = Boolean(pluginOptions.skipSendTroopsDuringPeaceProtection ?? true)
const commanderWhitelist = pluginOptions.commanderWhitelist ?? "33-35"

/**
 * Attempts to find a safe destination castle:
 * 1. Configured outpost coords (outpostX, outpostY)
 * 2. Any other owned outpost / castle in Great Empire
 * 3. Fallback to alliance castle if enabled
 */
function findSafeDestination(sourceCastle) {
    if (outpostX && outpostY) {
        const configuredOutpost = castles.find(e =>
            e.kingdomID == KingdomID.greatEmpire &&
            e.areaInfo?.x == outpostX &&
            e.areaInfo?.y == outpostY
        )
        if (configuredOutpost) return configuredOutpost
        return { areaInfo: { x: outpostX, y: outpostY } }
    }

    const anyOutpost = castles.find(e =>
        e.kingdomID == KingdomID.greatEmpire &&
        e.areaInfo?.type == AreaType.outpost &&
        e.id != sourceCastle.id
    )
    if (anyOutpost) return anyOutpost

    if (autoSafeCastleFromAllianceList) {
        const allyCastle = castles.find(e =>
            e.kingdomID == KingdomID.greatEmpire &&
            e.id != sourceCastle.id
        )
        if (allyCastle) return allyCastle
    }

    return null
}

async function tryOpenGate(castle, durationHours = 6) {
    console.log(`[CastleDefense] Attempting OpenGate for ${durationHours}h on castle ${castle.id || 'main'}`)
    try {
        await sendXT("cgo", JSON.stringify({
            CID: castle.id ?? -1,
            KID: castle.kingdomID ?? KingdomID.greatEmpire,
            DUR: durationHours,
            CR: confirmRubySpendForOpenGate ? 1 : 0
        }))
        const [obj, result] = await waitForResult("cgo", 1000 * 5)
        if (result === 0) {
            console.log(`[CastleDefense] OpenGate successfully activated for ${durationHours}h`)
            return true
        }
        console.warn(`[CastleDefense] OpenGate returned status code ${result}`)
    } catch (e) {
        console.warn(`[CastleDefense] OpenGate command failed or timed out:`, e.message || e)
    }
    return false
}

async function sendSupportToSafeCastle(sourceCastle, destination) {
    const units = (sourceCastle.unitInventory || [])
        .filter(u => u.amount > 0)
        .map(u => [u.unitInfo.wodID, u.amount])

    const totalTroops = units.reduce((acc, [, amt]) => acc + amt, 0)
    if (totalTroops < minimumSendAmount) {
        console.log(`[CastleDefense] Troops below minimumSendAmount (${totalTroops} < ${minimumSendAmount}), dodging skipped`)
        return null
    }

    const commander = await waitForCommanderAvailable(commanderWhitelist)

    try {
        await sendXT("cat", JSON.stringify({
            SX: sourceCastle.areaInfo.x,
            SY: sourceCastle.areaInfo.y,
            TX: destination.areaInfo.x,
            TY: destination.areaInfo.y,
            KID: KingdomID.greatEmpire,
            LID: commander.lordID,
            WT: 0,
            HBW: -1,
            BPC: 0,
            PTT: 0,
            SD: 0,
            A: units
        }))

        const [obj, result] = await waitForResult("cat", 1000 * 10)
        freeCommander(commander.lordID)

        if (result != 0) {
            console.warn(`[CastleDefense] sendSupportToSafeCastle failed with result: ${result}`)
            return null
        }

        return Number(obj.A.M.MID)
    } catch (err) {
        freeCommander(commander.lordID)
        console.warn(`[CastleDefense] sendSupport error:`, err.message || err)
        return null
    }
}

async function retreatTroops(movementID) {
    await sendXT("mcm", JSON.stringify({ MID: movementID }))
    const [, result] = await waitForResult("mcm", 1000 * 10)
    return result
}

const activeIncomings = new Set()

async function handleIncoming(movement) {
    if (activeIncomings.has(movement.id)) return

    const mainCastle = castles.find(e =>
        e.kingdomID == KingdomID.greatEmpire &&
        e.areaInfo?.type == AreaType.mainCastle
    )
    if (!mainCastle) return

    if (skipSendTroopsDuringPeaceProtection && mainCastle.remainingPeaceTime > 0) {
        console.log(`[CastleDefense] Castle is under peace protection (${mainCastle.remainingPeaceTime}s remaining). Skipping dodge.`)
        return
    }

    const destination = findSafeDestination(mainCastle)

    const msUntilImpact = movement.totalTime - (movement.deltaTime - Date.now())
    const thresholdMs = attackThresholdMinutes * 60 * 1000

    if (msUntilImpact > thresholdMs) {
        console.log(`[CastleDefense] Incoming detected outside threshold window (${Math.round(msUntilImpact / 60000)}m > ${attackThresholdMinutes}m). Waiting...`)
    }

    const dodgeAt30 = Math.max(0, msUntilImpact - 30000)
    const dodgeAt10 = Math.max(dodgeAt30 + 500, msUntilImpact - 10000)

    console.log(`[CastleDefense] Incoming attack from ${movement.sourceOwner?.name || 'Unknown'}! Impact in ~${Math.round(msUntilImpact / 1000)}s`)
    activeIncomings.add(movement.id)

    const movementIDs = []

    const retreatAll = async () => {
        if (!autoPullBackTroops) {
            console.log(`[CastleDefense] autoPullBackTroops disabled; leaving troops at destination`)
            activeIncomings.delete(movement.id)
            return
        }

        console.log(`[CastleDefense] Pulling back troops after delay (${pullBackDelayMinutes}m delay elapsed)...`)
        for (const mid of movementIDs) {
            const result = await retreatTroops(mid)
            if (result != 0)
                console.warn("[CastleDefense] Troop retreat failed with code:", result)
        }
        if (movementIDs.length > 0)
            console.log("[CastleDefense] Troop pull-back completed")
        activeIncomings.delete(movement.id)
    }

    const t30 = setTimeout(async () => {
        let sentMid = null
        if (destination) {
            console.log("[CastleDefense] Dodging troops (t-30s) to safe castle...")
            sentMid = await sendSupportToSafeCastle(mainCastle, destination)
            if (sentMid != null) movementIDs.push(sentMid)
        }

        if (sentMid == null && openGateWhenSendTroopsFails) {
            console.log("[CastleDefense] Troop send failed or destination unavailable; triggering open gate fallback...")
            await tryOpenGate(mainCastle, openGateDurationHours)
        }
    }, dodgeAt30)

    const t10 = setTimeout(async () => {
        const hasTroops = mainCastle.unitInventory?.some(u => u.amount > 0)
        if (hasTroops && destination) {
            console.log("[CastleDefense] Secondary sweep (t-10s) sending remaining/returned troops...")
            const sentMid = await sendSupportToSafeCastle(mainCastle, destination)
            if (sentMid != null) movementIDs.push(sentMid)
        }

        // Schedule pull-back pullBackDelayMinutes after impact
        const pullBackWaitMs = Math.max(10000, pullBackDelayMinutes * 60 * 1000)
        console.log(`[CastleDefense] Attack impact arriving. Troops will be recalled in ${pullBackDelayMinutes} minutes.`)
        const retreatTimer = setTimeout(retreatAll, pullBackWaitMs)
        retreatTimer.unref()
    }, dodgeAt10)

    t30.unref()
    t10.unref()
}

events.once("load", () => {
    movementEvents.on("outgoing", movement => {
        if (movement.targetOwner?.ownerID != playerInfo.playerID) return
        if (movement.targetAttack?.type != AreaType.mainCastle) return
        if (movement.owner?.ownerID == playerInfo.playerID) return

        if (![0, 25, 31, 24, 29].includes(movement.type)) {
            console.warn("[CastleDefense] Unhandled movement type:", movement.type, movement.sourceOwner?.name)
            return
        }

        handleIncoming(movement)
    })

    console.log("[CastleDefense] CastleDefense & TroopDodge ready with automated pullback and gate fallback")
})
