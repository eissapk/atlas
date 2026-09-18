/**
 * Generates src/countries.js — the application data for the map.
 *
 *   node scripts/build-country-data.js
 *
 * This is deliberately *application* data, not map data. The engine knows
 * nothing about capitals or currencies; it only reads `name` and `disabled`.
 * Keeping it in its own generated file means facts about countries can be
 * refreshed without touching the map, and the map can be reused with a
 * completely different dataset.
 *
 * Source: the `world-countries` package (ODbL), keyed by ISO 3166-1 numeric,
 * which is exactly how the geometry identifies countries.
 *
 * Dev-only.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const all = require("world-countries");

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const GEOMETRY = path.join(ROOT, "worldmap", "data", "world-50m.json");
const OUT = path.join(ROOT, "src", "countries.js");

/**
 * "Egyptian pound" -> "Egyptian Pound", but "CFA franc BCEAO" keeps its
 * acronyms. Only words that are entirely lowercase get capitalised.
 */
const titleCase = (text) =>
  text.replace(/\b[a-z][a-z'’-]*/g, (word) => word[0].toUpperCase() + word.slice(1));

/**
 * The dataset's `region` is continent-level except for the Americas, which the
 * example data splits into North and South.
 */
function continentOf(country) {
  const { region, subregion = "" } = country;
  if (region === "Americas") {
    return subregion === "South America" ? "South America" : "North America";
  }
  if (region === "Antarctic") return "Antarctica";
  return region || "";
}

function entryFor(country, fallbackName) {
  const [currencyCode, currency] = Object.entries(country.currencies ?? {})[0] ?? [];
  const languages = Object.values(country.languages ?? {});
  const callingCode =
    country.idd?.root && country.idd.suffixes?.length === 1
      ? country.idd.root + country.idd.suffixes[0]
      : country.idd?.root || "";

  // Undefined fields are dropped below, so the info panel simply omits a row
  // rather than printing "undefined".
  return {
    name: country.name?.common || fallbackName,
    official: country.name?.official,
    capital: country.capital?.[0],
    continent: continentOf(country),
    region: country.subregion || undefined,
    currency: currency ? titleCase(currency.name) : undefined,
    currencyCode: currencyCode || undefined,
    languages: languages.length ? languages.join(", ") : undefined,
    iso2: country.cca2 || undefined,
    iso3: country.cca3 || undefined,
    callingCode: callingCode || undefined,
    area: typeof country.area === "number" ? country.area : undefined,
    flag: country.flag || undefined,
  };
}

/**
 * Five Natural Earth features have no ISO 3166-1 numeric code, because they
 * are disputed, partially recognised, or not countries at all. They are still
 * drawn and still clickable, so they are filled in by hand and flagged with
 * `recognised: false` rather than being left blank.
 */
const UNCODED = {
  "name:Kosovo": {
    name: "Kosovo", official: "Republic of Kosovo", capital: "Pristina",
    continent: "Europe", region: "Southeast Europe", currency: "Euro",
    currencyCode: "EUR", languages: "Albanian, Serbian", iso2: "XK", iso3: "XKX",
    callingCode: "+383", area: 10887, flag: "🇽🇰", recognised: false,
  },
  "name:N. Cyprus": {
    name: "Northern Cyprus", official: "Turkish Republic of Northern Cyprus",
    capital: "North Nicosia", continent: "Europe", region: "Southern Europe",
    currency: "Turkish Lira", currencyCode: "TRY", languages: "Turkish",
    callingCode: "+90", area: 3355, recognised: false,
  },
  "name:Somaliland": {
    name: "Somaliland", official: "Republic of Somaliland", capital: "Hargeisa",
    continent: "Africa", region: "Eastern Africa", currency: "Somaliland Shilling",
    currencyCode: "SLS", languages: "Somali, Arabic", area: 176120, recognised: false,
  },
  "name:Indian Ocean Ter.": {
    name: "Indian Ocean Territories",
    official: "Australian Indian Ocean Territories",
    continent: "Oceania", region: "Australia and New Zealand",
    currency: "Australian Dollar", currencyCode: "AUD", languages: "English",
    area: 149, recognised: false,
  },
  "name:Siachen Glacier": {
    name: "Siachen Glacier", continent: "Asia", region: "Southern Asia",
    languages: "—", area: 3000, recognised: false,
  },
};

/**
 * Gaps in the upstream dataset, as opposed to facts that genuinely do not
 * exist. Antarctica having no capital is correct; Micronesia having no
 * currency is not — it uses the US dollar.
 */
const OVERRIDES = {
  "583": { currency: "United States Dollar", currencyCode: "USD" },
};

// ---------------------------------------------------------------------------

const geometry = JSON.parse(fs.readFileSync(GEOMETRY, "utf8"));
const byCcn3 = new Map(all.filter((c) => c.ccn3).map((c) => [c.ccn3, c]));

const rows = [];
const missing = [];

for (const feature of geometry.countries) {
  const source = byCcn3.get(feature.id);
  let entry;

  if (source) {
    entry = { ...entryFor(source, feature.name), ...OVERRIDES[feature.id] };
  } else if (UNCODED[feature.id]) {
    entry = UNCODED[feature.id];
  } else {
    // Never leave a clickable country without at least its name.
    entry = { name: feature.name };
    missing.push(`${feature.id} ${feature.name}`);
  }

  // Drop undefined fields so the generated file stays readable.
  const clean = Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== undefined && value !== "")
  );
  rows.push([feature.id, clean, feature.name]);
}

rows.sort((a, b) => a[1].name.localeCompare(b[1].name));

const body = rows
  .map(([id, entry, geometryName]) => {
    const fields = Object.entries(entry)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join(", ");
    // A note where the map's own label differs, so the two are easy to reconcile.
    const note = entry.name !== geometryName ? ` // map label: ${geometryName}` : "";
    return `  ${JSON.stringify(id)}: { ${fields} },${note}`;
  })
  .join("\n");

const output = `/**
 * Country data for the world map, keyed by ISO 3166-1 numeric code — the same
 * identifier the geometry uses, so the two line up without a lookup table.
 *
 * GENERATED by scripts/build-country-data.js — edit that, not this.
 * Source: world-countries (ODbL). ${rows.length} entries.
 *
 * The map engine reads only \`name\` and \`disabled\`; every other field here is
 * yours and is handed back untouched to onCountryClick / onCountryHover.
 */

export const countries = {
${body}
};

export default countries;
`;

fs.writeFileSync(OUT, output);

console.log(`${path.relative(process.cwd(), OUT)}`);
console.log(`  countries   ${rows.length}`);
console.log(`  from ISO    ${rows.length - Object.keys(UNCODED).length - missing.length}`);
console.log(`  hand-filled ${Object.keys(UNCODED).length} (no ISO numeric code)`);
console.log(`  size        ${(fs.statSync(OUT).size / 1024).toFixed(0)} kB`);
if (missing.length) console.log(`  NAME ONLY   ${missing.join(", ")}`);
