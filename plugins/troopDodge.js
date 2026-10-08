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
const commanderWhitelist = pluginOptions.commanderWhitelist ?? "33-35"


async function sendSupportToOutpost(mainCastle, outpost) {
    const units = mainCastle.unitInventory
        .filter(u => u.amount > 0)
        .map(u => [u.unitInfo.wodID, u.amount])

    if (units.length == 0) {
        console.warn("dodgeNoTroops")
        return null
    }

    const commander = await waitForCommanderAvailable(commanderWhitelist)

    await sendXT("cat", JSON.stringify({
        SX: mainCastle.areaInfo.x,
        SY: mainCastle.areaInfo.y,
        TX: outpost.areaInfo.x,
        TY: outpost.areaInfo.y,
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

    if (result != 0) return null

    return Number(obj.A.M.MID)
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

    const outpost = castles.find(e =>
        e.kingdomID == KingdomID.greatEmpire &&
        e.areaInfo?.type == AreaType.outpost &&
        e.areaInfo.x == outpostX &&
        e.areaInfo.y == outpostY
    )
    if (!outpost) {
        console.warn("dodgeNoOutpost")
        return
    }

    const msUntilImpact = movement.totalTime - (movement.deltaTime - Date.now())
    const dodgeAt30 = Math.max(0, msUntilImpact - 30000)
    const dodgeAt10 = Math.max(dodgeAt30 + 500, msUntilImpact - 10000)

    console.log("dodgeIncomingDetected", movement.sourceOwner.name, Math.round(msUntilImpact / 1000))

    activeIncomings.add(movement.id)

    const movementIDs = []

    const retreatAll = async () => {
        console.log("dodgeRetreating")
        for (const mid of movementIDs) {
            const result = await retreatTroops(mid)
            if (result != 0)
                console.warn("dodgeRetreatFailed", result)
        }
        if (movementIDs.length > 0)
            console.log("dodgeRetreatDone")
        activeIncomings.delete(movement.id)
    }

    const t30 = setTimeout(async () => {
        console.log("dodgeSendingTroops")
        const mid = await sendSupportToOutpost(mainCastle, outpost)
        if (mid != null) movementIDs.push(mid)
    }, dodgeAt30)

    const t10 = setTimeout(async () => {
        const hasTroops = mainCastle.unitInventory?.some(u => u.amount > 0)
        if (hasTroops) {
            console.log("dodgeSendingReturnedTroops")
            const mid = await sendSupportToOutpost(mainCastle, outpost)
            if (mid != null) movementIDs.push(mid)
        }

        const retreatTimer = setTimeout(retreatAll, 10000 + 1000)
        retreatTimer.unref()
    }, dodgeAt10)

    t30.unref()
    t10.unref()
}

events.once("load", () => {
    if (!outpostX || !outpostY) {
        console.warn("dodgeMissingOutpost")
        return
    }

    movementEvents.on("outgoing", movement => {
        if (movement.targetOwner.ownerID != playerInfo.playerID) return
        if (movement.targetAttack.type != AreaType.mainCastle) return
        if (movement.owner.ownerID == playerInfo.playerID) return

        if (![0, 25, 31, 24, 29].includes(movement.type)) {
            console.warn("dodgeUnhandledMovementType", movement.type, movement.sourceOwner.name)
            return
        }

        handleIncoming(movement)
    })

    console.log("dodgeReady")
})
