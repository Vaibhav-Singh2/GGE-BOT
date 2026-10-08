# Changelog & Custom Modifications

This document tracks all custom features, fixes, and new plugins added to this fork relative to the upstream repository (`darrenthebozz/GGE-BOT`).

---

## 1. New Plugins

| Plugin | Path | Description / Purpose |
| :--- | :--- | :--- |
| **Recruit** | `plugins/recruit.js` | Automates troop recruitment across specified castles, slots, and quantities. Uses castle configuration format `areaID:wodID:slotID:amount`. |
| **Berimond Kingdom** | `plugins/berimondKingdom.js` | Dedicated automation for Berimond Kingdom events, actions, and management. |
| **Troop Dodge** | `plugins/troopDodge.js` | Automated troop evasion/dodging mechanism when incoming attacks are detected. |
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
