/**
 * Looks up the country codes used by the map.
 *
 *   npm run map:code            list every country
 *   npm run map:code israel     search by name
 *   npm run map:code 376        search by code
 *
 * The ids are ISO 3166-1 numeric codes — the same ones the geometry uses, so
 * whatever this prints can go straight into `merges`, `data` or selectCountry().
 *
 * Dev-only.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const geometry = JSON.parse(
  fs.readFileSync(path.join(ROOT, "worldmap", "data", "world-50m.json"), "utf8")
);

const query = process.argv.slice(2).join(" ").toLowerCase();
const rows = geometry.countries.filter(
  (c) => !query || c.name.toLowerCase().includes(query) || c.id.includes(query)
);

for (const { id, name } of rows) console.log(`  "${id}"   ${name}`);
console.log(
  rows.length
    ? `\n${rows.length} of ${geometry.countries.length}`
    : `No country matches "${query}".`
);
