if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Text",
                key: "castles",
                default: ""
            },
            {
                type: "Text",
                key: "intervalSeconds",
                default: "600"
            }
        ]
    }

const err = require("../err.json")
const units = require("../items/units.json")
const { ClientCommands, castles } = require("../protocols.js")
const { events, botConfig } = require("../ggeBot.js")
const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

// Format per entry: areaID:wodID:slotID:amount  (comma or newline separated)
// e.g. 1465864:206:0:110,1486758:2026:2:90
const recruitEntries = String(pluginOptions.castles || "")
    .split(/[\n,]/)
    .map(e => e.trim())
    .filter(Boolean)
    .map(e => {
        const [areaID, wodID, slotID, amount] = e.split(":").map(Number)
        return { areaID, wodID, slotID, amount, raw: e }
    })
    .filter(e => {
        const valid = [e.areaID, e.wodID, e.slotID, e.amount].every(Number.isFinite)
        if (!valid)
            console.warn("recruitInvalidEntry", e.raw)
        return valid
    })

const unitName = wodID => units.find(u => u.wodID == wodID)?.type ?? wodID
// Barracks troops vs Workshop tools use a different LID (0 vs 1) in the "bup" packet;
// tools are the only units carrying a toolCategory field, so use that to tell them apart.
const lordIDFor = wodID => units.find(u => u.wodID == wodID)?.toolCategory != undefined ? 1 : 0

const tryRecruit = async () => {
    for (const entry of recruitEntries) {
        const castle = castles.find(c => c.id == entry.areaID)
        if (!castle) {
            console.warn("recruitCastleNotFound", entry.areaID)
            continue
        }

        try {
            const result = await ClientCommands.recruitUnit(entry.areaID, entry.wodID, entry.amount, entry.slotID, lordIDFor(entry.wodID))

            if (result == 0)
                console.log("recruited", entry.amount, unitName(entry.wodID), "at", entry.areaID)
            else
                console.warn("recruitFailed", entry.areaID, unitName(entry.wodID), err[result] ?? result)
        } catch (e) {
            console.warn("recruitError", entry.areaID, unitName(entry.wodID), e)
        }
    }
}

events.once("load", () => {
    if (recruitEntries.length == 0)
        return console.warn("recruitNoCastlesConfigured")

    const intervalSeconds = Number(pluginOptions.intervalSeconds) || 300
    setInterval(tryRecruit, intervalSeconds * 1000)
    tryRecruit()
})
