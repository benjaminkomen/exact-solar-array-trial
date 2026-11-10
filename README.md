# exact-solar-array-trial

**Live demo:** https://benjaminkomen.github.io/exact-solar-array-trial/

A trial of [Exact](https://github.com/expo/exact), Expo's pre-alpha Rust app framework. It ports the main screens of [solar-array-simulator](https://github.com/benjaminkomen/solar-array-simulator) and tries to match them as closely as Exact allows. It runs on the web only.

The panel art follows the RN app's `BasePanelShape`, `SolarPanel` and `ProductionPanel` and is drawn in SVG:
- a 60 × 120 panel with an 8-point corner radius and a 2-point frame;
- one centre line and three cross lines;
- the theme's linked (blue) and unlinked (grey) colours;
- a 3-point amber ring when the panel is selected;
- a dark wattage label on Production.

The RN code has no gradient or sheen, so this doesn't either.

![RN panel next to Exact panel](docs/compare-panel-closeup.png)

## Screens

| Exact screen | RN source | Matches | Still different |
|---|---|---|---|
| Layout Editor | `custom.tsx`, `SolarPanelCanvas`, `CustomChrome`, `ZoomControls` | Panels drawn as above. Drag a panel and it snaps on release to its neighbours or the 30-point grid, refusing a collision (`neighborSnap.ts`, `collision.ts`) and moving to the front. Drag the background to pan. Tap to select or deselect. Add uses `findFreePosition`. Rotate uses `findValidPositionAfterRotation`. Delete. Link opens Panel Details. The zoom control has three levels (1, 0.66, 0.4). The header shows the unlinked-panel badge and Snap to origin. The canvas transform is the same as the RN app's. | No wizard progress and no compass toggle (compass help is skipped). Production and Configuration are header buttons here, while the RN app reaches them through the wizard flow. The toolbar is a floating pill rather than iOS's native bottom toolbar. Snap to origin jumps instead of animating. |
| Panel Details sheet | `panel-details.tsx`, `PanelDetailsForm` | Linked Inverter (serial, efficiency, Unlink) and Available Inverters with the real footer copy. | It's a full-height sheet: Exact's web host has no detents. There's no "add inverter" shortcut. |
| Production | `production.tsx`, `ProductionCanvas`, `ProductionPanel` | The Total Array Output card (13-point uppercase label, 48-point bold tabular value, 16-point radius, shadow) and the same canvas with per-panel wattage labels. Tapping a panel opens its inverter. Pan, the zoom control, and the ⋯ menu's Edit Configuration all work. Output refreshes every second with a ±5% spread. | Sources can't call `Math.random()`, so the spread is a hash of the tick. There's no compass, no Simulate (sun) button (the 3D screen is skipped), and no Delete Configuration. |
| Configuration | `config.tsx`, `InverterSection` | Panel Settings (wattage field with W and the real footer), Roof segments (Gable, Hip, Flat, Shed) with a 0–90° tilt slider in 5° steps, and Micro-inverters (N) rows with chevrons, swipe to delete, and + to add. | No Location section, because the city search needs a geocoding API. No wizard Continue. |
| Micro-inverter sheet | `inverter-details.tsx`, `InverterDetailsForm` | Edit or Add titles, Serial Number field, Efficiency with Current % and a 0–100 slider, and the real footer copy for each mode. | Exact's web host draws the bar buttons as Cancel and Save at the bottom, not the iOS ✕ and ✓. |

Skipped:
- Welcome (`index.tsx`).
- Upload and analysis: they use the camera, an image picker and an AI API.
- Simulation: it's a three.js scene.
- Compass help.

**Data:**
- All numbers come from the repo: `defaultMaxWattage` 430 W, the 14 default inverter efficiencies, panel size and gap, grid and snap threshold, zoom levels, and the panel colours.
- The canvas starts from `buildMockPanelGrid`'s 2 × 5 grid.
- For the demo, panels 1–8 start linked to inverters 1–8; the RN wizard starts with every panel unlinked.
- Serial numbers are fixed, because the repo generates them randomly.
- Everything is kept in memory.

**Side by side** (left: the repo's iOS screenshots; right: the live Exact web build at 390 × 844):

| | |
|---|---|
| ![](docs/compare-1-layout.png) | ![](docs/compare-3-production.png) |
| ![](docs/compare-2-panel-details.png) | ![](docs/compare-4-production-panel.png) |
| ![](docs/compare-5-config.png) | ![](docs/compare-6-inverter.png) |

## Files

- `app.contract`: the views, routes, state and actions, written in Exact's Contract language. `PanelArt` draws a panel and `ZoomControls` is the zoom card.
- `app.ts`: the data module, holding the config and panels. Snap, collision, free-position, rotation and output logic are ported from the repo's `utils/`.
- `app.test.contract`: four tests. They cover a drag that snaps to an exact position, rotate, add, zoom, linking, Production totals and its sheet, and the Configuration sliders and save.
- `scripts/deploy-pages.sh`: builds the app and publishes it to the `gh-pages` branch.

## Running it

This app uses an Exact checkout by path. By default that's `../exact`; set `EXACT2` to point at another location. Use the Rust, Bun and Chrome versions your Exact checkout pins. Its README and `bun scripts/exact.mjs setup --check` list them.

```sh
git clone https://github.com/expo/exact.git
git clone https://github.com/benjaminkomen/exact-solar-array-trial.git
(cd exact && bun scripts/exact.mjs setup)
cd exact-solar-array-trial
bun exact.mjs web            # dev loop in the browser
bun exact.mjs test web       # runs app.test.contract
bun exact.mjs agent web "tap panel-1 drag 0 300" "clock settle" "screenshot out.png"
```

Exact is pre-alpha and changes daily. If a command fails, `bun exact.mjs update` refreshes the generated files against your checkout.

## Deploying the demo

`scripts/deploy-pages.sh` builds the static site with `bun exact.mjs web-build --out dist` and force-pushes it to the `gh-pages` branch. GitHub Pages serves it from a subpath, so the script points `<base href>` at `/exact-solar-array-trial/`. It also copies `index.html` to `404.html`, so that reloading a pushed screen still loads the app.

Exact's router has no base path, and a trailing slash matches no route. To work around that:
- every route in `app.contract` sits under `/exact-solar-array-trial`;
- a `notfound` route catches `/` and the trailing-slash URL, then steps back to the layout.

## License

MIT
