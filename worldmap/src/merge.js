/**
 * Merging countries.
 *
 * This is a plain transform of the geometry object — geometry in, geometry
 * out. The map engine knows nothing about it, so merging costs the runtime
 * nothing and you can decide what a "country" is before the map ever sees it.
 *
 *   import { WorldMap, mergeCountries } from "worldmap";
 *
 *   const geometry = mergeCountries(await loadGeometry(), {
 *     gcc: { name: "Gulf States", members: ["682", "784", "634", "414"] },
 *   });
 *
 * The group key becomes the country's id, so `data` keys, `selectCountry()`
 * and `data-country-id` all use it. Reusing a member's own id is fine too —
 * `{ "826": { name: "British Isles", members: ["826", "372"] } }` folds
 * Ireland into the United Kingdom.
 */

/** Matches the engine: ISO numeric ids are zero-padded strings ("036"). */
function normalise(id, known) {
  const key = String(id);
  if (known.has(key)) return key;
  const padded = key.padStart(3, "0");
  return known.has(padded) ? padded : key;
}

export function mergeCountries(geometry, merges) {
  const specs = Object.entries(merges ?? {});
  if (!specs.length) return geometry;

  // Border attribution arrived with worldmap-paths@2. Against an older data
  // file the fills would merge but the border between the members would stay
  // drawn — a silent, confusing half-merge. Say so instead.
  if (geometry.borders && !Array.isArray(geometry.borders)) {
    console.warn(
      "mergeCountries: this geometry predates per-country border data " +
        `(format ${geometry.format ?? "unknown"}), so borders between merged ` +
        "countries cannot be removed. Regenerate it with `npm run map:data`."
    );
  }

  const known = new Set(geometry.countries.map((c) => c.id));

  // member id -> group id
  const groupOf = new Map();
  for (const [groupId, spec] of specs) {
    const members = Array.isArray(spec) ? spec : (spec?.members ?? []);
    for (const member of members) {
      const id = normalise(member, known);
      if (!known.has(id)) {
        // A typo'd ISO code would otherwise just silently do nothing.
        console.warn(`mergeCountries: no country "${member}" in this geometry`);
        continue;
      }
      groupOf.set(id, groupId);
    }
  }

  // Concatenating the members' path data unions them: the shared boundary is
  // traced in both directions and cancels out under the nonzero fill rule.
  const countries = [];
  const groups = new Map();

  for (const country of geometry.countries) {
    const groupId = groupOf.get(country.id);
    if (groupId === undefined) {
      countries.push(country);
      continue;
    }

    let group = groups.get(groupId);
    if (!group) {
      const spec = merges[groupId];
      group = {
        id: groupId,
        name: (Array.isArray(spec) ? null : spec?.name) ?? groupId,
        d: "",
        members: [],
      };
      groups.set(groupId, group);
      countries.push(group);
    }
    group.d += country.d;
    group.members.push(country.id);
  }

  // Drop the borders *between* members — that line is what would still show
  // the old division — and re-point the rest at the group.
  const borders = Array.isArray(geometry.borders)
    ? geometry.borders
        .filter(([a, b]) => {
          const ga = groupOf.get(a);
          return ga === undefined || ga !== groupOf.get(b);
        })
        .map(([a, b, d]) => [groupOf.get(a) ?? a, groupOf.get(b) ?? b, d])
    : geometry.borders;

  return { ...geometry, countries, borders };
}
