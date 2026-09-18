/**
 * Preprocesses Natural Earth / world-atlas TopoJSON into the runtime format.
 *
 *   node worldmap/scripts/build-map-data.js [--resolution 50m] [--projection naturalEarth1]
 *
 * Everything expensive happens here: TopoJSON decoding, antimeridian repair,
 * projection, rounding and point dedup. The browser receives finished SVG path
 * strings and does no geographic work at all.
 *
 * Dev-only. Not shipped to the browser, not a runtime dependency.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import feature, { object } from "topojson-client/src/feature.js";
import stitch from "topojson-client/src/stitch.js";
import {
  presimplify,
  simplify,
  quantile,
  sphericalTriangleArea,
} from "topojson-simplify";
import { projections } from "../src/projection.js";

const DEG = Math.PI / 180;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, "..", "data");

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const RESOLUTION = arg("resolution", "50m");
const PROJECTION = arg("projection", "naturalEarth1");
const WIDTH = Number(arg("width", 1000));
// Rendered coordinates are rounded to this many decimals. At a 1000-unit wide
// viewBox, 1 decimal is ~0.1px at zoom 1 and still clean at max zoom.
const PRECISION = Number(arg("precision", 1));
// Fraction of points to keep during simplification. 50m detail is built for
// print, not for a 1000-unit viewBox, so most of it is invisible weight.
const RETAIN = Number(arg("retain", RESOLUTION === "50m" ? 0.3 : 1));

const def = projections[PROJECTION];
if (!def) throw new Error(`Unknown projection "${PROJECTION}"`);
const maxLat = def.maxLat ?? 90;

// ---------------------------------------------------------------------------
// Antimeridian repair
// ---------------------------------------------------------------------------

/**
 * Russia, Fiji and Antarctica have rings that step straight across the 180th
 * meridian. A spherical renderer cuts those automatically; a flat projection
 * would instead draw a streak all the way back across the map.
 *
 * Every such step is already a ±180 -> ∓180 pair in the source data, so the
 * ring is cut wherever longitude jumps by more than 180°.
 *
 * The subtle part is closed rings. Where a ring's point list happens to start
 * is arbitrary, so its first and last pieces are really two halves of one
 * continuous run through the seam. Closing them separately is what produces
 * the classic pair of diagonal wedges across the Pacific, so they are rejoined.
 */
function splitAntimeridian(ring) {
  let crosses = false;
  for (let i = 1; i < ring.length; i++) {
    if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) {
      crosses = true;
      break;
    }
  }
  if (!crosses) return [ring];

  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = first[0] === last[0] && first[1] === last[1];

  const pieces = [];
  let current = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) {
      pieces.push(current);
      current = [];
    }
    current.push(ring[i]);
  }
  pieces.push(current);

  if (closed && pieces.length > 1) {
    // The tail runs into the head through the seam; `slice(1)` drops the
    // wrap-around point the two share.
    const tail = pieces.pop();
    pieces[0] = tail.concat(pieces[0].slice(1));
  }

  return pieces.filter((piece) => piece.length > 1).map(pinToEdge);
}

/**
 * Points sitting exactly on ±180 are ambiguous: the same coordinate is both
 * edges of a flat map. Each one is pinned to whichever edge its nearest real
 * neighbour is on, which keeps a piece on a single side instead of stretching
 * it across the world.
 */
function pinToEdge(piece) {
  const n = piece.length;
  const side = new Array(n);
  for (let i = 0; i < n; i++) {
    side[i] = Math.abs(piece[i][0]) === 180 ? 0 : Math.sign(piece[i][0]);
  }

  const before = new Array(n);
  for (let i = 0, seen = 0; i < n; i++) {
    before[i] = seen;
    if (side[i]) seen = side[i];
  }
  const after = new Array(n);
  for (let i = n - 1, seen = 0; i >= 0; i--) {
    after[i] = seen;
    if (side[i]) seen = side[i];
  }

  return piece.map(([lon, lat], i) =>
    side[i] ? [lon, lat] : [180 * (before[i] || after[i] || 1), lat]
  );
}

// ---------------------------------------------------------------------------
// Projection + path building
// ---------------------------------------------------------------------------

function rawProject([lon, lat]) {
  const phi = Math.max(-maxLat, Math.min(maxLat, lat)) * DEG;
  return def.raw(lon * DEG, phi);
}

/** Walks every ring of the dataset so the fit can be derived from real data. */
function forEachRing(geometries, fn) {
  for (const geometry of geometries) {
    if (!geometry) continue;
    const { type, coordinates } = geometry;
    if (type === "Polygon") coordinates.forEach((r) => fn(r));
    else if (type === "MultiPolygon")
      coordinates.forEach((poly) => poly.forEach((r) => fn(r)));
    else if (type === "LineString") fn(coordinates);
    else if (type === "MultiLineString") coordinates.forEach((l) => fn(l));
  }
}

