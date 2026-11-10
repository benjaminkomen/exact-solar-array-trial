# exact-solar-array-trial

**Live demo:** https://benjaminkomen.github.io/exact-solar-array-trial/

A trial of [Exact](https://github.com/expo/exact), Expo's pre-alpha Rust app framework. It ports the main screens of [solar-array-simulator](https://github.com/benjaminkomen/solar-array-simulator) and tries to match them as closely as Exact allows. The live demo is a web build. An unsigned iOS build is produced in GitHub Actions (see below); EAS Build does not support Exact yet.

The panel art follows the RN app's `BasePanelShape`, `SolarPanel` and `ProductionPanel` and is drawn in SVG:
- a 60 × 120 panel with an 8-point corner radius and a 2-point frame;
- one centre line and three cross lines;
- the theme's linked (blue) and unlinked (grey) colours;
- a 3-point amber ring when the panel is selected;
- a dark wattage label on Production.

The RN code has no gradient or sheen, so this doesn't either.

![RN panel next to Exact panel](docs/compare-panel-closeup.png)

## The flow

It follows the RN app's wizard: **Welcome → Get Started → Configure → Continue → Photo → Skip (or Continue without photo) → Layout → Finish → Production**. Back steps through the stack, as in the RN app. From Production, the ⋯ menu has Edit Configuration (the wizard again from step 1) and Delete Configuration (which resets everything and goes back to Welcome).

| Exact screen | RN source | Matches | Still different |
|---|---|---|---|
| Welcome | `index.tsx` | The 140-point icon tile with its blue glow, the title, the subtitle, and the Get Started button. | No status bar or iOS chrome. The RN app skips to Production on launch once the wizard is done; here state lives in memory, so every load starts at Welcome. |
| Wizard stepper | `WizardProgress.tsx` | Shown on Configure, Photo and Layout. 32-point circles: blue with a check when done, blue with the number when current, and grey-ringed when ahead. The 11-point labels and the 40 × 2 connectors also match. | None that matters. |
| Configure | `config.tsx?wizard=true` | Step 1, with the floating Continue and + bottom bar. | The Location (city) section isn't ported. The navigation bar is the web host's, with a large left-aligned title and a "Back" text. |
| Photo | `upload.tsx` | Step 2: the icon tile, title, subtitle, Take Photo and Choose from Gallery, Continue without photo, and Skip. | The camera and gallery are disabled and labelled as not ported. Skip goes straight to an empty Layout, as in RN. Continue without photo goes to the mock 2 × 5 grid the RN Analyze step falls back to, but the Analyze screen itself isn't ported. |
| Layout Editor | `custom.tsx`, `SolarPanelCanvas`, `CustomChrome`, `ZoomControls` | Step 3. The header has the compass toggle, the unlinked-count badge and Snap to origin. Drag a panel and it snaps on release to its neighbours or the 30-point grid, refusing a collision. Also: pan, zoom (200 ms ease-in-out quad, as in RN's `useZoom`), add, link, rotate and delete. Every new panel starts unlinked. Finish appears once there's at least one panel. | The bar is the web host's. The RN iOS title is empty; this uses the RN web title, "Layout Editor". |
| Compass | `Compass.tsx` | An 80-point compass with four 40° arcs, N, E, S and W (N darker), and the notched arrow. Drag the arrow: the angle is `atan2(dx, -dy)` from the centre and snaps to the nearest 45° on release, stored in `config.compassDirection`. A tap opens the help. The toggle shows it and opens the help, as in RN. Production shows it read-only. | The snap isn't animated over 150 ms. |
| Array Orientation sheet | `compass-help.tsx`, `CompassHelpBody` | The navigation arrow, the title and the real copy. | A full-height sheet with Close, not a 0.3-detent form sheet with a grabber. |
| Panel Details sheet | `panel-details.tsx`, `PanelDetailsForm` | Linked Inverter (serial, efficiency, Unlink) and Available Inverters, with the real footer copy. | A full-height sheet: Exact's web host has no detents. |
| Production | `production.tsx`, `ProductionCanvas`, `ProductionPanel` | The Total Array Output card and the canvas, centred on the panels, with per-panel wattage labels refreshed every second, the read-only compass, zoom, and the ⋯ menu. | No Simulate (sun) button; the 3D view isn't ported. Back goes to Welcome, because Finish rebuilds the stack. |
| Micro-inverter sheet | `inverter-details.tsx`, `InverterDetailsForm` | Edit and Add titles, the Serial Number field, Efficiency with a slider, and the real footer copy. | A full-height sheet. |

Skipped:
- the camera, gallery and AI analysis;
- the 3D simulation (three.js);
- the location search.

**Side by side, the wizard and compass** (left: the repo's iOS screenshots; right: this Exact web build at 390 × 844):

| | |
|---|---|
| ![](docs/compare-wizard-1-welcome.png) | ![](docs/compare-wizard-2-configure.png) |
| ![](docs/compare-wizard-3-photo.png) | ![](docs/compare-wizard-4-layout-compass.png) |

**Data:**
- All numbers come from the repo: `defaultMaxWattage` 430 W, the 14 default inverter efficiencies, panel size and gap, grid and snap threshold, zoom levels, and the panel colours.
- The wizard starts the way the RN app does: no panels after Skip, or `buildMockPanelGrid`'s 2 × 5 grid after Continue without photo. Every panel is unlinked until you link it.
- Serial numbers are fixed, because the repo generates them randomly.
- Everything is kept in memory.

**Side by side, the editor screens** (left: the repo's iOS screenshots; right: the live Exact web build at 390 × 844):

| | |
|---|---|
| ![](docs/compare-1-layout.png) | ![](docs/compare-3-production.png) |
| ![](docs/compare-2-panel-details.png) | ![](docs/compare-4-production-panel.png) |
| ![](docs/compare-5-config.png) | ![](docs/compare-6-inverter.png) |

## Files

- `app.contract`: the views, routes, state and actions, written in Exact's Contract language. `PanelArt` draws a panel, `ZoomControls` is the zoom card, `WizardProgress` is the stepper and `CompassRose` is the compass.
- `app.ts`: the data module, holding the config and panels. Snap, collision, free-position, rotation and output logic are ported from the repo's `utils/`.
- `app.test.contract`: five tests. They cover the whole wizard (Welcome → Configure → Skip → Layout → Finish → Production), the photo-less grid with drag, rotate, zoom and link, a compass drag that sets `config.compassDirection` to 90° then 180°, Production's menu back into Configuration, and zoom easing through intermediate scales over 200 ms.
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
bun exact.mjs agent web "tap get-started-button" "clock settle" "screenshot out.png"
```

Exact is pre-alpha and changes daily. If a command fails, `bun exact.mjs update` refreshes the generated files against your checkout.

## Deploying the demo

`scripts/deploy-pages.sh` builds the static site with `bun exact.mjs web-build --out dist` and force-pushes it to the `gh-pages` branch. GitHub Pages serves it from a subpath, so the script points `<base href>` at `/exact-solar-array-trial/`. It also copies `index.html` to `404.html`, so that reloading a pushed screen still loads the app.

Exact's router has no base path, and a trailing slash matches no route. To work around that:
- every route in `app.contract` sits under `/exact-solar-array-trial`;
- a `notfound` route catches `/` and the trailing-slash URL, then steps back to Welcome.

## iOS build (GitHub Actions)

EAS Build does not support Exact yet. Exact is not a React Native project, and its iOS app is built by Exact's own script (`bun exact.mjs ios`), which needs Rust, Bun and Xcode. Putting that on EAS would mean installing those tools on Expo's workers by hand. This repo uses a GitHub Actions workflow instead: [`.github/workflows/ios.yml`](.github/workflows/ios.yml), on GitHub's `xcode-27` runner. Exact's own CI uses `macos-26`, but that image's default Xcode cannot compile Exact's Swift host (it references APIs such as `UIArrangementViewController` that the older SDK does not include). Exact does not build iOS apps in its own CI.

The workflow checks out a pinned Exact commit (Exact is pre-alpha and changes daily), installs the Rust toolchain and iOS targets Exact pins, Bun, and the attested Hermes bundles Exact's README describes, then builds:

- an unsigned device `.ipa`, with `bun exact.mjs ios --device --archive ExactSolarTrial.ipa --unsigned`. Exact ad-hoc signs it with no profile and no team, for a service that re-signs it.
- an iOS Simulator `.app`, with `bun exact.mjs ios --no-install` (a compile check: it does not boot a simulator).

There are no Apple signing secrets, so the `.ipa` cannot be installed on a phone until it is re-signed. An iOS distribution build also needs a square raster of at least 512 px in `app.json`'s `icons` array, which Exact's docs describe; this repo ships `assets/icon-1024.png`. Run the workflow from the Actions tab, or it runs on pushes to `main` that touch the app sources. The artifacts are attached to the run.

The workflow does not run Exact's full `bun scripts/exact.mjs setup`, which also installs the web and game toolchain. It only installs what an iOS TypeScript app needs.

To build the same way on a Mac, with Exact checked out next to this repo:

```sh
bun exact.mjs ios --device --archive ExactSolarTrial.ipa --unsigned
bun exact.mjs ios --no-install
```

## License

MIT
