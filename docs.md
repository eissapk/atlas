# World Map — project documentation

A vanilla SVG world map. No D3, no TopoJSON, no CDN, no mapping framework.
The browser gets HTML, CSS, ES modules and one local JSON file.

- [1. How it fits together](#1-how-it-fits-together)
- [2. Commands](#2-commands)
- [3. Project layout](#3-project-layout)
- [4. Using the map](#4-using-the-map)
- [5. Country data](#5-country-data)
- [6. Finding country codes](#6-finding-country-codes)
- [7. Theming](#7-theming)
- [8. Merging countries](#8-merging-countries)
- [9. Markers](#9-markers)
- [10. Layout and full screen](#10-layout-and-full-screen)
- [11. The map data pipeline](#11-the-map-data-pipeline)
- [12. Extending the engine](#12-extending-the-engine)
- [13. Accessibility](#13-accessibility)
- [14. Performance](#14-performance)
- [15. Testing](#15-testing)
- [16. Gotchas](#16-gotchas)
- [17. Publishing as an npm package](#17-publishing-as-an-npm-package)

---

## 1. How it fits together

Three things are kept deliberately separate:

| Layer | Lives in | Knows about |
| --- | --- | --- |
| **Engine** | `worldmap/src/` | Geometry, interaction, rendering. Nothing about capitals or currencies. |
| **Map data** | `worldmap/data/*.json` | Country outlines and borders, keyed by ISO 3166-1 numeric. |
| **App data** | `src/countries.js` | Your facts about countries. Passed through untouched. |

The engine reads exactly **two** fields from your data — `name` and
`disabled`. Everything else is handed back to your callbacks unchanged. That
separation is why the same engine can drive a country picker, a sales
dashboard or a travel map without modification.

**All geographic work happens at build time.** The browser never decodes
TopoJSON, never runs a projection over 200k points, and never touches a CDN.
It receives finished SVG path strings.

---

## 2. Commands

```bash
npm run dev            # Olum dev server + Tailwind watch
npm run build          # production build into dist/

npm run map:code       # look up country codes (see §6)
npm run map:countries  # regenerate src/countries.js
npm run map:data       # regenerate the geometry AND copy it into public/
npm run map:demo       # standalone engine demo on :5173
npm run map:test       # 95 behaviour tests in headless Chrome
```

> **`npm run map:data`, never the build script directly.** The script is what
> copies the geometry into `public/`. Running
> `node worldmap/scripts/build-map-data.js` alone updates `worldmap/data/` and
> leaves the app serving a stale file. See §16.

---

## 3. Project layout

```
src/                       the Olum app
  page.html                the map page — merges, markers, info panel
  countries.js             GENERATED — 239 countries of app data
  main.css                 app layout + the three colour knobs
public/
  world-50m.json           GENERATED — copied here by `npm run map:data`
scripts/
  build-country-data.js    generates src/countries.js
  find-code.js             the `map:code` lookup
worldmap/                  the engine — self-contained, publishable as-is
  src/
    map.js                 WorldMap class
    interaction.js         zoom / pan / pinch
    merge.js               mergeCountries()
    markers.js  tooltip.js  projection.js  styles.css  index.js
  data/                    world-50m.json, world-110m.json
  scripts/                 build-map-data.js, serve-demo.js, run-spec.js
  demo/                    standalone demo
  test/spec.html           the behaviour suite
```

---

## 4. Using the map

```js
import { WorldMap, mergeCountries } from "worldmap";
import { countries } from "./countries.js";

const geometry = await fetch("/world-50m.json").then((r) => r.json());

const map = new WorldMap("#map", {
  geometry,
  data: countries,
  onCountryClick: (country) => console.log(country?.name),
});
```

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `geometry` | — | **Required.** Parsed `world-*.json`. |
| `data` | `{}` | Your data, keyed by country id. |
| `onCountryClick` | — | `(country \| null, event)`. `null` when the tap missed. |
| `onCountryHover` | — | `(country \| null, event)`. Mouse only. |
| `onMarkerClick` | — | `(marker, event)`. Also makes markers focusable. |
| `tooltip` | `true` | `false`, or `(country) => string \| Node`. |
| `minZoom` | `1` | |
| `maxZoom` | `8` | |
| `ocean` | `true` | `false` leaves the background transparent. |
| `label` | `"World map"` | Accessible name for the SVG. |

The first argument is an element **or** a selector string.

### Methods

| Method | Returns |
| --- | --- |
| `map.selectCountry(id)` | The country, or `null` if unknown/disabled. Pans it into view. |
| `map.clearSelection()` | `null` |
| `map.selection` | Getter — the selected country, or `null`. |
| `map.getCountry(id)` | Geometry + your data merged, or `null`. |
| `map.setData(data)` | `this`. Replaces app data; geometry untouched. |
| `map.addMarker(marker)` | The marker. |
| `map.removeMarker(id)` | `true` / `false`. |
| `map.zoomIn()` / `zoomOut()` / `reset()` | `this`. Animated. |
| `map.project(lat, lon)` | `{ x, y }` in SVG coordinates. |
| `map.destroy()` | Removes listeners and DOM. |

Ids are normalised, so `getCountry(36)` and `getCountry("036")` both work.

### The country object

```js
{ id: "818", name: "Egypt", ...yourFieldsForThatId }
```

`name` falls back to the geometry's own label when your data has no entry, so
a callback never receives a nameless country.

### Interaction

Wheel zooms **toward the cursor**. Drag pans. Pinch zooms on touch. A press
that moves more than 6px counts as a pan, not a tap — which is what stops
selecting a country and dragging the map from fighting each other.

---

## 5. Country data

`src/countries.js` is **generated** — edit `scripts/build-country-data.js`, not
the file. It covers all 239 countries the map draws, keyed by ISO 3166-1
numeric.

```js
"818": { name: "Egypt", official: "Arab Republic of Egypt", capital: "Cairo",
         continent: "Africa", region: "Northern Africa", currency: "Egyptian Pound",
         currencyCode: "EGP", languages: "Arabic", iso2: "EG", iso3: "EGY",
         callingCode: "+20", area: 1002450, flag: "🇪🇬" },
```

Source is the `world-countries` package (ODbL). Regenerate with
`npm run map:countries`.

**To add or correct a field**, edit `entryFor()` in the generator. Two hooks
already exist:

- `OVERRIDES` — fixes gaps in the upstream data (Micronesia has no currency
  upstream; it is patched to USD).
- `UNCODED` — the five features with no ISO numeric code, filled in by hand.

Fields that are genuinely absent (Antarctica's capital) are omitted rather
than emitted as `undefined`, and the info panel simply skips those rows.

---

## 6. Finding country codes

The ids are ISO 3166-1 numeric — the same values the geometry, your data and
`data-country-id` all use.

```bash
npm run map:code israel     #   "376"   Israel
npm run map:code united     #   "784" UAE / "826" UK / "840" USA
npm run map:code 376        #   "376"   Israel
npm run map:code            #   all 239
```

Searches by name or code, reading straight from the geometry — so it can only
print codes that actually exist on your map.

You can also inspect any country in devtools: every path carries
`data-country-id`.

**Five features have no ISO code** and use a `name:` prefix instead:

```
"name:Kosovo"  "name:Somaliland"  "name:N. Cyprus"
"name:Siachen Glacier"  "name:Indian Ocean Ter."
```

This is why `map:code` beats looking codes up on Wikipedia.

---

## 7. Theming

Three colours control the map:

```css
:root {
  --map-land:   #e8eaee;   /* the countries */
  --map-water:  #dce9f5;   /* the sea, including the margins around the map */
  --map-border: #a8b0bd;   /* the lines between and around countries */
}
```

They live at the top of `src/main.css`. Hover, selection and the disabled
hatch are mixed from those three plus `--map-accent` (the highlight, default
`#2f6fd0`), so changing the three keeps the whole map coherent.

Set them on `:root`, a theme class, or `.wm-root` — the defaults live in
`var()` fallbacks, so an ancestor always wins.

```css
/* A parchment atlas, in four lines. */
:root {
  --map-land: #ece3d2;
  --map-water: #a8c8de;
  --map-border: #a89274;
  --map-accent: #c2622d;
}
```

For finer control, override any derived variable directly:
`--map-country-fill`, `--map-country-hover`, `--map-country-selected`,
`--map-country-disabled`, `--map-outline`, `--map-border-width`,
`--map-marker-fill`, `--map-marker-stroke`, `--map-tooltip-bg`,
`--map-tooltip-fg`, `--map-tooltip-radius`.

> **Pick an accent that contrasts with the land.** The accent is what a
> selected country is filled with. A cream accent on cream land gives a
> ~1.1:1 ratio and selection becomes almost invisible.

---

## 8. Merging countries

`mergeCountries` is a plain transform — geometry in, geometry out. The engine
knows nothing about it.

```js
const merges = {
  levant: { name: "Palestine", members: ["376", "275"] },
};

const regionData = {
  levant: { name: "Palestine", continent: "Asia", region: "Western Asia", area: 26990 },
};

map = new WorldMap("#map", {
  geometry: mergeCountries(raw, merges),
  data: { ...countries, ...regionData },
});
```

The key becomes the region's country id — use it for `data`,
`selectCountry()` and `data-country-id`. Reusing a member's own id works too,
so `{ "826": { name: "British Isles", members: ["826", "372"] } }` folds
Ireland into the United Kingdom.

`["682", "784"]` on its own is shorthand for `{ members: [...] }`. It has
nowhere to put a name, so the region falls back to its id — supply the label
through `data` instead:

```js
mergeCountries(raw, { iberia: ["724", "620"] });
// data: { iberia: { name: "Iberia" } }   <- otherwise it is called "iberia"
```

**What it does:** concatenates the members' path data (which unions the
fills), drops the border segments *between* members, and re-points their
remaining borders at the group.

**Why merged countries look seamless:** a merged path is its members'
outlines concatenated, so stroking it normally would redraw the very border
the merge removed. Merged countries use `paint-order: stroke fill`, painting
the stroke *under* the fill — the seam runs through the interior so the fill
covers it, while the outer edge keeps the half of its stroke falling outside
the shape. That is why its width is doubled. The coastline, selected outline
and focus ring all survive.

A typo'd member id logs a warning rather than silently doing nothing.

---

## 9. Markers

```js
map.addMarker({ id: "cairo", lat: 30.0444, lon: 31.2357, label: "Cairo" });
map.removeMarker("cairo");
```

| Field | Meaning |
| --- | --- |
| `id` | **Required.** Re-adding the same id replaces it. |
| `lat`, `lon` | Projected through the same projection as the geometry. |
| `label` | Text beside the dot, and the accessible name. |
| `radius` | Dot radius, default `4`. |
| `element` | An SVG node to use instead of the default dot. |

Markers live inside the transformed layer so they pan and zoom with the map,
but each carries a counter-scale so it stays a constant size on screen.
Pass `onMarkerClick` to make them clickable and keyboard-focusable.

---

## 10. Layout and full screen

The map sizes itself to its container, so full screen is pure CSS:

```css
html, body { height: 100%; margin: 0; overflow: hidden; }
#map { position: fixed; inset: 0; }
```

The ocean is a background on the container rather than a `<rect>`, so when the
container's aspect ratio differs from the map's, the letterboxed bands are sea
rather than page.

The app floats a title (top-left), an info panel (top-right) and the zoom
controls (bottom-right) over the map. Below 720px the info panel takes the
bottom of the screen and the controls move to the middle of the right edge so
they are not buried under it.

The controls are icon-only buttons with `aria-label` and `title`. The
fullscreen button swaps its icon from CSS via `html:fullscreen` — no JS
bookkeeping.

---

## 11. The map data pipeline

```bash
npm run map:data
node worldmap/scripts/build-map-data.js --resolution 110m --projection mercator
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--resolution` | `50m` | `50m` or `110m`. |
| `--projection` | `naturalEarth1` | Also `equirectangular`, `mercator`. |
| `--width` | `1000` | viewBox width; height is derived. |
| `--retain` | `0.3` (50m) | Fraction of points kept when simplifying. |
| `--precision` | `1` | Decimal places in the output. |

Pipeline: TopoJSON → topology-preserving simplify → antimeridian repair →
project → round → drop points that round to the same coordinate.

Current output: `worldmap-paths@2`, 239 countries, 325 border pairs, 478 kB.

### The format

```json
{ "format": "worldmap-paths@2",
  "projection": { "name": "naturalEarth1", "scale": 185.04, "translate": [500.01, 255.03] },
  "width": 1000, "height": 518.2,
  "countries": [{ "id": "818", "name": "Egypt", "d": "M566.5 151.7L…Z" }],
  "borders": [["818", "729", "M…"]] }
```

Borders are `[countryA, countryB, path]` triples. The attribution is what
makes merging possible: to fuse two countries you have to find and drop the
border between them.

### Three decisions worth knowing

**Simplification runs on shared arcs, not finished rings.** A border
simplified at the TopoJSON stage stays bit-identical for both countries that
share it, so fills and borders can never drift apart and leave slivers.

**Nothing silently disappears.** A single global simplification threshold
wipes small island states off the map. Because simplification only removes
points from arcs, both versions have identical ring structure, so the full
and simplified geometries are walked in parallel and any ring that simplified
out of existence falls back to full detail. 538 rings are rescued this way.
Only Vatican drops — at 0.44 km² it is genuinely sub-pixel.

**No coastline is stored.** It is implied by the outline of every country
fill, which the renderer strokes. Storing one would roughly double the file.

---

## 12. Extending the engine

### Add a projection

`worldmap/src/projection.js` holds a registry. A projection is a raw function
from radians to unitless coordinates:

```js
export const projections = {
  myProjection: { raw: (lambda, phi) => [x, y], maxLat: 85 },
};
```

Then rebuild: `node worldmap/scripts/build-map-data.js --projection myProjection`.
The build script fits the result to the viewBox and records the scale and
translate, so markers project identically at runtime. Nothing in `map.js`
changes.

### Change the level of detail

`--resolution 110m` is 163 kB versus 478 kB, with 177 countries instead of
239. Good for a small inset map. Point the app's `fetch` at it.

### Custom tooltip content

```js
tooltip: (country) =>
  country.disabled ? `${country.name} — unavailable` : `${country.flag} ${country.name}`,
```

Return a `Node` for markup, or `false` on the option to switch it off.

### Disable a country

Put `disabled: true` in your data for that id. Disabled countries are hatched
as well as greyed, are not selectable and are not keyboard-focusable — but
they **do** still report hover and show a tooltip, so you can explain why.

### React to any state change

There is no event bus by design. `onCountryClick`, `onCountryHover` and
`onMarkerClick` are the whole surface. For anything else, read `map.selection`
or query `[data-country-id]` directly.

---

## 13. Accessibility

- The SVG carries an accessible name (`label`) and a `<title>`.
- The countries group is a `listbox`; each country is an `option` with
  `aria-label` and `aria-selected`.
- **Roving tabindex** — the map is a *single* tab stop rather than 239.
  Arrow keys move between countries in alphabetical order, `Enter` selects,
  `Escape` clears. Focus pans the country into view.
- Selection is signalled by outline weight as well as colour; disabled
  countries are hatched as well as greyed.
- Animations respect `prefers-reduced-motion`.

---

## 14. Performance

- Country outlines arrive pre-projected. No geographic maths in the browser.
- **Event delegation** — a handful of listeners on the SVG, not 239.
- Hover changes touch exactly one element. Nothing sweeps the other 238.
- Pan and zoom write one `transform` attribute, batched into an animation frame.
- Zoom-only work (marker counter-scale, hatch counter-scale) is skipped
  while panning.
- `vector-effect: non-scaling-stroke` keeps borders crisp at 8× with no JS.
- Countries are indexed by id in a `Map` — `getCountry` runs on every hover.

---

## 15. Testing

```bash
npm run map:test     # 95 tests, exits non-zero on failure
```

The suite (`worldmap/test/spec.html`) drives headless Chrome over the DevTools
protocol in **real time**, not with `--virtual-time-budget`, because virtual
time starves `requestAnimationFrame` to ~2fps and the map applies transforms
on animation frames. It starts its own static server.

Covers cursor-anchored zoom, pinch anchoring, tap-vs-drag on mouse and touch,
pan clamping, zoom limits, keyboard navigation, markers, disabled states,
theming, merging and `destroy()`.

**Writing colour assertions:** `.wm-country` transitions `fill` over 120ms, so
reading `getComputedStyle(...).fill` straight after changing a variable
returns the *pre-transition* colour. Wait a few frames first.

---

## 16. Gotchas

**Regenerate through `npm run map:data`.** Running the build script directly
updates `worldmap/data/` but not `public/`, leaving the app on stale data. A
pre-`@2` file makes `mergeCountries` half-work — fills merge, borders stay.
It now warns instead of failing silently.

**A merged region's name lives in two places.** `regionData[id].name` wins
over `merges[id].name`, because app data is spread over the geometry name.
Change only the latter and nothing visible updates.

**`selectCountry()` pans by bounding box.** Merging a country with distant
territories (the Netherlands includes its Caribbean islands) centres the view
mid-Atlantic. Same for Russia, which spans the antimeridian.

**Contrast your accent against your land** — see §7.

**Vatican is not on the map.** At 0.44 km² it collapses below one unit of a
1000-wide viewBox. It has an ISO code but no path.

**Australia's ISO code covers Ashmore and Cartier Is.** Natural Earth files
them separately under `036`; the build merges them so one ISO code means one
selectable country.

---

## 17. Publishing as an npm package

`worldmap/` is self-contained and already has a valid manifest — `type:
module`, an `exports` map for `.`, `./styles.css` and `./data/*`, plus `files`
and `sideEffects`. It is wired into this repo as `"worldmap": "file:./worldmap"`,
so `import { WorldMap } from "worldmap"` here is exactly the call an installed
consumer makes.

```bash
cd worldmap && npm publish     # rename it first — `worldmap` is taken on npm
```

`topojson-client`, `topojson-simplify` and `world-atlas` are **devDependencies
only**. The published runtime has zero dependencies.
