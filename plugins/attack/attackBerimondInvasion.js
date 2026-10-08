if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Checkbox",
                key: "eventWallToolsFirst"
            },
            {
                type: "Checkbox",
                key: "skipWallGateTools",
                default: false
            },
            {
                type: "Checkbox",
                key: "lowValueChests",
                default: false
            },
            {
                type: "Checkbox",
                key: "noChests",
                default: false
            },
            {
                type: "Checkbox",
                key: "useFeather",
                default: false
            },
            {
                type: "Checkbox",
                key: "useCoin",
                default: false
            },
            {
                type: "Text",
                key: "commanderWhiteList",
                default: "1-99"
            },
            {
                type: "Text",
                key: "commanderTroopConfig",
                default: ""
            },
            {
                type: "Checkbox",
                key: "reputation",
                default: false
            },
            { type: "Label", key: "attackSettings" },
            {
                type: "Text",
                key: "targetCoordinates",
                default: ""
            },
            {
                type: "Checkbox",
                key: "attackLeft",
                default: false
            },
            {
                type: "Checkbox",
                key: "attackMiddle",
                default: false
            },
            {
                type: "Checkbox",
                key: "attackRight",
                default: false
            }
        ]

    }
const { movementEvents, ClassTypes, castles, ClientCommands, AreaType, KingdomID } = require("../../protocols.js")
const { waitToAttack, getAttackInfo, assignUnit, getTotalAmountToolsFlank, getTotalAmountToolsFront, getAmountSoldiersFlank, getAmountSoldiersFront, getMaxUnitsInReinforcementWave } = require("./attack.js")
const { waitForCommanderAvailable, freeCommander, useCommander } = require('../commander.js')
const { sendXT, waitForResult, xtHandler, events, playerInfo, botConfig } = require('../../ggeBot.js')


const pretty = require('pretty-time')

const err = require('../../err.json')

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

const kingdomID = KingdomID.greatEmpire
const type = AreaType.beriCamp
const minTroopCount = 100
const eventID = 85

let quit = false

