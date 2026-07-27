# Diner Shift Scheduler

A client-side web app for restaurant shift scheduling with 15-minute granularity, rule-based validation, and automatic cook schedule generation.

## How to Use

1. **Open** `index.html` in any modern browser (Chrome, Firefox, Safari, Edge)
2. **Add employees** — click `+ Employee` or load from the `Roster` button
3. **Auto-Assign** — click `Auto-Assign` to generate a full shift schedule
4. **Edit the grid** — click any cell to change roles (CK = Cook, SRV = Server, HST = Host, BK = Break, L = Lunch)
5. **Validate** — click `Validate` to check for rule violations
6. **Save/Load** — all data saved to your browser's local storage

## Features

- 15-minute granularity grid (10:00 AM – 9:00 PM)
- Rule-based auto-assignment engine for cooking schedules
- Break scheduling (3 equal segments ±1 slot)
- 30-minute post-lunch gap for lunch chef
- 30-minute post-break gap before next cooking shift
- Call-out handling with automatic CK redistribution
- 3-section output list (Cook, Lunch, 15s) matching handwritten format

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell, modals, cache busters |
| `css/style.css` | Dark theme styling |
| `js/engine.js` | Core logic, validation, employee model |
| `js/grid.js` | Schedule grid rendering |
| `js/output.js` | 3-section output list |
| `js/app.js` | UI wiring, ROSTER presets, localStorage |
| `js/auto-engine.js` | Auto-assign scheduling engine |

## Requirements

None. No installation, no backend, no build step. Just a browser.

## Sharing

Send the folder as a ZIP or host on any static web server. All data stays in the browser's localStorage — nothing is sent anywhere.
