import { WorldMap } from "../src/index.js";

// Application data, keyed by ISO 3166-1 numeric code. The engine only ever
// reads `name` and `disabled` — everything else is yours.
const countries = {
  "818": { name: "Egypt", capital: "Cairo", continent: "Africa", currency: "EGP" },
  "682": { name: "Saudi Arabia", capital: "Riyadh", continent: "Asia", currency: "SAR" },
  "840": { name: "United States", capital: "Washington, D.C.", continent: "North America", currency: "USD" },
  "826": { name: "United Kingdom", capital: "London", continent: "Europe", currency: "GBP" },
  "392": { name: "Japan", capital: "Tokyo", continent: "Asia", currency: "JPY" },
  "076": { name: "Brazil", capital: "Brasília", continent: "South America", currency: "BRL" },
  "036": { name: "Australia", capital: "Canberra", continent: "Oceania", currency: "AUD" },
  "710": { name: "South Africa", capital: "Pretoria", continent: "Africa", currency: "ZAR" },
  "356": { name: "India", capital: "New Delhi", continent: "Asia", currency: "INR" },
  "124": { name: "Canada", capital: "Ottawa", continent: "North America", currency: "CAD" },
  "300": { name: "Greece", capital: "Athens", continent: "Europe", currency: "EUR", disabled: true },
  "112": { name: "Belarus", capital: "Minsk", continent: "Europe", currency: "BYN", disabled: true },
};

const markers = [
  { id: "cairo", lat: 30.0444, lon: 31.2357, label: "Cairo" },
  { id: "tokyo", lat: 35.6762, lon: 139.6503, label: "Tokyo" },
  { id: "nyc", lat: 40.7128, lon: -74.006, label: "New York" },
  { id: "sydney", lat: -33.8688, lon: 151.2093, label: "Sydney" },
  { id: "rio", lat: -22.9068, lon: -43.1729, label: "Rio" },
];

const nameEl = document.querySelector("#info-name");
const subEl = document.querySelector("#info-sub");
const detailsEl = document.querySelector("#info-details");

function showCountry(country) {
  if (!country) {
    nameEl.textContent = "World";
    subEl.textContent = "Click or tap a country.";
    detailsEl.replaceChildren();
    return;
  }

  nameEl.textContent = country.name;
  const rows = [
    ["Code", country.id],
    ["Capital", country.capital],
    ["Continent", country.continent],
    ["Currency", country.currency],
  ].filter(([, value]) => value);

  subEl.textContent = rows.length > 1 ? "" : "No extra data for this country yet.";
  detailsEl.replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      return [dt, dd];
    })
  );
}

// The geometry is a plain local JSON file — the only thing that gets fetched,
// and it comes from this very folder, not from a CDN.
const geometry = await fetch(new URL("../data/world-50m.json", import.meta.url))
  .then((response) => response.json());

const map = new WorldMap(document.querySelector("#map"), {
  geometry,
  data: countries,
  label: "Interactive world map",
  tooltip: (country) =>
    country.disabled ? `${country.name} — unavailable` : country.name,
  onCountryClick: (country) => showCountry(country),
  onMarkerClick: (marker) => {
    nameEl.textContent = marker.label;
    subEl.textContent = `Marker at ${marker.lat.toFixed(2)}, ${marker.lon.toFixed(2)}`;
    detailsEl.replaceChildren();
  },
});

markers.forEach((marker) => map.addMarker(marker));

document.querySelector("#zoom-in").onclick = () => map.zoomIn();
document.querySelector("#zoom-out").onclick = () => map.zoomOut();
document.querySelector("#reset").onclick = () => {
  map.reset();
  map.clearSelection();
  showCountry(null);
};
document.querySelector("#pick-egypt").onclick = () =>
  showCountry(map.selectCountry("818"));
document.querySelector("#clear").onclick = () => {
  map.clearSelection();
  showCountry(null);
};
// Each palette is just the three colours. Nothing else is touched.
const palettes = [
  { name: "Default", land: "#e8eaee", water: "#d7e7f6", border: "#a8b0bd" },
  { name: "Atlas", land: "#ece3d2", water: "#a8c8de", border: "#a89274" },
  { name: "Slate", land: "#39414f", water: "#1d2530", border: "#5b6675" },
  { name: "Mono", land: "#dcdcdc", water: "#f5f5f5", border: "#767676" },
];
let palette = 0;

const themeButton = document.querySelector("#theme");
themeButton.onclick = () => {
  palette = (palette + 1) % palettes.length;
  const { name, land, water, border } = palettes[palette];
  const root = document.documentElement.style;
  root.setProperty("--map-land", land);
  root.setProperty("--map-water", water);
  root.setProperty("--map-border", border);
  themeButton.textContent = name;
};

// The Fullscreen API on the whole document, so the HUD comes along with the
// map rather than being left behind.
const fullscreenButton = document.querySelector("#fullscreen");
fullscreenButton.onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
};
document.addEventListener("fullscreenchange", () => {
  fullscreenButton.textContent = document.fullscreenElement
    ? "Exit full screen"
    : "Full screen";
});
if (!document.documentElement.requestFullscreen) fullscreenButton.hidden = true;

document.querySelector("#toggle-markers").onchange = (event) => {
  if (event.target.checked) markers.forEach((marker) => map.addMarker(marker));
  else markers.forEach((marker) => map.removeMarker(marker.id));
};

// Handy while poking at it in devtools.
globalThis.map = map;
