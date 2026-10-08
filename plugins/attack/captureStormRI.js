if (require('node:worker_threads').isMainThread) {
    module.exports = {
        pluginOptions: [
            { type: "Label", key: "attackSettings" },
            { type: "Checkbox", key: "attackLeft", default: false },
            { type: "Checkbox", key: "attackRight", default: false },
            { type: "Checkbox", key: "attackMiddle", default: false },
            { type: "Checkbox", key: "useFeather", default: false },
            { type: "Checkbox", key: "useCoin", default: false },
            { type: "Text", key: "commanderTroopConfig", default: "" },
            { type: "Text", key: "commanderWhiteList", default: "1-99" }
        ]
    }
    return
}

const path = require("node:path")
const pretty = require('pretty-time')
const { ClientCommands, AreaType, KingdomID, movements, movementEvents, spiralCoordinates, castles, unlockInfoList, resources } = require("../../protocols.js")
const { waitToAttack } = require("./attack.js")
const { waitForCommanderAvailable, freeCommander, useCommander } = require("../commander.js")
const { sendXT, waitForResult, botConfig, events } = require("../../ggeBot.js")

const stables = require("../../items/horses.json")

const kingdomID = KingdomID.stormIslands
const type = AreaType.stormIsland
const woodStoneIsleIDs = [1, 2, 4, 5]
const minTroopCount = 1

const pluginOptions = botConfig.plugins[path.basename(__filename).slice(0, -3)] ?? {}

