if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Checkbox",
                key: "bypassSkipTypeFilter",
                default: false
            },
            { type: "Label", key: "skipTypes" },
            {
                type: "Checkbox",
                key: "1Minute",
                default: true
            },
            {
                type: "Checkbox",
                key: "5Minute",
                default: true
            },
            {
                type: "Checkbox",
                key: "10Minute",
                default: true
            },
            {
                type: "Checkbox",
                key: "30Minute",
                default: true
            },
            {
                type: "Checkbox",
                key: "1Hour",
                default: true
            },
            {
                type: "Checkbox",
                key: "5Hour",
                default: true
            },
            {
                type: "Checkbox",
                key: "24Hour",
                default: true
            },
        ],
        force: true
    }

const { botConfig } = require("../ggeBot")
const { resources } = require('../protocols')

const MinuteSkipType = Object.freeze({
    MS1: 1,
    MS2: 5,
    MS3: 10,
    MS4: 30,
    MS5: 60,
    MS6: 60 * 5,
    MS7: 60 * 24
})

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

// Skip type -> [checkbox key, resources key]
const skipSources = Object.freeze({
    MS1: ["1Minute", "1MinSkip"],
    MS2: ["5Minute", "5MinSkip"],
    MS3: ["10Minute", "10MinSkip"],
    MS4: ["30Minute", "30MinSkip"],
    MS5: ["1Hour", "60MinSkip"],
    MS6: ["5Hour", "5HourSkip"],
    MS7: ["24Hour", "24HourSkip"]
})

// Counts of every ticked skip type; unticked or unknown (NaN) counts as 0
const getSkipCounts = () => Object.fromEntries(Object.entries(skipSources)
    .map(([skip, [option, resource]]) =>
        [skip, pluginOptions[option] && resources[resource] > 0 ? resources[resource] : 0]))

/**
 * Picks the next skip for `minutes` remaining, aiming for few requests and little waste:
 * 1. one skip that finishes it, wasting at most max(2 min, 10%) -> use the smallest such
 * 2. otherwise the largest skip that doesn't overshoot (no waste), then repeat
 * 3. if every available skip overshoots, the smallest one, but only up to 4x the
 *    remaining time unless bypassSkipTypeFilter is set
 */
function pickSkip(counts, minutes) {
    const available = Object.keys(counts)
        .filter(skip => counts[skip] > 0)
        .sort((a, b) => MinuteSkipType[a] - MinuteSkipType[b])
    const tolerance = Math.max(2, minutes * 0.1)

    const finisher = available.find(skip =>
        MinuteSkipType[skip] >= minutes && MinuteSkipType[skip] - minutes <= tolerance)
    if (finisher)
        return finisher

    const fitting = available.filter(skip => MinuteSkipType[skip] <= minutes).at(-1)
    if (fitting)
        return fitting

    return available.find(skip =>
        pluginOptions.bypassSkipTypeFilter || MinuteSkipType[skip] <= minutes * 4)
}

function haveEnoughSkips(time) {
    const counts = getSkipCounts()
    let minutes = Math.ceil(time / 60)

    while (minutes > 0) {
        const skip = pickSkip(counts, minutes)
        if (skip == undefined)
            return false

        counts[skip]--
        minutes -= MinuteSkipType[skip]
    }
    return true
}

function spendSkip(time) {
    const minutes = Math.ceil(time / 60)
    const skip = minutes > 0 ? pickSkip(getSkipCounts(), minutes) : undefined
    if (skip == undefined) {
        console.warn("noMoreSkips")
        return undefined
    }

    // The server's count update may lag behind, so don't offer a type we've just used up
    resources[skipSources[skip][1]]--

    console.debug("usingSkip", skip)

    return skip
}

module.exports = { spendSkip, haveEnoughSkips, MinuteSkipType }