# Changelog & Custom Modifications

This document tracks all custom features, fixes, and new plugins added to this fork relative to the upstream repository (`darrenthebozz/GGE-BOT`).

---

## 1. New Plugins

| Plugin | Path | Description / Purpose |
| :--- | :--- | :--- |
| **Recruit** | `plugins/recruit.js` | Automates troop recruitment across specified castles, slots, and quantities. Uses castle configuration format `areaID:wodID:slotID:amount`. |
| **Coin Spender** | `plugins/coinSpender.js` | Dumps excess coins above threshold into siege ladders and mantlets. |
| **Tool Production** | `plugins/toolBuild.js` | Continuous workshop tool crafting across castles (`areaID:wodID:amount:slotID`). |
| **Stored Equipment & Gems** | `plugins/sellStoredEquipment.js` | Bulk automated equipment and gem liquidation with socketed and Technicus filters. |
| **Castle Defense & Troop Dodge** | `plugins/troopDodge.js` | Advanced incoming attack evasion with auto-pullback timer, safe castle fallback, and gate opening. |
| **Military Hospital Healer** | `plugins/hospitalHealer.js` | Automated recovery of injured troops with coin/ruby segregation and alliance medical assistance. |
| **Message & Report Management** | `plugins/messageManagement.js` | Automated background filtering and deletion of inbox combat reports and delivery logs. |
| **Berimond Kingdom** | `plugins/berimondKingdom.js` | Dedicated automation for Berimond Kingdom events, actions, and management. |
| **Capture Storm Resource Islands** | `plugins/attack/captureStormRI.js` | Automatically detects and sends attacks/captures for Storm Islands resource sites. |
| **Colossus Event Donate** | `plugins/colossusEventDonate.js` | Automates resource contributions to the Colossus event. |
| **Send Food (Storm)** | `plugins/foodSendStorm.js` | Automated food supply logistics to maintain Storm Island garrisons. |

---

## 2. Modified Existing Plugins & Core Files

### `protocols.js`
* Added `clientRecruitUnit(areaID, wodID, amount, slotID, lordID)` (`bup` packet) to support recruitment actions.
* Added `clientKingdomTroopTransfer(sourceAreaID, sourceKingdomID, targetKingdomID, units)` (`kut` packet).
* Enhanced `hru` handler so `UnitInventory` updates directly on castle object.
* Fixed castle tracking in `setCastle` to prevent unnecessary kingdom switches when clearing castle selections.
* Safe null checking for returning movement stations.

### `ggeBot.js`
* Added support for loading custom plugins (`plugins-personal` and extra local scripts).
* Custom event dispatching and handler enhancements for unit/castle updates.

### `plugins/attack/attack.js`
* Enhanced attack presets and validation logic.

### `plugins/attack/attackBerimondInvasion.js`
* Significantly refactored attack loop logic, cooldown management, and wave formation efficiency.

### `plugins/attack/attackNomads.js`
* Improved target scanning, camp attack automation, and camp level filtering.

### `plugins/attack/attackSamurai.js`
* Optimized attack deployment logic and camp selection.

### `plugins/skips.js`
* Extended time-skip automation handling for various actions (recruitment, travel, hospital).

### `plugins/feast.js`
* Adjusted feast activation timing and intervals.

### `plugins/misc.js`
* Added helper utilities and quality-of-life adjustments.

### `README`
* Documented recruit plugin castle configuration strings and usage examples.

---

## 3. How to Update / Merge from Upstream

To pull updates from the original repository without overwriting this fork's work:

```bash
# Fetch changes from the original repo
git fetch upstream

# Review changes
git log --oneline main..upstream/main

# Merge into local branch
git merge upstream/main
```
