if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Text",
                key: "coinThreshold",
                default: "2000000000" // 2 Billion
            },
            {
                type: "Checkbox",
                key: "buyLadders",
                default: true // WOD 614
            },
            {
                type: "Checkbox",
                key: "buyMantlets",
                default: true // WOD 620
            },
            {
                type: "Checkbox",
                key: "buyRams",
                default: false // WOD 611
            },
            {
                type: "Text",
                key: "batchAmount",
                default: "100"
            },
            {
                type: "Text",
                key: "checkIntervalSeconds",
                default: "60"
            }
        ]
    }

const { ClientCommands, castles } = require("../protocols.js")
const { events, botConfig, playerInfo, status } = require("../ggeBot.js")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

const TOOL_WODS = {
    ladders: 614,
    mantlets: 620,
    rams: 611
}

let isSpending = false

const checkAndSpendCoins = async () => {
    if (isSpending) return

    const coinThreshold = Number(pluginOptions.coinThreshold || 2000000000)
    const currentCoins = Number(status.cash || playerInfo.coin || 0)

    if (currentCoins < coinThreshold) return

    // Pick target tools
    const toolsToBuy = []
    if (pluginOptions.buyLadders !== false) toolsToBuy.push(TOOL_WODS.ladders)
    if (pluginOptions.buyMantlets !== false) toolsToBuy.push(TOOL_WODS.mantlets)
    if (pluginOptions.buyRams) toolsToBuy.push(TOOL_WODS.rams)

    if (toolsToBuy.length === 0) return

    // Find a valid main castle or outpost with workshop
    const mainCastle = castles.find(c => c.hasSiegeWorkshop || c.kingdomID === 0) || castles[0]
    if (!mainCastle) return

    isSpending = true
    const batch = Number(pluginOptions.batchAmount || 100)

    try {
        console.log(`[CoinSpender] Coins (${currentCoins}) exceeded threshold (${coinThreshold}). Starting coin dump...`)

        for (const wodID of toolsToBuy) {
            // Purchase tool batch (Lord ID 1 for workshop tools)
            const result = await ClientCommands.recruitUnit(mainCastle.id, wodID, batch, 0, 1)
            if (result === 0) {
                console.log(`[CoinSpender] Successfully purchased ${batch}x tool WOD #${wodID} in castle ${mainCastle.id}`)
            } else {
                console.warn(`[CoinSpender] Tool purchase failed for WOD #${wodID}: error code ${result}`)
            }
        }
    } catch (e) {
        console.error("[CoinSpender] Error while executing coin purchase:", e)
    } finally {
        isSpending = false
    }
}

events.once("load", () => {
    const intervalSec = Math.max(15, Number(pluginOptions.checkIntervalSeconds || 60))
    setInterval(checkAndSpendCoins, intervalSec * 1000)
    // Run initial check
    setTimeout(checkAndSpendCoins, 5000)
})
