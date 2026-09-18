# WorldMap

A small vanilla SVG world map engine. No framework, no D3, no TopoJSON in the
browser, no CDN, **no runtime dependencies at all** — the browser gets HTML, CSS,
ES modules and one local JSON file.

```js
import { WorldMap } from "worldmap";
import "worldmap/styles.css";

const geometry = await fetch("/node_modules/worldmap/data/world-50m.json")
  .then((r) => r.json());

const map = new WorldMap(document.querySelector("#map"), {
  geometry,
  data: {
    "818": { name: "Egypt", capital: "Cairo", currency: "EGP" },
    "300": { name: "Greece", disabled: true },
  },
  onCountryClick(country) {
    console.log(country?.name, country?.capital);
  },
});
```

`data` is keyed by **ISO 3166-1 numeric** code. The engine reads only two fields
from it — `name` and `disabled` — and hands everything else back to your
callbacks untouched.

## API

| Method | Purpose |
| --- | --- |
| `new WorldMap(el, options)` | Build the map into `el`. |
| `map.selectCountry(id)` | Select; returns the country, or `null` if unknown/disabled. |
| `map.clearSelection()` | Clear the selection. |
| `map.selection` | Getter — the selected country, or `null`. |
| `map.getCountry(id)` | Geometry + your data merged, or `null`. |
| `map.setData(data)` | Swap the application data. Geometry is untouched. |
| `map.addMarker(marker)` | `{ id, lat, lon, label?, radius?, element? }` |
| `map.removeMarker(id)` | Remove one marker. |
| `map.zoomIn()` / `zoomOut()` / `reset()` | Animated zoom controls. |
| `map.project(lat, lon)` | Geographic -> SVG coordinates. |
| `map.destroy()` | Remove listeners and DOM. |

### Options

`geometry` (required), `data`, `onCountryClick(country|null, event)`,
`onCountryHover(country|null, event)`, `onMarkerClick(marker, event)`,
`tooltip` (`true` \| `false` \| `(country) => string|Node`), `minZoom` (1),
`maxZoom` (8), `ocean` (true), `label` (accessible name).

## Merging countries

`mergeCountries` is a plain transform of the geometry — geometry in, geometry
out. The engine knows nothing about it.

```js
import { WorldMap, mergeCountries } from "worldmap";

const geometry = mergeCountries(raw, {
  gulf: { name: "Gulf States", members: ["682", "784", "634", "414"] },
});

new WorldMap("#map", {
  geometry,
  data: { gulf: { name: "Gulf States", currency: "Various" } },
});
```

The key becomes the region's country id — use it for `data`, `selectCountry()`
and `data-country-id`. Reusing a member's own id works too, so
`{ "826": { name: "British Isles", members: ["826", "372"] } }` folds Ireland
into the United Kingdom. `["682", "784"]` on its own is shorthand for
`{ members: [...] }`.

The border between merged members is removed, and the members' remaining
borders are re-pointed at the group. A merged region does not stroke itself
(its path is its members' outlines concatenated, so a stroke would redraw the
border the merge just removed); its outline comes from the border layer
instead. The one thing this costs is the hairline where a merged region meets
the sea.

## Theming

Three colours control the map:

```css
:root {
  --map-land: #e8eaee;    /* the countries */
  --map-water: #dce9f5;   /* the sea, including the margins around the map */
  --map-border: #a8b0bd;  /* the lines between and around countries */
}
```

Hover, selection and the disabled hatch are mixed from those three plus
`--map-accent` (the highlight, default `#2f6fd0`), so changing the three keeps
the whole map coherent. Set them on `:root`, on a theme class, or on `.wm-root` —
the defaults live in `var()` fallbacks, so an ancestor always wins.

```css
/* A parchment atlas, in four lines. */
:root {
  --map-land: #ece3d2;
  --map-water: #a8c8de;
  --map-border: #a89274;
  --map-accent: #c2622d;
}
```

Any derived colour can still be overridden on its own when you want finer
control: `--map-country-fill`, `--map-country-hover`, `--map-country-selected`,
`--map-country-disabled`, `--map-outline`, `--map-border-width`,
`--map-marker-fill`, `--map-marker-stroke`, `--map-tooltip-bg`,
`--map-tooltip-fg`, `--map-tooltip-radius`.

## Filling a window

The map sizes itself to its container, so full screen is pure CSS:

```css
html, body { height: 100%; margin: 0; overflow: hidden; }
#map { position: fixed; inset: 0; }
```

The ocean is painted as a background on the container rather than as a `<rect>`,
so when the container's aspect ratio does not match the map's, the letterboxed
bands are sea rather than page. Pass `ocean: false` to leave them transparent.

## Interaction

Wheel zooms toward the cursor, drag pans, pinch zooms on touch, and a press that
moves more than 6px is a pan rather than a tap — so selecting a country and
dragging the map never fight. Keyboard: `Tab` into the map, arrow keys move
between countries, `Enter` selects, `Escape` clears.

## Regenerating the geometry

The data files are prebuilt; you only need this to change resolution or
projection.

```bash
npm install                 # dev-only: topojson-client, topojson-simplify, world-atlas
npm run data
node scripts/build-map-data.js --resolution 50m --projection equirectangular
```

Options: `--resolution 50m|110m`, `--projection naturalEarth1|equirectangular|mercator`,
`--width 1000`, `--retain 0.3` (fraction of points kept), `--precision 1`.

## Development

```bash
npm run demo    # http://localhost:5173
npm test        # 56 behaviour tests in headless Chrome
```