/**
 * Turns one ring into an SVG subpath, dropping points that round to a
 * coordinate we have already emitted. On the 50m dataset this alone removes
 * roughly a third of the points without any visible change.
 */
function ringToPath(ring, fit, close) {
  const k = 10 ** PRECISION;
  let d = "";
  let lastX = NaN;
  let lastY = NaN;
  let kept = 0;

  for (const point of ring) {
    const [rx, ry] = rawProject(point);
    const x = Math.round((fit.tx + fit.scale * rx) * k) / k;
    const y = Math.round((fit.ty - fit.scale * ry) * k) / k;
    if (x === lastX && y === lastY) continue;
    d += (kept === 0 ? "M" : "L") + x + " " + y;
    lastX = x;
    lastY = y;
    kept++;
  }

  // A closed ring needs three distinct corners to enclose any area.
  if (close && kept < 3) return "";
  if (!close && kept < 2) return "";
  return close ? d + "Z" : d;
}

/** Antimeridian repair plus rounding, for a single ring. */
function ringPieces(ring, fit, close) {
  let d = "";
  for (const piece of splitAntimeridian(ring)) d += ringToPath(piece, fit, close);
  return d;
}

/** Flattens any geometry down to a flat list of rings, in a stable order. */
function ringsOf(geometry) {
  if (!geometry) return [];
  const { type, coordinates } = geometry;
  if (type === "Polygon") return coordinates;
  if (type === "MultiPolygon") return coordinates.flat();
  if (type === "LineString") return [coordinates];
  if (type === "MultiLineString") return coordinates;
  return [];
}

/**
 * Builds the `d` string for one feature.
 *
 * `detailed` is the same feature taken from the un-simplified topology.
 * Simplification works on a single global weight threshold, which is fine for
 * continents but wipes small island states (Malta, Nauru, the Maldives) off
 * the map entirely. Because simplification only ever *removes points from
 * arcs*, both versions have an identical ring structure, so the two can be
 * walked in parallel and any ring that simplified itself out of existence can
 * fall back to its full-detail original. Those rings are tiny, so the accuracy
 * costs almost nothing in bytes — and no country can silently disappear.
 */
