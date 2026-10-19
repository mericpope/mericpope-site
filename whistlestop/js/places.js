// Place lookup via OpenStreetMap Nominatim (free, CORS-enabled, no key).
// Usage policy: max 1 request/second, no autocomplete-style hammering - so we
// only look up on submit, cache results, and space requests out.
// https://operations.osmfoundation.org/policies/nominatim/

const CACHE_PREFIX = "whistlestop:geo:";
const COORDS = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
let lastRequestAt = 0;

function readCache(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeCache(key, value) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage may be unavailable (private mode) - caching is optional */
  }
}

export async function geocode(query) {
  const q = query.trim();
  if (!q) throw new Error("Please enter a place.");

  const m = COORDS.exec(q);
  if (m) {
    const lat = parseFloat(m[1]);
    const lon = parseFloat(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error(`"${q}" is not a valid latitude, longitude.`);
    return { name: `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon, cc: null };
  }

  const key = q.toLowerCase();
  const cached = readCache(key);
  if (cached) return cached;

  const wait = 1100 - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Place lookup failed (${res.status}). Try again in a moment.`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`Couldn't find "${q}". Try a city name, an address, or "lat, lon".`);

  const r = rows[0];
  const place = {
    name: r.display_name,
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
    cc: r.address?.country_code ? r.address.country_code.toUpperCase() : null,
  };
  writeCache(key, place);
  return place;
}
