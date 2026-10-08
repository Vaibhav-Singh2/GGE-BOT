if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Text",
                key: "batchAmount",
                default: "100"
            },
            {
                type: "Text",
                key: "intervalSeconds",
                default: "600"
            },
            {
                type: "Label",
                key: "Great Empire Castles"
            },
            {
                type: "Text",
                key: "mainTroopIDs",
                default: ""
            },
            {
                type: "Text",
                key: "outpost1TroopIDs",
                default: ""
            },
            {
                type: "Text",
                key: "outpost2TroopIDs",
                default: ""
            },
            {
                type: "Text",
                key: "outpost3TroopIDs",
                default: ""
            },
            {
                type: "Label",
                key: "Kingdom Castles"
            },
            {
                type: "Text",
                key: "iceTroopIDs",
                default: ""
            },
            {
                type: "Text",
                key: "desertTroopIDs",
                default: ""
            },
            {
                type: "Text",
                key: "fireTroopIDs",
                default: ""
            },
            {
                type: "Label",
                key: "Advanced Manual Entries"
            },
            {
                type: "Text",
                key: "castles",
                default: "" // Backward-compatible format: areaID:wodID:slotID:amount
            }
        ]
    }

const err = require("../err.json")
const units = require("../items/units.json")
const { ClientCommands, castles, KingdomID, AreaType } = require("../protocols.js")
const { events, botConfig } = require("../ggeBot.js")
const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

const unitName = wodID => units.find(u => u.wodID == wodID)?.type ?? wodID
const lordIDFor = wodID => units.find(u => u.wodID == wodID)?.toolCategory != undefined ? 1 : 0

const parseTroopIDs = raw => {
    return String(raw || "")
        .split(/[\s,]+/)
        .map(Number)
        .filter(n => Number.isInteger(n) && n > 0)
}

const findTargetCastle = (type) => {
    switch (type) {
        case "Main":
            return castles.find(c => c.kingdomID === KingdomID.greatEmpire && c.areaInfo?.type === AreaType.mainCastle)
        case "Outpost1": {
            const outposts = castles.filter(c => c.kingdomID === KingdomID.greatEmpire && c.areaInfo?.type === AreaType.outpost)
            return outposts[0]
        }
        case "Outpost2": {
            const outposts = castles.filter(c => c.kingdomID === KingdomID.greatEmpire && c.areaInfo?.type === AreaType.outpost)
            return outposts[1]
        }
        case "Outpost3": {
            const outposts = castles.filter(c => c.kingdomID === KingdomID.greatEmpire && c.areaInfo?.type === AreaType.outpost)
            return outposts[2]
        }
        case "Ice":
            return castles.find(c => c.kingdomID === KingdomID.everWinterGlacier && [AreaType.externalKingdom, AreaType.mainCastle].includes(c.areaInfo?.type))
        case "Desert":
            return castles.find(c => c.kingdomID === KingdomID.burningSands && [AreaType.externalKingdom, AreaType.mainCastle].includes(c.areaInfo?.type))
        case "Fire":
            return castles.find(c => c.kingdomID === KingdomID.firePeaks && [AreaType.externalKingdom, AreaType.mainCastle].includes(c.areaInfo?.type))
        default:
            return null
    }
}

const tryRecruit = async () => {
    const batchAmount = Math.max(1, Number(pluginOptions.batchAmount || 100))

    // 1. Process named castle mappings
    const namedTargets = [
        { name: "Main Castle", castle: findTargetCastle("Main"), troopIDs: parseTroopIDs(pluginOptions.mainTroopIDs) },
        { name: "Outpost 1", castle: findTargetCastle("Outpost1"), troopIDs: parseTroopIDs(pluginOptions.outpost1TroopIDs) },
        { name: "Outpost 2", castle: findTargetCastle("Outpost2"), troopIDs: parseTroopIDs(pluginOptions.outpost2TroopIDs) },
        { name: "Outpost 3", castle: findTargetCastle("Outpost3"), troopIDs: parseTroopIDs(pluginOptions.outpost3TroopIDs) },
        { name: "Everwinter Glacier", castle: findTargetCastle("Ice"), troopIDs: parseTroopIDs(pluginOptions.iceTroopIDs) },
        { name: "Burning Sands", castle: findTargetCastle("Desert"), troopIDs: parseTroopIDs(pluginOptions.desertTroopIDs) },
        { name: "Fire Peaks", castle: findTargetCastle("Fire"), troopIDs: parseTroopIDs(pluginOptions.fireTroopIDs) }
    ]

    for (const target of namedTargets) {
        if (!target.castle || target.troopIDs.length === 0) continue

        const primaryWodID = target.troopIDs[0]
        try {
            const result = await ClientCommands.recruitUnit(target.castle.id, primaryWodID, batchAmount, 0, lordIDFor(primaryWodID))
            if (result === 0) {
                console.log(`[RecruitBot] Queued ${batchAmount}x ${unitName(primaryWodID)} at ${target.name} (${target.castle.id})`)
            } else if (result == 73 || err[result] === "NO_FREE_CONSTRUCTION_SLOT") {
                // Slots currently busy recruiting, will retry next interval
            } else {
                console.warn(`[RecruitBot] Failed at ${target.name} (${target.castle.id}):`, err[result] ?? result)
            }
        } catch (e) {
            console.error(`[RecruitBot] Error at ${target.name}:`, e)
        }
    }

    // 2. Process legacy / manual raw entries (areaID:wodID:slotID:amount)
    if (pluginOptions.castles) {
        const rawEntries = String(pluginOptions.castles || "")
            .split(/[\n,]/)
            .map(e => e.trim())
            .filter(Boolean)
            .map(e => {
                const [areaID, wodID, slotID, amount] = e.split(":").map(Number)
                return { areaID, wodID, slotID: slotID || 0, amount: amount || batchAmount }
            })
            .filter(e => [e.areaID, e.wodID].every(Number.isFinite))

        for (const entry of rawEntries) {
            const castle = castles.find(c => c.id == entry.areaID)
            if (!castle) continue

            try {
                const result = await ClientCommands.recruitUnit(entry.areaID, entry.wodID, entry.amount, entry.slotID, lordIDFor(entry.wodID))
                if (result === 0) {
                    console.log(`[RecruitBot] Queued ${entry.amount}x ${unitName(entry.wodID)} at manual castle ${entry.areaID}`)
                } else {
                    console.warn(`[RecruitBot] Manual entry failed at ${entry.areaID}:`, err[result] ?? result)
                }
            } catch (e) {
                console.error(`[RecruitBot] Manual entry error:`, e)
            }
        }
    }
}

events.once("load", () => {
    const intervalSeconds = Math.max(30, Number(pluginOptions.intervalSeconds) || 600)
    setInterval(tryRecruit, intervalSeconds * 1000)
    setTimeout(tryRecruit, 8000)
})
