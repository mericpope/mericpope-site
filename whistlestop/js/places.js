// Place suggestions for the From/To boxes.
//
// Two sources, merged:
//   1. LOCAL  - our own hub dataset (airports by code or name, stations, ports):
//               instant, offline, exact. "LHR" or "heathrow" -> Heathrow.
//   2. PHOTON - komoot's free OpenStreetMap geocoder (https://photon.komoot.io),
//               built for search-as-you-type and CORS-enabled. Cities, towns,
//               addresses, landmarks. Fair-use only ("extensive usage will be
//               throttled"), so we debounce, need >= 3 chars, and cache.
//
// Every suggestion is { label, sub, kind, lat, lon, cc } and is self-contained:
// picking one needs no second lookup.

const PHOTON = "https://photon.komoot.io/api/";
const KIND_LABEL = { air: "Airport", rail: "Train station", bus: "Bus station", ferry: "Ferry terminal" };
const COORDS = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// ---- local hubs ---------------------------------------------------------
function hubToSuggestion(h) {
  return { label: h.name, sub: `${KIND_LABEL[h.type] || "Hub"} · ${h.city}, ${h.cc}`, kind: h.type, lat: h.lat, lon: h.lon, cc: h.cc, hub: true };
}

// A hub whose name starts with its city ("Paris Orly") should not outrank the
// city itself when someone types "paris", so those are only secondary.
const cityLike = (h) => norm(h.name).startsWith(norm(h.city));

export function suggestLocal(query, hubs, limit = 4) {
  const q = norm(query);
  if (q.length < 2) return { primary: [], secondary: [], exactCode: false };

  // Words that are city names in the dataset - a hub that merely STARTS with
  // one ("Brussels South Charleroi") must not outrank the city itself.
  const cityNames = new Set(hubs.map((h) => norm(h.city)));
  const shortName = (h) => norm(h.name.replace(/\s*\([^)]*\)\s*$/, ""));

  const primary = [];
  const secondary = [];
  let exactCode = false;
  for (const h of hubs) {
    const name = norm(h.name);
    const code = h.code ? h.code.toLowerCase() : "";
    const isCode = !!code && q === code;
    const short = shortName(h);
    const first = short.split(/s+/)[0];
    const strong =
      isCode ||
      (short === q && short !== norm(h.city)) ||
      (q.length >= 4 && first === q && !cityLike(h) && !(cityNames.has(first) && first !== norm(h.city)));
    const weak = name.includes(q) || norm(h.city) === q;
    if (!strong && !weak) continue;
    if (isCode) exactCode = true;
    (strong ? primary : secondary).push(h);
  }
  const rank = (a, b) => a.tier - b.tier || a.name.localeCompare(b.name);
  primary.sort(rank);
  secondary.sort(rank);
  return {
    primary: primary.slice(0, limit).map(hubToSuggestion),
    secondary: secondary.slice(0, Math.max(0, limit - 1)).map(hubToSuggestion),
    exactCode,
  };
}

// ---- Photon ---------------------------------------------------------------
const cache = new Map();

const PLACE_TYPES = new Set(["city", "town", "village", "district", "locality", "county", "state", "country", "street", "suburb", "neighbourhood"]);
const placeType = (p) => (PLACE_TYPES.has(p.type) ? p.type : PLACE_TYPES.has(p.osm_value) ? p.osm_value : "place");

export function photonToSuggestion(f) {
  const p = f.properties || {};
  const [lon, lat] = f.geometry?.coordinates || [];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const main = p.name || p.street || p.city;
  if (!main) return null;
  const place = [p.city && p.city !== main ? p.city : null, p.state, p.country].filter(Boolean);
  const kind = p.osm_value === "aerodrome" ? "air" : p.osm_key === "railway" ? "rail" : "place";
  // A state/country/county "centre" is never a sensible place to travel from.
  const broad = ["state", "country", "county"].includes(p.type) || ["state", "country", "county"].includes(p.osm_value);
  const ctx = norm([p.city, p.district, p.county, p.state, p.country, p.countrycode].filter(Boolean).join(" "));
  return {
    broad,
    ctx,
    label: [main, ...place.slice(0, 2)].join(", "),
    sub: kind === "air" ? "Airport (map)" : kind === "rail" ? "Station (map)" : placeType(p),
    kind,
    lat,
    lon,
    cc: p.countrycode ? p.countrycode.toUpperCase() : null,
  };
}

// People write "Boston, USA" or "10 Downing Street, London". The map service
// treats every word as a name ("Murphy USA" petrol stations!), so we search the
// part before the first comma and use the rest only as a hint to boost results
// in the matching country / region.
const ALIASES = {
  usa: "US", us: "US", "u.s.": "US", "u.s.a.": "US", america: "US", "united states": "US", "united states of america": "US",
  uk: "GB", "u.k.": "GB", "united kingdom": "GB", england: "GB", scotland: "GB", wales: "GB", britain: "GB", "great britain": "GB",
};

export function splitQuery(query) {
  const i = query.indexOf(",");
  if (i < 0) return { main: query.trim(), hint: "" };
  return { main: query.slice(0, i).trim(), hint: norm(query.slice(i + 1)) };
}

function matchesHint(s, hint) {
  if (!hint) return false;
  const code = ALIASES[hint];
  if (code) return s.cc === code;
  return hint.split(/s+/).every((t) => s.ctx && s.ctx.includes(t));
}

export async function suggestRemote(query, { signal, fetchImpl = fetch } = {}) {
  const { main, hint } = splitQuery(query);
  if (main.length < 3) return [];
  const key = norm(query);
  if (cache.has(key)) return cache.get(key);
  const res = await fetchImpl(`${PHOTON}?q=${encodeURIComponent(main)}&limit=${hint ? 10 : 6}&lang=en`, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Place search unavailable (${res.status})`);
  const data = await res.json();
  const seen = new Set();
  const out = [];
  for (const f of data.features || []) {
    const s = photonToSuggestion(f);
    if (!s || seen.has(s.label)) continue;
    seen.add(s.label);
    s.hinted = matchesHint(s, hint);
    out.push(s);
  }
  // stable sorts: matches for the hint first, then cities/places before big regions
  out.sort((x, y) => Number(y.hinted) - Number(x.hinted) || Number(x.broad) - Number(y.broad));
  const result = out.slice(0, 6);
  cache.set(key, result);
  return result;
}

// ---- combined -------------------------------------------------------------
export function parseCoords(text) {
  const m = COORDS.exec(text);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lon = parseFloat(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, sub: "Coordinates", kind: "place", lat, lon, cc: null };
}

// Returns merged suggestions; `remoteError` is set (not thrown) if Photon fails
// so local matches still show.
export async function suggest(query, hubs, opts = {}) {
  const coord = parseCoords(query);
  if (coord) return { items: [coord], remoteError: null };

  const local = suggestLocal(splitQuery(query).main, hubs);
  let remote = [];
  let remoteError = null;
  const codeOnly = local.exactCode && splitQuery(query).main.length === 3 && !query.includes(",");
  if (!codeOnly) {
    try {
      remote = await suggestRemote(query, opts);
    } catch (e) {
      if (e.name === "AbortError") throw e;
      remoteError = e.message;
    }
  }
  const items = [...local.primary, ...remote, ...local.secondary].slice(0, 8);
  return { items, remoteError };
}
