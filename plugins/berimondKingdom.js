
if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Text",
                key: "commanderWhitelist",
                default: ""
            },
            {
                type: "Text",
                key: "attackSolCount",
                default: "52"
            },
            {
                type: "Text",
                key: "troopIDs",
                default: ""
            },
            {
                type: "Checkbox",
                key: "leftFlank",
                default: false
            },
            {
                type: "Checkbox",
                key: "rightFlank",
                default: false
            },
            {
                type: "Text",
                key: "shieldCount",
                default: "0"
            },
            {
                type: "Checkbox",
                key: "useFeather",
                default: false
            },
            {
                type: "Checkbox",
                key: "useCoin",
                default: false
            },
            {
                type: "Checkbox",
                key: "berimondShields",
                default: true
            },
            {
                type: "Checkbox",
                key: "fillOtherFlanks",
                default: false
            },
            {
                type: "Checkbox",
                key: "autoResupplyCamp",
                default: true
            },
            {
                type: "Text",
                key: "minFreeSpaceToResupply",
                default: "100"
            },
            {
                type: "Text",
                key: "mainCastleReserve",
                default: "0"
            },
            {
                type: "Checkbox",
                key: "useSkipsForResupply",
                default: true
            }
        ]
    }

const path = require("node:path")
const { sendXT, waitForResult, events, botConfig, xtHandler } = require("../ggeBot.js")
const { ClientCommands, KingdomID, AreaType, KingdomSkipType, castles, setCastle, movementEvents } = require("../protocols.js")
const { waitForCommanderAvailable, freeCommander } = require("./commander.js")
const { getAttackInfo, assignUnit, waitToAttack, getLastAttackDispatchAt } = require("./attack/attack.js")
const { spendSkip } = require("./skips.js")
const err = require("../err.json")

const pluginOptions = botConfig.plugins[path.basename(__filename).slice(0, -3)] ?? {}
const commanderWhitelist = pluginOptions.commanderWhitelist ?? ""
// The attack builder only ever fills one flank, which holds at most 52 sols here
const maxFlankSols = 52
const attackSolCount = Math.min(maxFlankSols,
    Math.max(1, Math.floor(Number(pluginOptions.attackSolCount) || maxFlankSols)))
if (Number(pluginOptions.attackSolCount) > maxFlankSols)
    console.warn("attackSolCountCappedTo", maxFlankSols)
const useLeftFlank = pluginOptions.leftFlank ?? false
const shieldCount = Number(pluginOptions.shieldCount ?? 0)
const useBerimondShields = pluginOptions.berimondShields ?? true
const fillOtherFlanks = pluginOptions.fillOtherFlanks ?? false
const autoResupplyCamp = pluginOptions.autoResupplyCamp ?? true
const minFreeSpaceToResupply = Math.max(1, Math.floor(Number(pluginOptions.minFreeSpaceToResupply) || 100))
const mainCastleReserve = Math.max(0, Number(pluginOptions.mainCastleReserve ?? 0) || 0)
const useSkipsForResupply = pluginOptions.useSkipsForResupply ?? true

const getBeriCastle = () =>
    castles.find(e => e.kingdomID == KingdomID.berimond && e.areaInfo?.type == AreaType.beriCastle)

const getMainCastle = () =>
    castles.find(e => e.kingdomID == KingdomID.greatEmpire && e.areaInfo?.type == AreaType.mainCastle)

// isAuxiliary marks the camp-native "beri" ranged troop (AuxiliaryRange, wodID 14).
// foodSupply > 0 additionally excludes mead-fed troops (MeadRanger/MeadBow from
// Storm Islands), which consume meadSupply instead and have no foodSupply at all.
const isFoodRangedUnit = u =>
    u.unitInfo?.role == "ranged" &&
    Number(u.unitInfo?.foodSupply) > 0 &&
    !Number(u.unitInfo?.isAuxiliary)