events.on("eventStop", eventInfo => {
    if (eventInfo.EID != eventID)
        return

    if (quit)
        return

    console.log("shuttingDownEvent", "eventEnded")
    quit = true
})
events.on("eventStart", async eventInfo => {
    if (eventInfo.EID != eventID)
        return

    quit = false

    const castle = castles.find(e => e.kingdomID == kingdomID && e.areaInfo.type == AreaType.mainCastle)

    // Optional "x:y,x:y,..." list restricting attacks to specific camps instead
    // of every beriCamp found around the main castle.
    const targetCoords = String(pluginOptions.targetCoordinates || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => {
            const [x, y] = s.split(":").map(Number)
            return { x, y }
        })
        .filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))

    // Widen the scan box to cover the requested coordinates (falls back to the
    // castle-centered box when none are given), so targets outside the default
    // +/-50 radius still get found.
    const boxPoints = targetCoords.length > 0 ? targetCoords : [{ x: castle.areaInfo.x, y: castle.areaInfo.y }]
    const boxPad = targetCoords.length > 0 ? 5 : 50
    const x1 = Math.min(castle.areaInfo.x, ...boxPoints.map(p => p.x)) - boxPad
    const y1 = Math.min(castle.areaInfo.y, ...boxPoints.map(p => p.y)) - boxPad
    const x2 = Math.max(castle.areaInfo.x, ...boxPoints.map(p => p.x)) + boxPad
    const y2 = Math.max(castle.areaInfo.y, ...boxPoints.map(p => p.y)) + boxPad

    const foundAreas = (await ClientCommands.getAreaInfo(kingdomID, x1, y1, x2, y2))
        .areaInfo.filter(ai => ai.type == type)

    const areas = targetCoords.length > 0
        ? targetCoords.map(({ x, y }) => foundAreas.find(ai => ai.x == x && ai.y == y)).filter(Boolean)
        : foundAreas

    if (targetCoords.length > 0 && areas.length == 0) {
        console.warn("noBerimondCampsFoundAtGivenCoordinates", JSON.stringify(targetCoords))
        quit = true
        return
    }
    if (targetCoords.length > 0 && areas.length < targetCoords.length) {
        console.warn("someBerimondCoordinatesNotCamps",
            JSON.stringify(targetCoords.filter(({ x, y }) => !areas.some(a => a.x == x && a.y == y))))
    }

    while (!quit) {
        const commander = await waitForCommanderAvailable(pluginOptions.commanderWhiteList)
        try {
            const attackInfo = await waitToAttack(async () => {
                const areaInfo = areas.shift()

                areas.push(areaInfo)

                const level = areaInfo.extraData[1] + areaInfo.extraData[6] == 100 ? 70 : 56

                const attackerMeleeTroops = []
                const attackerRangeTroops = []
                const attackerBerimondTools = []
                const attackerWallBerimondTools = []
                const attackerGateBerimondTools = []
                const attackerShieldBerimondTools = []
                const attackerWallTools = []
                const attackerShieldTools = []

                for (let i = 0; i < castle.unitInventory.length; i++) {
                    const unit = castle.unitInventory[i]


                    if (unit.unitInfo.wodID == 277)
                        continue

                    else if (unit.unitInfo.pointBonus) {
                        if (unit.unitInfo.gateBonus)
                            attackerGateBerimondTools.push(unit)
                        else if (unit.unitInfo.wallBonus)
                            attackerWallBerimondTools.push(unit)
                        else if (unit.unitInfo.defRangeBonus)
                            attackerShieldBerimondTools.push(unit)
                        else if (!pluginOptions.reputation)
                            attackerBerimondTools.push(unit)
                    }
                    else if (unit.unitInfo.reputationBonus && pluginOptions.reputation) {
                        attackerBerimondTools.push(unit)
                    }
                    else if (
                        unit.unitInfo.toolCategory &&
                        unit.unitInfo.usageEventID == undefined &&
                        unit.unitInfo.allowedToAttack == undefined &&
                        unit.unitInfo.typ == 'Attack' &&
                        unit.unitInfo.amountPerWave == undefined
                    ) {
                        if (unit.unitInfo.wallBonus)
                            attackerWallTools.push(unit)
                        else if (unit.unitInfo.defRangeBonus)
                            attackerShieldTools.push(unit)
                    }
                    else if (unit.unitInfo.fightType == 0) {
                        if (unit.unitInfo.role == "melee")
                            attackerMeleeTroops.push(unit)
                        else if (unit.unitInfo.role == "ranged")
                            attackerRangeTroops.push(unit)
                    }
                }

                let allTroopCount = 0

                attackerRangeTroops.forEach(e => allTroopCount += e.amount)
                attackerMeleeTroops.forEach(e => allTroopCount += e.amount)

                if (allTroopCount < minTroopCount)
                    throw "NO_MORE_TROOPS"
                if (pluginOptions.reputation) {
                    attackerBerimondTools.sort((a, b) =>
                        Number(b.unitInfo.reputationBonus) - Number(a.unitInfo.reputationBonus))
                }
                else {
                    attackerBerimondTools.sort((a, b) =>
                        Number(b.unitInfo.pointBonus) - Number(a.unitInfo.pointBonus))
                }
                attackerGateBerimondTools.sort((a, b) =>
                    Number(b.unitInfo.pointBonus) - Number(a.unitInfo.pointBonus))
                attackerWallBerimondTools.sort((a, b) =>
                    Number(b.unitInfo.pointBonus) - Number(a.unitInfo.pointBonus))
                attackerShieldBerimondTools.sort((a, b) =>
                    Number(b.unitInfo.pointBonus) - Number(a.unitInfo.pointBonus))

                if (pluginOptions.lowValueChests) {
                    attackerBerimondTools.reverse()
                    attackerGateBerimondTools.reverse()
                    attackerWallBerimondTools.reverse()
                    attackerShieldBerimondTools.reverse()
                }

                attackerWallTools.sort((a, b) =>
                    Number(a.unitInfo.wallBonus) - Number(b.unitInfo.wallBonus))

                attackerShieldTools.sort((a, b) =>
                    Number(a.unitInfo.defRangeBonus) - Number(b.unitInfo.defRangeBonus))

                attackerWallBerimondTools.push(...attackerWallTools)
                attackerShieldBerimondTools.push(...attackerShieldTools)

                const commanderStats = commander.getEffects()
                const commSlot = commander.lordPosition + 1
                const configEntry = String(pluginOptions.commanderTroopConfig || "").split(",").map(e => e.trim()).find(e => e.startsWith(commSlot + ":"))
                const [, configFront, configCy] = configEntry?.split(":").map(Number) ?? []
                const attackInfo = getAttackInfo(kingdomID, castle, areaInfo, commander, level, undefined, pluginOptions, commanderStats.additionalWaves)

                const maxToolsFlank = getTotalAmountToolsFlank(level, 0)
                const maxToolsFront = getTotalAmountToolsFront(level)
                const maxTroopFront = configFront || getAmountSoldiersFront(level, commanderStats.attackUnitAmountFront)
                const maxTroopFlank = getAmountSoldiersFlank(level, commanderStats.attackUnitAmountFlank)
                const desiredToolCount = attackerBerimondTools.length == 0 ? 20 : 10
                const shieldCap = () =>
                    (attackerShieldBerimondTools[0]?.unitInfo?.pointBonus || attackerShieldBerimondTools[0]?.unitInfo?.reputationBonus) ? 3 : 10
                const autoConfigure = !(pluginOptions.attackLeft || pluginOptions.attackRight || pluginOptions.attackMiddle)

                attackInfo.A.forEach((wave, index) => {
                    let maxTools = maxToolsFlank
                    if (index == 0) {
                        if (autoConfigure || pluginOptions.attackLeft) {
                            maxTools = maxToolsFlank
                            wave.L.T.forEach((unitSlot, i) => {
                                if (pluginOptions.skipWallGateTools && i == 0) return
                                maxTools -= assignUnit(unitSlot, i == 0 ?
                                    attackerWallBerimondTools : attackerShieldBerimondTools,
                                    i == 0 ? Math.min(maxTools, desiredToolCount) : Math.min(maxTools, shieldCap()))
                            })
                        }

                        if (autoConfigure || pluginOptions.attackRight) {
                            maxTools = maxToolsFlank
                            wave.R.T.forEach((unitSlot, i) => {
                                if (pluginOptions.skipWallGateTools && i == 0) return
                                maxTools -= assignUnit(unitSlot, i == 0 ?
                                    attackerWallBerimondTools : attackerShieldBerimondTools,
                                    i == 0 ? Math.min(maxTools, desiredToolCount) : Math.min(maxTools, shieldCap()))
                            })
                        }

                        if (autoConfigure || pluginOptions.attackMiddle) {
                            maxTools = maxToolsFront
                            wave.M.T.forEach((unitSlot, i) => {
                                if (pluginOptions.skipWallGateTools && i <= 1) return
                                maxTools -= assignUnit(unitSlot, i == 0 ? attackerWallBerimondTools :
                                    i == 1 ? attackerGateBerimondTools : attackerShieldBerimondTools,
                                    i == 2 ? Math.min(maxTools, shieldCap()) : Math.min(maxTools, desiredToolCount))
                            })
                        }

                        let maxTroops = maxTroopFlank

                        if (autoConfigure || pluginOptions.attackLeft) {
                            maxTroops = maxTroopFlank
                            wave.L.U.forEach(unitSlot =>
                                maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                    attackerMeleeTroops : attackerRangeTroops, maxTroops))
                        }
                        if (autoConfigure || pluginOptions.attackRight) {
                            maxTroops = maxTroopFlank
                            wave.R.U.forEach(unitSlot =>
                                maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                    attackerMeleeTroops : attackerRangeTroops, maxTroops))
                        }
                        if (autoConfigure || pluginOptions.attackMiddle) {
                            maxTroops = maxTroopFront
                            wave.M.U.forEach(unitSlot =>
                                maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                    attackerMeleeTroops : attackerRangeTroops, maxTroops))
                        }
                        attackerMeleeTroops.sort((a, b) => Number(a.unitInfo.meleeAttack) - Number(b.unitInfo.meleeAttack))
                        attackerRangeTroops.sort((a, b) => Number(a.unitInfo.rangeAttack) - Number(b.unitInfo.rangeAttack))
                        return
                    }
                    else if (!pluginOptions.noChests) {
                        const selectTool = i => {
                            if (pluginOptions.reputation) {
                                // Reputation mode: never fall back to the wall/gate/shield
                                // buckets, since those are always point-bonus tools by how
                                // they're categorized. Only the generic reputation-bonus
                                // bucket is eligible; otherwise leave the slot empty.
                                return attackerBerimondTools.length > 0 && attackerBerimondTools[0]?.unitInfo.reputationBonus
                                    ? attackerBerimondTools : []
                            }

                            let tools = pluginOptions.eventWallToolsFirst ? [] : attackerBerimondTools
                            if (tools.length == 0 || !tools[0]?.unitInfo.pointBonus) {
                                if (i == 0) {
                                    tools = attackerWallBerimondTools
                                    if (tools.length == 0 || !tools[0]?.unitInfo.pointBonus)
                                        tools = attackerShieldBerimondTools
                                }
                                else if (i == 1) {
                                    tools = attackerShieldBerimondTools
                                    if (tools.length == 0 || !tools[0]?.unitInfo.pointBonus)
                                        tools = attackerWallBerimondTools
                                }
                                if (i == 2) {
                                    tools = attackerGateBerimondTools
                                    if (tools.length == 0 || !tools[0]?.unitInfo.pointBonus)
                                        tools = attackerWallBerimondTools
                                    if (tools.length == 0 || !tools[0]?.unitInfo.pointBonus)
                                        tools = attackerShieldBerimondTools
                                }
                                if (!tools[0]?.unitInfo.pointBonus)
                                    tools = []
                            }

                            return tools
                        }

                        if (autoConfigure || pluginOptions.attackLeft) {
                            maxTools = maxToolsFlank
                            wave.L.T.forEach((unitSlot, i) =>
                                maxTools -= assignUnit(unitSlot, selectTool(0), maxTools))
                        }
                        if (autoConfigure || pluginOptions.attackRight) {
                            maxTools = maxToolsFlank
                            wave.R.T.forEach((unitSlot, i) =>
                                maxTools -= assignUnit(unitSlot, selectTool(1), maxTools))
                        }
                        if (autoConfigure || pluginOptions.attackMiddle) {
                            maxTools = maxToolsFront
                            wave.M.T.forEach((unitSlot, i) =>
                                maxTools -= assignUnit(unitSlot, selectTool(2), maxTools))
                        }
                    }

                    let maxTroops = maxTroopFlank

                    if (autoConfigure || pluginOptions.attackLeft) {
                        maxTroops = maxTroopFlank
                        wave.L.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                                attackerRangeTroops : attackerMeleeTroops, maxTroops))
                    }
                    if (autoConfigure || pluginOptions.attackRight) {
                        maxTroops = maxTroopFlank
                        wave.R.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                                attackerRangeTroops : attackerMeleeTroops, maxTroops))
                    }
                    if (autoConfigure || pluginOptions.attackMiddle) {
                        maxTroops = maxTroopFront
                        wave.M.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                attackerMeleeTroops : attackerRangeTroops, maxTroops))
                    }
                })
                let maxTroops = configCy || (getMaxUnitsInReinforcementWave(playerInfo.level, level) + Number(0 | commanderStats.attackUnitAmountReinforcementBonus))
                attackInfo.RW.forEach((unitSlot, i) => {
                    let attacker = i & 1 ?
                        (attackerMeleeTroops.length > 0 ? attackerMeleeTroops : attackerRangeTroops) :
                        (attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops)

                    maxTroops -= assignUnit(unitSlot, attacker,
                        Math.floor(maxTroops / 2) - 1)
                })

                await sendXT("cra", JSON.stringify(attackInfo))

                let [obj, result] = await waitForResult("cra", 1000 * 10, (obj, result) => {
                    if (result != 0)
                        return true

                    if (obj.AAM.M.KID != kingdomID || obj.AAM.M.TA[1] != areaInfo.x || obj.AAM.M.TA[2] != areaInfo.y)
                        return false
                    return true
                })
                if (result != 0)
                    throw err[result]
                return obj
            })
            if (!attackInfo) {
                freeCommander(commander.lordID)
                continue
            }



            console.info("hittingTargetAttack", 'C', attackInfo.AAM.UM.L.VIS + 1, ' ', attackInfo.AAM.M.TA[1], ':', attackInfo.AAM.M.TA[2], " ", pretty(Math.round(1000000000 * Math.abs(Math.max(0, attackInfo.AAM.M.TT - attackInfo.AAM.M.PT))), 's'), "tillImpactAttack")
        } catch (e) {
            freeCommander(commander.lordID)
            switch (e) {
                case "NO_MORE_TROOPS":
                    await new Promise(resolve => movementEvents.on("return", function self(/** @type {import("../../protocols.js").ClassTypes.Movement} */ movement) {
                        if (movement.kingdomID != kingdomID || movement.targetAttack.extraData[0] != castle.id)
                            return

                        movementEvents.off("return", self)
                        resolve()
                    }))
                    break
                case "LORD_IS_USED":
                    useCommander(commander.lordID)
                case "COOLING_DOWN":
                case "TIMED_OUT":
                case "MISSING_UNITS":
                case "CANT_START_NEW_ARMIES":
                    break
                default:
                    console.error(e)
                    quit = true
            }
        }
    }
})