events.once("load", async () => {
    if (!unlockInfoList.find(e => e.kingdomID == kingdomID)?.isUnlocked)
        return console.warn("stormRINotUnlocked")

    const castle = castles.find(e => e.kingdomID == kingdomID && e.areaInfo.type == AreaType.externalKingdom)
    if (!castle)
        return console.warn("stormRINoStormCastle")

    const areas = []

    done:
    for (let i = 0, j = 0; i < 13 * 13; i++) {
        let rX, rY, rect
        do {
            ({ x: rX, y: rY } = spiralCoordinates(j++))
            rX *= 100
            rY *= 100
            rect = {
                x: castle.areaInfo.x + rX - 50,
                y: castle.areaInfo.y + rY - 50,
                w: castle.areaInfo.x + rX + 50,
                h: castle.areaInfo.y + rY + 50
            }
            if (j > Math.pow(13 * 13, 2))
                break done
        } while (
            (castle.areaInfo.x + rX) <= -50 || (castle.areaInfo.y + rY) <= -50 ||
            (castle.areaInfo.x + rX) >= 1336 || (castle.areaInfo.y + rY) >= 1336
        )
        rect.x = Math.max(0, Math.min(1286, rect.x))
        rect.y = Math.max(0, Math.min(1286, rect.y))
        rect.w = Math.max(0, Math.min(1286, rect.w))
        rect.h = Math.max(0, Math.min(1286, rect.h))

        areas.push(...(await ClientCommands.getAreaInfo(kingdomID, rect.x, rect.y, rect.w, rect.h))
            .areaInfo.filter(ai => ai.type == type && woodStoneIsleIDs.includes(ai.extraData[5])))
    }

    areas.sort((a, b) =>
        (Math.pow(castle.areaInfo.x - a.x, 2) + Math.pow(castle.areaInfo.y - a.y, 2)) -
        (Math.pow(castle.areaInfo.x - b.x, 2) + Math.pow(castle.areaInfo.y - b.y, 2))
    )

    console.info("stormRIFound", areas.length)

    const pendingAttacks = new Set()

    const lp = pluginOptions.attackRight ? 1 : pluginOptions.attackMiddle ? 2 : 0

    const buildHorse = (useCoin, useFeather) => {
        if (useCoin && !useFeather) {
            let minSpeed = Infinity, hbw = -1
            castle.unlockedHorses?.forEach(e => {
                const horse = stables.find(a => e == a.wodID)
                if (horse && Number(horse.costFactorC1) > 0 && Number(horse.costFactorC2) == 0) {
                    if (Number(horse.unitBoost) < minSpeed) { minSpeed = Number(horse.unitBoost); hbw = e }
                }
            })
            return { hbw, ptt: 0 }
        }
        if (useFeather) {
            const ptt = resources.pegasusTicket > 0 ? 1 : 0
            if (ptt == 0) console.warn("stormRINoFeathers")
            return { hbw: -1, ptt }
        }
        return { hbw: -1, ptt: 0 }
    }

    const buildCraPayload = (areaInfo, commander, units, hbw, ptt) => {
        const e = [-1, 0]
        const flankUnits = [...units.slice(0, 2)]
        while (flankUnits.length < 2) flankUnits.push(e)
        const midUnits = [...units.slice(0, 6)]
        while (midUnits.length < 6) midUnits.push(e)

        const L = { T: [e, e], U: lp == 0 ? flankUnits : [e, e] }
        const R = { T: [e, e], U: lp == 1 ? flankUnits : [e, e] }
        const M = { T: [e, e, e], U: lp == 2 ? midUnits : [e, e, e, e, e, e] }

        return {
            SX: castle.areaInfo.x, SY: castle.areaInfo.y,
            TX: areaInfo.x, TY: areaInfo.y,
            KID: kingdomID, LID: commander.lordID,
            WT: 0, HBW: hbw, BPC: 0,
            ATT: 7, AV: 1, LP: lp,
            FC: 0, PTT: ptt, SD: 0, ICA: 0, CD: 99,
            A: [{ L, R, M }],
            BKS: [], AST: [-1, -1, -1],
            RW: [e, e, e, e, e, e, e, e],
            ASCT: 0
        }
    }

    const sendHit = async () => {
        const commander = await waitForCommanderAvailable(pluginOptions.commanderWhiteList)
        let reservedRI = null
        try {
            const prepared = await waitToAttack(async () => {
                const areaIndex = areas.findIndex(ai =>
                    !(ai.extraData[1] > 0) &&
                    !pendingAttacks.has(`${ai.x}:${ai.y}`) &&
                    !movements.find(m =>
                        m.kingdomID == kingdomID &&
                        m.targetAttack.x == ai.x &&
                        m.targetAttack.y == ai.y
                    )
                )
                if (areaIndex == -1) return
                const [areaInfo] = areas.splice(areaIndex, 1)
                areas.push(areaInfo)

                const commSlot = commander.lordPosition + 1
                const configEntry = String(pluginOptions.commanderTroopConfig || "")
                    .split(",").map(e => e.trim())
                    .find(e => e.startsWith(commSlot + ":"))
                const [, maxTroops] = configEntry?.split(":").map(Number) ?? [, 0]

                let remaining = maxTroops || Infinity
                const units = []
                for (const unit of castle.unitInventory) {
                    if (remaining <= 0) break
                    if (unit.amount <= 0) continue
                    if (unit.unitInfo.fightType == 0 && !unit.unitInfo.beefSupply) {
                        const take = Math.min(unit.amount, remaining)
                        if (take <= 0) continue
                        units.push([unit.unitInfo.wodID, take])
                        unit.amount -= take
                        remaining -= take
                    }
                }

                if (units.reduce((s, u) => s + u[1], 0) < minTroopCount) throw "NO_MORE_TROOPS"

                pendingAttacks.add(`${areaInfo.x}:${areaInfo.y}`)
                return { areaInfo, units }
            })

            if (!prepared) {
                freeCommander(commander.lordID)
                await new Promise(resolve => {
                    const timer = setTimeout(resolve, 5 * 60 * 1000)
                    timer.unref()
                    movementEvents.on("return", function self(m) {
                        if (m.kingdomID != kingdomID) return
                        movementEvents.off("return", self)
                        clearTimeout(timer)
                        resolve()
                    })
                })
                return true
            }

            const { areaInfo, units } = prepared
            reservedRI = `${areaInfo.x}:${areaInfo.y}`

            await sendXT("aii", JSON.stringify({ KID: kingdomID, TX: areaInfo.x, TY: areaInfo.y }))
            await waitForResult("aii", 5000).catch(() => {})

            await sendXT("gas", JSON.stringify({}))
            await waitForResult("gas", 3000).catch(() => {})

            const { hbw, ptt } = buildHorse(pluginOptions.useCoin, pluginOptions.useFeather)
            const payload = buildCraPayload(areaInfo, commander, units, hbw, ptt)

            await sendXT("cra", JSON.stringify(payload))
            const [obj, craResult] = await waitForResult("cra", 1000 * 15)

            pendingAttacks.delete(reservedRI)
            reservedRI = null

            if (craResult != 0) {
                freeCommander(commander.lordID)
                console.warn("stormRIAttackFailed", craResult)
                return true
            }

            let travelMs = 60000
            try { travelMs = (obj.AAM.M.TT - obj.AAM.M.PT) * 1000 } catch (_) {}

            const isleType = [1, 4].includes(areaInfo.extraData[5]) ? "Wood" : "Stone"
            console.info("stormRIHitting", isleType, areaInfo.x, areaInfo.y,
                pretty(Math.round(travelMs * 1e6), 's'), "tillLanding")

            setTimeout(() => {
                freeCommander(commander.lordID)
            }, travelMs).unref()
            return true
        } catch (e) {
            if (reservedRI) pendingAttacks.delete(reservedRI)
            freeCommander(commander.lordID)
            switch (e) {
                case "NO_MORE_TROOPS":
                    console.log("stormRIWaitingTroops")
                    await new Promise(resolve => movementEvents.on("return", function self(movement) {
                        if (movement.kingdomID != kingdomID) return
                        movementEvents.off("return", self)
                        resolve()
                    }))
                    return true
                case "LORD_IS_USED":
                    useCommander(commander.lordID)
                    return true
                case "COOLING_DOWN":
                case "TIMED_OUT":
                case "MISSING_UNITS":
                case "CANT_START_NEW_ARMIES":
                    return true
                default:
                    console.warn("stormRIUnhandledError", e)
                    throw e
            }
        }
    }

    while (await sendHit());
})
