if (require('node:worker_threads').isMainThread) {
    module.exports = {
        pluginOptions: [
            {
                type: "Text",
                key: "keepWood",
                default: "0"
            },
            {
                type: "Text",
                key: "keepStone",
                default: "0"
            },
            {
                type: "Text",
                key: "threshold",
                default: "95"
            }
        ]
    }
    return
}

const path = require("node:path")
const { sendXT, waitForResult, events, botConfig } = require("../ggeBot.js")
const { KingdomID, AreaType, castles } = require("../protocols.js")

const pluginOptions = botConfig.plugins[path.basename(__filename).slice(0, -3)] ?? {}
const keepWood = Number(pluginOptions.keepWood ?? 0)
const keepStone = Number(pluginOptions.keepStone ?? 0)
const threshold = Number(pluginOptions.threshold ?? 95) / 100

async function donateToColossus(wood, stone, castleID) {
    if (wood <= 0 && stone <= 0) return 0

    await sendXT("cde", JSON.stringify({ DW: wood, DS: stone, SCID: castleID, SKID: KingdomID.greatEmpire }))
    const [, result] = await waitForResult("cde", 1000 * 10)
    return result
}

async function tryDonateToColossus() {
    const mainCastle = castles.find(e =>
        e.kingdomID == KingdomID.greatEmpire &&
        e.areaInfo?.type == AreaType.mainCastle
    )

    if (!mainCastle?.getProductionData) return

    const maxWood = mainCastle.getProductionData.maxAmountWood
    const maxStone = mainCastle.getProductionData.maxAmountStone

    const woodToDonate = mainCastle.wood >= maxWood * threshold
        ? Math.max(0, mainCastle.wood - keepWood)
        : 0
    const stoneToDonate = mainCastle.stone >= maxStone * threshold
        ? Math.max(0, mainCastle.stone - keepStone)
        : 0

    if (woodToDonate <= 0 && stoneToDonate <= 0) return

    if (woodToDonate > 0) mainCastle.wood -= woodToDonate
    if (stoneToDonate > 0) mainCastle.stone -= stoneToDonate

    const result = await donateToColossus(woodToDonate, stoneToDonate, mainCastle.id)

    if (result != 0) {
        if (woodToDonate > 0) mainCastle.wood += woodToDonate
        if (stoneToDonate > 0) mainCastle.stone += stoneToDonate
        console.warn("colossusDonateFailed", result)
        return
    }

    console.log("colossusDonateDone", woodToDonate, stoneToDonate)
}

events.once("load", () => {
    const mainCastle = castles.find(e =>
        e.kingdomID == KingdomID.greatEmpire &&
        e.areaInfo?.type == AreaType.mainCastle
    )

    if (!mainCastle) {
        console.warn("colossusNoMainCastle")
        return
    }

    mainCastle.on("resourceUpdate", tryDonateToColossus)
    setInterval(tryDonateToColossus, 1000 * 60 * 10)
    tryDonateToColossus()
})
