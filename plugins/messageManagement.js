if (require('node:worker_threads').isMainThread) {
    module.exports = {
        pluginOptions: [
            {
                type: "Checkbox",
                key: "deleteCombatReports",
                default: true
            },
            {
                type: "Checkbox",
                key: "deleteNpcReports",
                default: true
            },
            {
                type: "Checkbox",
                key: "deletePvpReports",
                default: false
            },
            {
                type: "Checkbox",
                key: "deleteResourceReports",
                default: true
            },
            {
                type: "Checkbox",
                key: "deleteSystemMessages",
                default: false
            },
            {
                type: "Number",
                key: "cleanupIntervalMinutes",
                default: 10
            }
        ]
    }
    return
}

const path = require("node:path")
const { xtHandler, sendXT, botConfig } = require("../ggeBot.js")

const pluginOptions = botConfig.plugins[path.basename(__filename).slice(0, -3)] ?? {}
const deleteCombatReports = Boolean(pluginOptions.deleteCombatReports ?? true)
const deleteNpcReports = Boolean(pluginOptions.deleteNpcReports ?? true)
const deletePvpReports = Boolean(pluginOptions.deletePvpReports ?? false)
const deleteResourceReports = Boolean(pluginOptions.deleteResourceReports ?? true)
const deleteSystemMessages = Boolean(pluginOptions.deleteSystemMessages ?? false)
const cleanupIntervalMinutes = Number(pluginOptions.cleanupIntervalMinutes ?? 10)

/**
 * Message types in Goodgame Empire (MSG array: [messageID, messageType, ...]):
 * 67: Resource delivery / carriage report
 * 1: Combat battle report (NPC or general victory/defeat)
 * 2: Spy/espionage report
 * 3: Alliance news/log message
 * 4: System / server announcement
 * 5: PvP combat report
 */
function shouldDeleteMessageType(messageType) {
    if (messageType === 67 && deleteResourceReports) return true
    if (messageType === 1 && (deleteCombatReports || deleteNpcReports)) return true
    if (messageType === 5 && deletePvpReports) return true
    if (messageType === 2 && deleteCombatReports) return true
    if (messageType === 4 && deleteSystemMessages) return true
    return false
}

// Real-time notification handler (sne = Server Notification Event)
xtHandler.on("sne", obj => {
    if (!obj || !Array.isArray(obj.MSG)) return

    for (const item of obj.MSG) {
        if (!Array.isArray(item)) continue
        const [messageID, messageType] = item
        if (shouldDeleteMessageType(Number(messageType))) {
            sendXT("dms", JSON.stringify({ MID: Number(messageID) })).catch(() => {})
        }
    }
})

// Periodic bulk cleaner (requests message header list if supported)
if (cleanupIntervalMinutes > 0) {
    setInterval(() => {
        // Ping mailbox summary
        sendXT("gml", JSON.stringify({ T: 0 })).catch(() => {})
    }, cleanupIntervalMinutes * 60 * 1000).unref()
}

console.log("[MessageManagement] Active - monitoring and clearing selected mailbox/battle reports.")
