if (require('node:worker_threads').isMainThread) {
    module.exports = {
        pluginOptions: [
            {
                type: "Text",
                key: "foodSendIntervalMinutes",
                default: "60"
            },
            {
                type: "Text",
                key: "foodSendMinimumKept",
                default: "0"
            },
            {
                type: "Text",
                key: "foodSendMinimumKeptOtherCastles",
                default: "0"
            },
            {
                type: "Checkbox",
                key: "foodSendUseSkips",
                default: true
            },
        ]
    }
    return
}

const {
    ClientCommands,
    KingdomID,
    KingdomSkipType,
    AreaType,
    castles,
    unlockInfoList
} = require("../protocols.js")
const { events, botConfig } = require("../ggeBot.js")
const { spendSkip } = require("./skips.js")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

const parseNumber = (value, fallback, min) => {
    const n = Number(value)
    return Number.isFinite(n) && n >= min ? n : fallback
}

const intervalMinutes = parseNumber(pluginOptions.foodSendIntervalMinutes, 60, 1)
const minimumKept = parseNumber(pluginOptions.foodSendMinimumKept, 0, 0)
const minimumKeptOthers = parseNumber(pluginOptions.foodSendMinimumKeptOtherCastles, 0, 0)
const useSkips = pluginOptions.foodSendUseSkips ?? true
// A storm transfer already in flight (e.g. from meadReplaceStorm) blocks a new one, so retry sooner
const busyRetryMs = 1000 * 60 * 5
const kingdomID = KingdomID.stormIslands

const sleep = ms => new Promise(r => setTimeout(r, ms))
const randomIntFromInterval = (min, max) => Math.floor(Math.random() * (max - min + 1) + min)

// The kgt/msk replies carry a fresh kpi, so resourceTransfer is up to date after each call
async function skipFoodTransfer(stormCastle) {
    while (stormCastle.resourceTransfer?.remainingTime > 0) {
        const before = stormCastle.resourceTransfer
        const skip = spendSkip(before.remainingTime)
        if (skip == undefined)
            return

        // A real client can't fire skips back-to-back faster than the UI allows
        await sleep(randomIntFromInterval(1000, 3000))

        const result = await ClientCommands.skipResourceTransfer(skip, kingdomID, KingdomSkipType.sendResource)
        if (result != 0)
            return console.warn("foodSendStorm: skip failed with code ", String(result))

        // No fresh timer means we can't tell what the skip did; stop rather than spend more blindly
        if (stormCastle.resourceTransfer === before)
            return
    }
    if (!(stormCastle.resourceTransfer?.remainingTime > 0))
        console.log("foodSendStorm: transfer skipped, arrived")
}

async function trySendFood() {
    let nextRunMs = intervalMinutes * 60 * 1000
    try {
        const stormCastle = castles.find(e => e.kingdomID == kingdomID &&
            e.areaInfo.type == AreaType.externalKingdom)
        const mainCastle = castles.find(e => e.kingdomID == KingdomID.greatEmpire &&
            e.areaInfo.type == AreaType.mainCastle)

        if (!stormCastle || !mainCastle)
            return console.warn("foodSendStorm: couldn't find storm or main castle")

        if (stormCastle.resourceTransfer?.remainingTime > 0) {
            const inTransit = stormCastle.resourceTransfer

            if (useSkips) {
                console.log("foodSendStorm: skipping existing transfer, ", String(Math.ceil(inTransit.remainingTime / 60)), " min left")
                await skipFoodTransfer(stormCastle)
            }

            if (stormCastle.resourceTransfer?.remainingTime > 0) {
                console.log("foodSendStorm: transfer already in progress, ",
                    String(Math.ceil(stormCastle.resourceTransfer.remainingTime / 60)), " min left, retrying in 5 minutes")
                nextRunMs = busyRetryMs
                return
            }

            // It arrived through the skips, but storm's food figure won't include it until the next server update
            stormCastle.food = Math.min(stormCastle.food + (inTransit.resources?.food ?? 0),
                stormCastle.getProductionData.maxAmountFood)
        }

        const space = Math.floor(stormCastle.getProductionData.maxAmountFood - stormCastle.food)
        if (space <= 0)
            return console.log("foodSendStorm: storm food storage is full")

        // Main castle first; once it is at or below its minimum, use the other kingdom castle with the most spare food
        let source = mainCastle
        let spare = Math.floor(mainCastle.food - minimumKept)

        if (spare <= 0) {
            const fallback = castles
                .filter(e => e != mainCastle &&
                    ![KingdomID.stormIslands, KingdomID.berimond].includes(e.kingdomID) &&
                    [AreaType.mainCastle, AreaType.externalKingdom].includes(e.areaInfo.type))
                .map(e => [e, Math.floor(e.food - minimumKeptOthers)])
                .filter(([, spare]) => Number.isFinite(spare))
                .sort((a, b) => b[1] - a[1])[0]

            if (!fallback || fallback[1] <= 0)
                return console.log("foodSendStorm: no castle has spare food to send")

            ;[source, spare] = fallback
            console.log("foodSendStorm: main castle below minimum, using ", KingdomID[source.kingdomID])
        }

        const amount = Math.min(space, spare)
        if (!Number.isFinite(amount) || amount <= 0)
            return console.log("foodSendStorm: nothing to send")

        const result = await ClientCommands.kingdomUnitTransfer(
            source.id,
            source.kingdomID,
            kingdomID,
            [["F", amount]])

        if (result != 0) {
            console.warn("foodSendStorm: transfer failed with code ", String(result))
            nextRunMs = busyRetryMs
            return
        }

        source.food -= amount
        source.emit("resourceUpdate")
        console.log("foodSendStorm: sent ", String(amount), " food to storm from ", KingdomID[source.kingdomID])

        if (useSkips)
            await skipFoodTransfer(stormCastle)
    }
    catch (e) {
        console.warn(e)
    }
    finally {
        setTimeout(trySendFood, nextRunMs)
    }
}

events.once("load", () => {
    if (!unlockInfoList.find(e => e.kingdomID == kingdomID)?.isUnlocked)
        return console.warn("wontRunWithoutStormUnlocked")

    trySendFood()
})
