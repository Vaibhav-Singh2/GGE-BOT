if (require('node:worker_threads').isMainThread) {
    module.exports = {
        pluginOptions: [
            {
                type: "Number",
                key: "checkIntervalMinutes",
                default: 5
            },
            {
                type: "Checkbox",
                key: "healCoinTroops",
                default: true
            },
            {
                type: "Checkbox",
                key: "discardRubyTroops",
                default: true
            },
            {
                type: "Checkbox",
                key: "requestAllianceHelp",
                default: true
            }
        ]
    }
    return
}

const path = require("node:path")
const { sendXT, waitForResult, botConfig } = require("../ggeBot.js")
const { castles, KingdomID } = require("../protocols.js")

const pluginOptions = botConfig.plugins[path.basename(__filename).slice(0, -3)] ?? {}
const checkIntervalMinutes = Number(pluginOptions.checkIntervalMinutes ?? 5)
const healCoinTroops = Boolean(pluginOptions.healCoinTroops ?? true)
const discardRubyTroops = Boolean(pluginOptions.discardRubyTroops ?? true)
const requestAllianceHelp = Boolean(pluginOptions.requestAllianceHelp ?? true)

/**
 * Checks all owned castles for hospital inventory (castle.hospitalInventory).
 * Sends heal commands for coin troops or dismissal commands for unwanted units,
 * and requests alliance medical assistance if enabled.
 */
async function processHospitalForCastles() {
    for (const castle of castles) {
        if (!castle.hasHospital) continue

        const hospitalUnits = castle.hospitalInventory || []
        if (hospitalUnits.length === 0) continue

        console.log(`[HospitalHealer] Castle ${castle.id || 'main'} has ${hospitalUnits.length} unit types in hospital`)

        for (const unit of hospitalUnits) {
            if (!unit || unit.amount <= 0) continue

            // Determine if unit can be healed with coins vs rubies
            const wodID = unit.unitInfo?.wodID || unit.wodID
            const amount = unit.amount

            if (healCoinTroops) {
                try {
                    // Send hospital heal request (hhu / htr protocol)
                    await sendXT("hhu", JSON.stringify({
                        CID: castle.id ?? -1,
                        KID: castle.kingdomID ?? KingdomID.greatEmpire,
                        WID: wodID,
                        AMT: amount
                    }))
                    console.log(`[HospitalHealer] Sent heal request for ${amount}x unit ${wodID} in castle ${castle.id}`)
                } catch (e) {
                    console.warn(`[HospitalHealer] Failed to heal unit ${wodID}:`, e.message || e)
                }
            } else if (discardRubyTroops) {
                try {
                    // Dismiss from hospital
                    await sendXT("hdi", JSON.stringify({
                        CID: castle.id ?? -1,
                        KID: castle.kingdomID ?? KingdomID.greatEmpire,
                        WID: wodID,
                        AMT: amount
                    }))
                    console.log(`[HospitalHealer] Discarded ${amount}x unit ${wodID} from hospital`)
                } catch (e) {
                    console.warn(`[HospitalHealer] Failed to discard unit ${wodID}:`, e.message || e)
                }
            }
        }

        if (requestAllianceHelp) {
            try {
                // Request alliance hospital speedup help
                await sendXT("aha", JSON.stringify({ KID: castle.kingdomID ?? 0 }))
            } catch (e) {
                // Ignore alliance help cooldown errors
            }
        }
    }
}

// Initial delay then recurring interval
setTimeout(() => {
    processHospitalForCastles().catch(() => {})
    setInterval(() => {
        processHospitalForCastles().catch(() => {})
    }, Math.max(1, checkIntervalMinutes) * 60 * 1000).unref()
}, 15000).unref()

console.log("[HospitalHealer] Active - checking military hospitals every", checkIntervalMinutes, "minutes.")