// Troop types (wodIDs, comma separated, first = preferred) used for both camp
// resupply and attacks, e.g. "2069" for RelicShortBow. Empty keeps the old
// behaviour of any food-fed ranged troop.
const troopIDs = String(pluginOptions.troopIDs ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter(id => Number.isInteger(id) && id > 0)
{
    const knownUnits = require("../items/units.json")
    troopIDs.filter(id => !knownUnits.some(u => Number(u.wodID) == id))
        .forEach(id => console.warn("berimondUnknownTroopID", id))
}
const isSelectedTroop = troopIDs.length > 0
    ? u => troopIDs.includes(Number(u.unitInfo?.wodID))
    : isFoodRangedUnit
const troopPriority = u => troopIDs.indexOf(Number(u.unitInfo?.wodID))

const randomIntFromInterval = (min, max) =>
    Math.floor(Math.random() * (max - min + 1) + min)

// Jitters a duration by ±pct so repeated polling/backoff waits don't fire at
// perfectly regular intervals (easier to fingerprint as automated traffic).
const jitterMs = (ms, pct = 0.2) =>
    randomIntFromInterval(Math.round(ms * (1 - pct)), Math.round(ms * (1 + pct)))

const sleep = ms => new Promise(r => setTimeout(r, ms))

let resupplyInFlight = false

// The local troop-transfer/inventory cache can briefly still look "empty" right
// after a send completes, before the server's next state push lands - which
// otherwise looks identical to "no transfer in flight" and triggers a duplicate
// send. This enforces a minimum real-time gap between sends as a backstop.
let lastResupplySentAt = 0
const minResupplyIntervalMs = 1000 * 90

// Grace period after a transfer's expected arrival before trusting the camp
// inventory again, so a late inventory push can't trigger a duplicate send.
const arrivalGraceMs = 1000 * 60

// Free camp space comes from the server ("fuc", what the game sends when the
// Send troops dialog opens). It already counts sols out on attacks and follows
// camp upgrades. CID 120 is the value the game client sends for Berimond.
const freeSpaceRequestCID = 120
// Scheduled checks run every 5-10 min; the attack loop can ask for an earlier
// one when it runs dry, but never more often than this.
const minFreeSpaceCheckGapMs = 1000 * 60 * 2
let nextFreeSpaceCheckAt = 0
let lastFreeSpaceCheckAt = 0
let freeSpaceCheckRequested = false

async function getCampFreeSpace() {
    lastFreeSpaceCheckAt = Date.now()
    nextFreeSpaceCheckAt = lastFreeSpaceCheckAt + randomIntFromInterval(5, 10) * 1000 * 60

    await sendXT("fuc", JSON.stringify({ CID: freeSpaceRequestCID }))
    const [obj, result] = await waitForResult("fuc", 1000 * 10)
    if (result != 0)
        throw err[result] ?? result

    const freeSpace = Number(obj?.FUC)
    if (!Number.isFinite(freeSpace) || freeSpace < 0)
        throw "berimondFreeSpaceMissing"

    return freeSpace
}

// castle.troopTransfer.remainingTime (RS, seconds) is a snapshot from the last
// kpi push and never counts down locally. Stamp each snapshot the first time it
// is seen so the real remaining time can be derived from it.
const transferSeenAt = new WeakMap()
function getTransferRemainingMs(castle) {
    const transfer = castle.troopTransfer
    if (!(transfer?.remainingTime > 0))
        return 0

    if (!transferSeenAt.has(transfer))
        transferSeenAt.set(transfer, Date.now())

    return Math.max(0, transfer.remainingTime * 1000 - (Date.now() - transferSeenAt.get(transfer)))
}
let transferArrivesAt = 0
// Set whenever a transfer is known to be on its way; the camp is refreshed
// once it has landed.
let refreshAfterArrival = false

// Failed or pointless attempts back off exponentially (2, 4, 8 ... 30 min)
// instead of retrying the same doomed kut every poll.
let resupplyFailures = 0
let resupplyBackoffUntil = 0
function backOffResupply(reason, ...args) {
    resupplyFailures++
    const ms = Math.min(1000 * 60 * 30, 1000 * 60 * 2 * 2 ** (resupplyFailures - 1))
    resupplyBackoffUntil = Date.now() + jitterMs(ms)
    console.warn(reason, ...args, "retryInMinutes", Math.round(ms / 60000))
}

// Lets the attack loop request an immediate resupply check when it runs dry,
// instead of idling until the next scheduled poll.
let wakeResupply = () => { freeSpaceCheckRequested = true }
const waitForResupplyTick = ms => new Promise(resolve => {
    const timer = setTimeout(resolve, ms)
    wakeResupply = () => {
        freeSpaceCheckRequested = true
        clearTimeout(timer)
        resolve()
    }
})

// "cra" (attack) and "kut" (troop transfer) each spin up a new army/movement
// server-side, and the server enforces a minimum settling gap between any two
// such army-creation calls on the account. Violating it doesn't just reject the
// second call - it can force-close the connection with CANT_START_NEW_ARMIES.
// attackBerimond() and resupplyBerimondCamp() run on independent loops with no
// other coordination between them, so this shared gate makes sure neither one
// fires its army-creating call within the same settling window as the other.
let lastArmyStartAt = 0
async function gateArmyStart() {
    // Also checked against the shared attack queue's last dispatch (attack.js) -
    // that queue covers cra-vs-cra spacing across every attack plugin (Khan,
    // Barrons, etc.), but has no visibility into Berimond's own kut transfer, so
    // this is what keeps the resupply transfer from landing right on top of an
    // attack dispatched by a completely different plugin.
    const sinceMostRecent = Math.min(
        Date.now() - lastArmyStartAt,
        Date.now() - getLastAttackDispatchAt())

    const wait = randomIntFromInterval(1000 * 5, 1000 * 10) - sinceMostRecent
    if (wait > 0)
        await new Promise(r => setTimeout(r, wait))
    lastArmyStartAt = Date.now()
}

// The camp's unit inventory is only fully refreshed by a dcl reply. Asking for
// one after troops land (returns, transfers) and every 5-10 min keeps the local
// count honest. At most one per minute: a request inside that window is
// postponed to its end, and one already pending absorbs later requests.
const minCampRefreshGapMs = 1000 * 60
let lastCampRefreshAt = 0
let campRefreshPending = false
function refreshCampData(delayMs = 0) {
    if (campRefreshPending)
        return
    campRefreshPending = true
    const waitMs = Math.max(delayMs, lastCampRefreshAt + minCampRefreshGapMs - Date.now())
    setTimeout(() => {
        campRefreshPending = false
        lastCampRefreshAt = Date.now()
        sendXT("dcl", JSON.stringify({ CD: 1 })).catch(e => console.warn("berimondCampRefreshFailed", e))
    }, waitMs)
}

// The return trip's troop list doesn't reliably match what actually lands, so
// after a return the local count isn't trusted for attacking until the
// server's own numbers (dcl) have arrived.
let campCountConfirmed = true

// While the camp is short, the attack loop sleeps until troops arrive instead
// of polling. Waking only re-reads the local inventory; nothing is sent.
let wakeAttack = () => { }
const waitForCampChange = ms => new Promise(resolve => {
    const timer = setTimeout(resolve, ms)
    wakeAttack = () => {
        wakeAttack = () => { }
        clearTimeout(timer)
        resolve()
    }
})

// protocols.js adds the return trip's troops locally, but attacks wait for the
// server's numbers before using them (see campCountConfirmed).
movementEvents.on("return", movement => {
    if (movement?.kingdomID != KingdomID.berimond)
        return
    campCountConfirmed = false
    refreshCampData(randomIntFromInterval(1000 * 5, 1000 * 15))
})

// Fresh castle data (after a transfer lands, after returns, periodic refresh)
// may have brought the camp up to strength.
xtHandler.on("dcl", (_, result) => {
    if (result != 0)
        return
    campCountConfirmed = true
    wakeAttack()
})

// Everything in the cra payload left the camp with the attack. Take it off the
// local inventory straight away, otherwise the next attack is built on troops
// that are already gone (MISSING_UNITS).
function subtractSentUnits(castle, attackInfo) {
    const sent = new Map()
    const addSlot = slot => {
        const [wodID, amount] = slot ?? []
        if (wodID > 0 && amount > 0)
            sent.set(wodID, (sent.get(wodID) ?? 0) + amount)
    }
    attackInfo.A?.forEach(wave => [wave.L, wave.M, wave.R].forEach(side => {
        side?.U?.forEach(addSlot)
        side?.T?.forEach(addSlot)
    }))
    attackInfo.RW?.forEach(addSlot)

    sent.forEach((amount, wodID) => {
        const unit = castle.unitInventory?.find(u => Number(u.unitInfo?.wodID) == wodID)
        if (unit)
            unit.amount = Math.max(0, unit.amount - amount)
    })
}

async function skipTroopTransfer(beriCastle) {
    while (getTransferRemainingMs(beriCastle) > 0) {
        const before = beriCastle.troopTransfer
        const skip = spendSkip(getTransferRemainingMs(beriCastle) / 1000)
        if (skip == undefined)
            break

        // A real client can't fire skips back-to-back faster than the UI allows.
        await sleep(randomIntFromInterval(1000, 3000))

        if (await ClientCommands.skipResourceTransfer(skip, KingdomID.berimond, KingdomSkipType.sendTroops).catch(e => e) != 0)
            break

        // No fresh kpi push means we can't tell what the skip did; stop
        // rather than blindly spending more skips on a stale timer.
        if (beriCastle.troopTransfer === before)
            break
    }
}

async function resupplyBerimondCamp() {
    if (!autoResupplyCamp || resupplyInFlight)
        return

    const now = Date.now()
    if (now < resupplyBackoffUntil || now - lastResupplySentAt < minResupplyIntervalMs)
        return

    const beriCastle = getBeriCastle()
    if (!beriCastle)
        return

    // A shipment is already en route (e.g. left over from before a restart).
    // Skip it in if allowed; either way don't send another until it has landed
    // and the grace period below lets the camp inventory catch up.
    const inTransitMs = getTransferRemainingMs(beriCastle)
    if (inTransitMs > 0) {
        if (useSkipsForResupply) {
            resupplyInFlight = true
            try {
                console.log("berimondSkippingExistingTransfer", "minutesLeft", Math.ceil(inTransitMs / 60000))
                await skipTroopTransfer(beriCastle)
            } finally {
                resupplyInFlight = false
            }
        }
        transferArrivesAt = Date.now() + getTransferRemainingMs(beriCastle)
        nextFreeSpaceCheckAt = Math.min(nextFreeSpaceCheckAt, transferArrivesAt + arrivalGraceMs)
        refreshAfterArrival = true
        return
    }
    if (now < transferArrivesAt + arrivalGraceMs)
        return

    if (refreshAfterArrival) {
        refreshAfterArrival = false
        refreshCampData()
    }

    const checkDue = now >= nextFreeSpaceCheckAt ||
        (freeSpaceCheckRequested && now - lastFreeSpaceCheckAt >= minFreeSpaceCheckGapMs)
    if (!checkDue)
        return
    freeSpaceCheckRequested = false

    let freeSpace
    try {
        freeSpace = await getCampFreeSpace()
    } catch (e) {
        return console.warn("berimondFreeSpaceCheckFailed", e)
    }

    if (freeSpace < minFreeSpaceToResupply)
        return console.log("berimondCampFreeSpace", freeSpace, "belowMinimum", minFreeSpaceToResupply)

    const mainCastle = getMainCastle()
    if (!mainCastle)
        return backOffResupply("noMainCastleForBerimondResupply")

    // With troopIDs set: in the order listed. Otherwise highest ranged-attack
    // stockpiles first, so the weaker leftovers are what stays home as the
    // mainCastleReserve.
    const availableUnits = mainCastle.unitInventory
        ?.filter(u => u.amount > 0 && isSelectedTroop(u))
        .sort(troopIDs.length > 0
            ? (a, b) => troopPriority(a) - troopPriority(b)
            : (a, b) => Number(b.unitInfo.rangeAttack) - Number(a.unitInfo.rangeAttack))
        ?? []

    const totalAvailable = availableUnits.reduce((sum, u) => sum + u.amount, 0)
    const sendable = Math.min(freeSpace, totalAvailable - mainCastleReserve)

    // Less than one attack's worth isn't worth a transfer
    if (sendable < attackSolCount)
        return backOffResupply("notEnoughFoodRangedTroopsToResupplyBerimond",
            "freeSpace", freeSpace, "available", totalAvailable, "reserve", mainCastleReserve)

    let remaining = sendable
    const units = []
    for (const u of availableUnits) {
        if (remaining <= 0) break
        const amount = Math.min(u.amount, remaining)
        units.push([u.unitInfo.wodID, amount])
        remaining -= amount
    }

    resupplyInFlight = true
    try {
        await gateArmyStart()
        const result = await ClientCommands.kingdomTroopTransfer(mainCastle.id, KingdomID.greatEmpire, KingdomID.berimond, units)
            .catch(e => e)
        if (result != 0)
            return backOffResupply("berimondResupplyTransferFailed", err[result] ?? result)

        resupplyFailures = 0
        lastResupplySentAt = Date.now()
        transferArrivesAt = lastResupplySentAt + getTransferRemainingMs(beriCastle)
        nextFreeSpaceCheckAt = Math.min(nextFreeSpaceCheckAt, transferArrivesAt + arrivalGraceMs)
        refreshAfterArrival = true
        console.log("berimondResupplySent", sendable, "freeSpaceWas", freeSpace, JSON.stringify(units),
            "arrivesInSeconds", Math.round((transferArrivesAt - lastResupplySentAt) / 1000))

        if (!useSkipsForResupply)
            return

        await skipTroopTransfer(beriCastle)
        transferArrivesAt = Date.now() + getTransferRemainingMs(beriCastle)
        nextFreeSpaceCheckAt = Math.min(nextFreeSpaceCheckAt, transferArrivesAt + arrivalGraceMs)
    } finally {
        resupplyInFlight = false
    }
}

// Only log the "waiting" line when the count changes, not on every wake
let lastShortCount = -1

async function attackBerimond() {
    const beriCastle = getBeriCastle()
    // attackBerimond() runs in a bare while(true), so every early return must
    // wait, otherwise this path spins and spams requests at the global limiter rate.
    if (!beriCastle) {
        console.warn("noBeriCastle")
        await sleep(jitterMs(1000 * 60))
        return
    }

    // Troops just came back: wait for the server's count instead of attacking
    // on the local guess. Re-asks on the backstop wake in case a refresh was lost.
    if (!campCountConfirmed) {
        refreshCampData()
        await waitForCampChange(jitterMs(1000 * 60 * 5))
        return
    }

    // Only sols transferred in from our castles (troopIDs, or any food-fed
    // ranged troop); beri sols are left alone. With troopIDs set they're used in
    // the order listed, otherwise the deepest stockpile first.
    const rangedUnits = beriCastle.unitInventory
        ?.filter(u => u.amount > 0 && isSelectedTroop(u))
        .map(u => ({ ...u }))
        .sort(troopIDs.length > 0
            ? (a, b) => troopPriority(a) - troopPriority(b) || b.amount - a.amount
            : (a, b) => b.amount - a.amount)
        ?? []
    const totalRangedSols = rangedUnits.reduce((sum, u) => sum + u.amount, 0)

    // fillOtherFlanks also puts 1 sol each on the middle and the other flank
    const solsNeeded = attackSolCount + (fillOtherFlanks ? 2 : 0)

    // Not enough for a full attack: wait for troops to arrive (returns,
    // transfers, fresh castle data) instead of trickling in a weak one. The
    // timeout is only a backstop in case an arrival is missed.
    if (totalRangedSols < solsNeeded) {
        if (totalRangedSols != lastShortCount)
            console.warn("notEnoughBerimondSolsToAttack", totalRangedSols, "needed", solsNeeded, "waitingForTroops")
        lastShortCount = totalRangedSols
        wakeResupply()
        await waitForCampChange(jitterMs(1000 * 60 * 5))
        return
    }
    lastShortCount = -1

    const { areaInfo: towerInfo, result: findResult } =
        await ClientCommands.getNextMapObject(AreaType.watchTower, KingdomID.berimond)

    if (findResult != 0) {
        console.warn("noBerimondTowerFound")
        await sleep(jitterMs(1000 * 45))
        return
    }

    const lord = await waitForCommanderAvailable(commanderWhitelist)

    const shield = useBerimondShields
        ? beriCastle.unitInventory?.find(u => u.amount > 0 && u.unitInfo?.type == "BerimondAntiShields")
        : beriCastle.unitInventory?.find(u => u.amount > 0 && u.unitInfo?.type == "Shields")

    const attackInfo = getAttackInfo(KingdomID.berimond, beriCastle, towerInfo, lord, 70, 1, pluginOptions, 0)

    const wave = attackInfo.A[0]
    const flank = useLeftFlank ? wave.L : wave.R

    // Only 2 unit slots exist per flank, so fill from the deepest stockpiles
    // up to the configured attack size.
    let remainingSols = attackSolCount
    flank.U.forEach(unitSlot => remainingSols -= assignUnit(unitSlot, rangedUnits, remainingSols))

    if (shield && shieldCount > 0 && flank.T[1]) {
        flank.T[1][0] = shield.unitInfo.wodID
        flank.T[1][1] = Math.min(shieldCount, shield.amount)
    }

    if (fillOtherFlanks) {
        const beriTools = beriCastle.unitInventory
            ?.filter(u => u.amount > 0 && u.unitInfo?.pointBonus && !u.unitInfo?.defRangeBonus)
            .map(u => ({ ...u }))
            .sort((a, b) => Number(b.unitInfo.pointBonus) - Number(a.unitInfo.pointBonus))
            ?? []

        // slotTypes is the game's own source of truth for where a tool may be placed:
        // "1" = center, "2" = flank, "9" = reserve. Gate-breaking rams etc. only carry "1,9",
        // so they're excluded from flank placement without needing to hardcode tool names.
        const hasSlotType = (unit, slotType) =>
            (unit.unitInfo?.slotTypes ?? "").split(",").includes(String(slotType))

        // On a pointBonus tie, prefer the tool that can't be placed in the other slot type,
        // saving the dual-capable (both center and flank) tool for wherever it's still needed.
        const preferExclusive = (tools, otherSlotType) =>
            [...tools].sort((a, b) => {
                const pointDiff = Number(b.unitInfo.pointBonus) - Number(a.unitInfo.pointBonus)
                if (pointDiff != 0) return pointDiff

                const aExclusive = !hasSlotType(a, otherSlotType)
                const bExclusive = !hasSlotType(b, otherSlotType)
                return (bExclusive ? 1 : 0) - (aExclusive ? 1 : 0)
            })

        const centerTools = preferExclusive(beriTools.filter(u => hasSlotType(u, 1)), 2)
        const flankTools = preferExclusive(beriTools.filter(u => hasSlotType(u, 2)), 1)

        const otherFlank = useLeftFlank ? wave.R : wave.L

        assignUnit(wave.M.U[0], rangedUnits, 1)
        assignUnit(otherFlank.U[0], rangedUnits, 1)

        assignUnit(wave.M.T[0], centerTools, 40)
        assignUnit(otherFlank.T[0], flankTools, 30)
    }

    let attackResult = -1

    // A cra reply can be lost even though the attack went out. If we freed the
    // commander on that timeout, the next attempt would reuse it and hit
    // LORD_IS_USED, which counts toward the socket-pausing importantErrors limit.
    // The outgoing movement push is the ground truth for "the attack was sent".
    let attackSent = false
    const onOutgoing = movement => {
        if (movement.kingdomID == KingdomID.berimond && movement.lord?.lordID == lord.lordID)
            attackSent = true
    }
    movementEvents.on("outgoing", onOutgoing)

    try {
        // waitToAttack is the same shared gate every other attack plugin (Khan,
        // Samurai, Nomads, Barrons, Fortresses...) dispatches through: it respects
        // the server-reported attack-count threshold (gai/ACTH), a shared hourly
        // rate limiter, and a naturally-randomized delay between dispatches -
        // instead of Berimond having its own private, unthrottled 5-10s timer.
        await waitToAttack(async () => {
            let r = -1

            await setCastle(beriCastle, async () => {
                await gateArmyStart()
                await sendXT("cra", JSON.stringify(attackInfo))

                const [, result] = await waitForResult("cra", 1000 * 15, (obj, res) =>
                    res != 0 ||
                    (obj?.AAM?.M?.KID == KingdomID.berimond &&
                        obj?.AAM?.M?.TA?.[1] == towerInfo.x &&
                        obj?.AAM?.M?.TA?.[2] == towerInfo.y)
                ).catch(() => [null, -1])

                r = result
            })

            attackResult = r
            if (r != 0)
                throw err[r] ?? r

            // Truthy return is what makes the shared queue apply its hourly
            // limiter and randomized inter-attack delay (attack.js); returning
            // undefined silently skipped both.
            return true
        })
    } catch (e) {
        if (e != "ATTACK_LIMIT_REACHED" && attackResult == -1 && !attackSent)
            await sleep(jitterMs(1000 * 20)) // give a late movement push a chance to land

        movementEvents.off("outgoing", onOutgoing)

        if (attackSent) {
            subtractSentUnits(beriCastle, attackInfo)
            console.warn("berimondAttackReplyLostButSent", towerInfo.x, towerInfo.y)
            return
        }

        freeCommander(lord.lordID)

        if (e == "ATTACK_LIMIT_REACHED") {
            console.warn("berimondAttackLimitReached")
            await new Promise(r => setTimeout(r, jitterMs(1000 * 60 * 5)))
            return
        }

        console.warn("berimondAttackFailed")

        // MISSING_UNITS in particular means the last successful attack's units
        // hadn't been reflected in the local inventory cache yet when this attempt
        // was built. Back off briefly so the next state push has time to land,
        // instead of immediately re-firing on the same stale data.
        await new Promise(r => setTimeout(r, jitterMs(1000 * 15)))
        return
    }

    movementEvents.off("outgoing", onOutgoing)
    subtractSentUnits(beriCastle, attackInfo)
    console.log("attackedBerimondTower", towerInfo.x, towerInfo.y)
}

events.once("load", async () => {
    while (true) {
        await attackBerimond()
    }
})

events.once("load", async () => {
    while (true) {
        await sleep(randomIntFromInterval(5, 10) * 1000 * 60)
        refreshCampData()
    }
})

events.once("load", async () => {
    while (true) {
        await resupplyBerimondCamp().catch(e => console.warn("berimondResupplyError", e))
        await waitForResupplyTick(jitterMs(1000 * 30))
    }
})

