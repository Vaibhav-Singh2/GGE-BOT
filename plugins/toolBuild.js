if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Text",
                key: "toolEntries",
                default: "" // format: areaID:wodID:amount:slotID
            },
            {
                type: "Text",
                key: "checkIntervalSeconds",
                default: "300"
            }
        ]
    }

const err = require("../err.json")
const units = require("../items/units.json")
const { ClientCommands, castles } = require("../protocols.js")
const { events, botConfig } = require("../ggeBot.js")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

// Format per entry: areaID:wodID:amount:slotID
// e.g. 1465864:614:100:0,1465864:620:100:1
const parseEntries = () => {
    return String(pluginOptions.toolEntries || "")
        .split(/[\n,]/)
        .map(e => e.trim())
        .filter(Boolean)
        .map(e => {
            const [areaID, wodID, amount, slotID] = e.split(":").map(Number)
            return { areaID, wodID, amount, slotID: slotID || 0, raw: e }
        })
        .filter(e => [e.areaID, e.wodID, e.amount].every(Number.isFinite))
}

const unitName = wodID => units.find(u => u.wodID == wodID)?.comment2 || wodID

const runToolBuild = async () => {
    const entries = parseEntries()
    if (entries.length === 0) return

    for (const entry of entries) {
        const castle = castles.find(c => c.id == entry.areaID)
        if (!castle) {
            console.warn("[ToolBuild] Castle not found:", entry.areaID)
            continue
        }

        try {
            // Workshop tools use lordID 1
            const result = await ClientCommands.recruitUnit(entry.areaID, entry.wodID, entry.amount, entry.slotID, 1)
            if (result === 0) {
                console.log(`[ToolBuild] Queued ${entry.amount}x ${unitName(entry.wodID)} at castle ${entry.areaID}`)
            } else {
                console.warn(`[ToolBuild] Failed at castle ${entry.areaID}: ${err[result] ?? result}`)
            }
        } catch (e) {
            console.error(`[ToolBuild] Error producing tool #${entry.wodID}:`, e)
        }
    }
}

events.once("load", () => {
    const intervalSec = Math.max(30, Number(pluginOptions.checkIntervalSeconds || 300))
    setInterval(runToolBuild, intervalSec * 1000)
    setTimeout(runToolBuild, 10000)
})