function geometryToPath(geometry, detailed, fit) {
  const close =
    geometry &&
    (geometry.type === "Polygon" || geometry.type === "MultiPolygon");

  const rings = ringsOf(geometry);
  const detailedRings = ringsOf(detailed);
  let d = "";
  let rescued = 0;

  for (let i = 0; i < rings.length; i++) {
    let sub = ringPieces(rings[i], fit, close);
    if (!sub && detailedRings[i]) {
      sub = ringPieces(detailedRings[i], fit, close);
      if (sub) rescued++;
    }
    d += sub;
  }

  geometryToPath.rescued = rescued;
  return d;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const source = path.join(
  HERE,
  "..",
  "..",
  "node_modules",
  "world-atlas",
  `countries-${RESOLUTION}.json`
);

if (!fs.existsSync(source)) {
  console.error(
    `Missing ${source}\nInstall the dev dependency first:  npm install --save-dev world-atlas`
  );
  process.exit(1);
}

const original = JSON.parse(fs.readFileSync(source, "utf8"));
let topology = original;

// Simplification runs on the *shared arcs*, not on finished rings. That is the
// whole reason it happens at the TopoJSON stage: a border simplified here stays
// bit-identical for both countries that share it, so the fills and the border
// layer can never drift apart and leave slivers.
if (RETAIN < 1) {
  topology = presimplify(topology, sphericalTriangleArea);
  topology = simplify(topology, quantile(topology, RETAIN));
}

const collection = feature(topology, topology.objects.countries);
// Full-detail twin, consulted only to rescue rings that simplification erased.
const detailedCollection = feature(original, original.objects.countries);
const detailedById = new Map(
  detailedCollection.features.map((f, i) => [i, f.geometry])
);

/**
 * Shared borders, each traversed exactly once and *labelled with the two
 * countries it separates*.
 *
 * A flat mesh would be smaller, but attribution is what makes merging
 * countries possible at runtime: to fuse two countries into one you have to
 * drop the border between them, and that needs to be findable.
 *
 * Every arc is walked once and tallied by owner. An arc owned by exactly two
 * geometries is the boundary between them; owned by one, it is coastline
 * (not stored — the country fills outline themselves).
 */
function borderSegmentsByPair(topology) {
  const geometries = topology.objects.countries.geometries;

  const idOf = geometries.map((g) =>
    g.id !== undefined && g.id !== null
      ? String(g.id)
      : `name:${g.properties.name}`
  );

  const owners = new Map();
  geometries.forEach((geometry, index) => {
    const rings =
      geometry.type === "Polygon"
        ? geometry.arcs
        : geometry.type === "MultiPolygon"
          ? geometry.arcs.flat()
          : [];
    for (const ring of rings) {
      for (const arc of ring) {
        const key = arc < 0 ? ~arc : arc;
        let set = owners.get(key);
        if (!set) owners.set(key, (set = new Set()));
        set.add(index);
      }
    }
  });

  const byPair = new Map();
  for (const [arc, set] of owners) {
    if (set.size !== 2) continue;
    const [i, j] = [...set];
    const a = idOf[i];
    const b = idOf[j];
    // Features merged under one ISO code are no longer two countries.
    if (a === b) continue;
    const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    let list = byPair.get(key);
    if (!list) byPair.set(key, (list = []));
    list.push(arc);
  }

  return { byPair, idOf };
}

const { byPair } = borderSegmentsByPair(topology);

// Pass 1 — measure the projected world so we can fit it to the viewBox.
let minX = Infinity;
let minY = Infinity;
let maxX = -Infinity;
let maxY = -Infinity;

forEachRing(
  collection.features.map((f) => f.geometry),
  (ring) => {
    for (const point of ring) {
      const [x, y] = rawProject(point);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
);

const scale = WIDTH / (maxX - minX);
const height = Math.round((maxY - minY) * scale * 10) / 10;
const fit = { scale, tx: -minX * scale, ty: maxY * scale };

// Pass 2 — emit paths.
const countries = [];
const skipped = [];

let rescuedRings = 0;
let mergedCount = 0;

for (const [index, f] of collection.features.entries()) {
  // A handful of entries (Kosovo, Somaliland, N. Cyprus, …) have no ISO
  // numeric code. They are real geography, so they are kept and drawn, but
  // they get a `name:`-prefixed id to make clear they are not ISO-addressable.
  const id =
    f.id !== undefined && f.id !== null
      ? String(f.id)
      : `name:${f.properties.name}`;

  const d = geometryToPath(f.geometry, detailedById.get(index), fit);
  rescuedRings += geometryToPath.rescued;
  if (!d) {
    skipped.push(f.properties.name);
    continue;
  }
  countries.push({ id, name: f.properties.name, d });
}

// A few Natural Earth entries share an ISO code with their parent state
// (Ashmore and Cartier Is. is filed under Australia's 036). One ISO code has
// to mean exactly one selectable country, so those are merged into a single
// path and the largest piece supplies the name.
const merged = new Map();
for (const c of countries) {
  const existing = merged.get(c.id);
  if (!existing) {
    merged.set(c.id, c);
    continue;
  }
  if (c.d.length > existing.d.length) existing.name = c.name;
  existing.d += c.d;
  mergedCount++;
}

const finalCountries = [...merged.values()].sort((a, b) =>
  a.name.localeCompare(b.name)
);

const output = {
  format: "worldmap-paths@2",
  resolution: RESOLUTION,
  // Everything a runtime projection needs to place a lat/lon marker on top of
  // these very same paths.
  projection: {
    name: PROJECTION,
    scale,
    translate: [fit.tx, fit.ty],
  },
  width: WIDTH,
  height,
  countries: finalCountries,
  borders: [...byPair].flatMap(([key, arcs]) => {
    const [a, b] = key.split("\u0000");
    const line = object(topology, {
      type: "MultiLineString",
      arcs: stitch(topology, arcs),
    });
    const d = geometryToPath(line, null, fit);
    return d ? [[a, b, d]] : [];
  }),
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, `world-${RESOLUTION}.json`);
fs.writeFileSync(outFile, JSON.stringify(output));

const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
console.log(`${path.relative(process.cwd(), outFile)}`);
console.log(`  projection  ${PROJECTION}  viewBox 0 0 ${WIDTH} ${height}`);
console.log(`  countries   ${finalCountries.length}`);
console.log(
  `  borders     ${output.borders.length} country pairs, ${kb(
    output.borders.reduce((n, [, , d]) => n + d.length, 0)
  )} of path`
);
console.log(`  total       ${kb(fs.statSync(outFile).size)}`);
if (mergedCount) console.log(`  merged      ${mergedCount} feature(s) into a shared ISO code`);
if (rescuedRings) console.log(`  rescued     ${rescuedRings} rings kept at full detail`);
if (skipped.length) console.log(`  skipped     ${skipped.join(", ")}`);
else console.log(`  skipped     none`);
