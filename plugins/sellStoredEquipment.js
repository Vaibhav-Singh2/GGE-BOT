if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Checkbox",
                key: "sellCommon",
                default: true
            },
            {
                type: "Checkbox",
                key: "sellRare",
                default: true
            },
            {
                type: "Checkbox",
                key: "sellEpic",
                default: true
            },
            {
                type: "Checkbox",
                key: "sellLegendary",
                default: true
            },
            {
                type: "Checkbox",
                key: "excludeGemSocketed",
                default: true
            },
            {
                type: "Checkbox",
                key: "excludeTechnicusUpgrades",
                default: true
            },
            {
                type: "Checkbox",
                key: "sellCommonGems",
                default: true
            },
            {
                type: "Text",
                key: "intervalMinutes",
                default: "15"
            }
        ]
    }

const { events, xtHandler, sendXT, botConfig } = require('../ggeBot')
const gems = require("../items/gems.json")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

const sellGems = e => {
    let gemsSold = 0
    Array.from(e.GEM || []).forEach(([id, amount]) => {
        const gem = gems.find(g => g.gemID == id)
        if (!gem || gem.setID != undefined) return

        if (pluginOptions.sellCommonGems === false) return

        for (let i = 0; i < amount; i++) {
            sendXT("sge", JSON.stringify({ GID: gem.gemID, RGEM: 0, LFID: -1 }))
            gemsSold++
        }
    })
    if (gemsSold > 0) console.log(`[EquipmentManager] Sold ${gemsSold} gems`)
}

const equipmentType = {
    unique: 0,
    common: 1,
    rare: 2,
    epic: 3,
    legendary: 4,
    relic: 5,
    heroUnique: 10,
    heroCommon: 11,
    heroRare: 12,
    heroEpic: 13,
    heroLegendary: 14,
    heroRelic: 15
}

class Equipment {
    constructor(e) {
        this.id = e[0]
        this.slotType = e[1]
        this.lordType = e[2]
        this.rarity = e[3]
        this.name = e[4]
        this.objectID = e[6]
        this.setID = e[7]
        this.enchantmentLevel = e[8] || 0
        this.timeLeft = e[9] + Date.now()
        this.temporary = e[9] > 0
        this.gemID = e[10]
    }
}

const sellEquipment = e => {
    let equipmentSold = 0

    Array.from(e.I || []).map(item => new Equipment(item)).forEach(equipment => {
        // Never sell relics, hero relics, or unique items
        if ([equipmentType.relic, equipmentType.heroRelic, equipmentType.unique, equipmentType.heroUnique].includes(equipment.rarity))
            return

        // Never sell items that are part of a set
        if (equipment.setID != -1 && equipment.setID != undefined)
            return

        // Exclude items with gems socketed
        if (pluginOptions.excludeGemSocketed !== false && equipment.gemID != -1 && equipment.gemID != undefined && equipment.gemID != 0)
            return

        // Exclude items upgraded by Technicus
        if (pluginOptions.excludeTechnicusUpgrades !== false && equipment.enchantmentLevel > 0)
            return

        // Check rarity filters matching EmpireAutomation
        const isCommon = [equipmentType.common, equipmentType.heroCommon].includes(equipment.rarity)
        const isRare = [equipmentType.rare, equipmentType.heroRare].includes(equipment.rarity)
        const isEpic = [equipmentType.epic, equipmentType.heroEpic].includes(equipment.rarity)
        const isLegendary = [equipmentType.legendary, equipmentType.heroLegendary].includes(equipment.rarity)

        if (isCommon && pluginOptions.sellCommon === false) return
        if (isRare && pluginOptions.sellRare === false) return
        if (isEpic && pluginOptions.sellEpic === false) return
        if (isLegendary && pluginOptions.sellLegendary === false) return

        sendXT("seq", JSON.stringify({ EID: equipment.id, LID: -1, EX: 0, LFID: -1 }))
        equipmentSold++
    })

    if (equipmentSold > 0) console.log(`[EquipmentManager] Sold ${equipmentSold} items`)
}

events.on("load", () => {
    const triggerScan = () => {
        sendXT("ggm", JSON.stringify({}))
        xtHandler.once("ggm", sellGems)
        sendXT("gei", JSON.stringify({}))
        xtHandler.once("gei", sellEquipment)
    }

    triggerScan()
    const intervalMin = Math.max(5, Number(pluginOptions.intervalMinutes || 15))
    setInterval(triggerScan, intervalMin * 60 * 1000)
})