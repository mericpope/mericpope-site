// Geometry + ground-transfer model. Pure functions, no DOM, so the same file
// runs in the browser and under `node --test`.

const EARTH_KM = 6371;

export const round2 = (n) => Math.round(n * 100) / 100;

export function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

// Roads are longer than the crow flies.
const roadKm = (km) => km * 1.3;

// Door-to-door minutes for a road transfer: blended urban -> highway speed.
export function groundMinutes(km) {
  const road = roadKm(km);
  const speed = road < 20 ? 28 : road < 60 ? 45 : 70;
  return Math.round((road / speed) * 60) + 5;
}

// Rideshare-style fare: base + distance + time.
export function rideshareCost(km) {
  return round2(2.5 + roadKm(km) * 1.1 + groundMinutes(km) * 0.25);
}

// Own car: fuel + wear only (parking is not modelled).
export function ownCarCost(km) {
  return round2(roadKm(km) * 0.16);
}

// A ground transfer between two points. `from`/`to` need lat/lon/name.
export function groundLeg(from, to, { ownCar = false } = {}) {
  const km = haversineKm(from, to);
  if (km < 0.3) {
    return { kind: "ground", from: from.name, to: to.name, km, minutes: 3, cost: 0, source: "estimate", label: "Walk" };
  }
  const ride = rideshareCost(km);
  const drive = ownCarCost(km);
  const useOwn = ownCar && km >= 8 && drive < ride;
  return {
    kind: "ground",
    from: from.name,
    to: to.name,
    km,
    minutes: groundMinutes(km),
    cost: useOwn ? drive : ride,
    source: "estimate",
    label: useOwn ? "Drive (own car)" : "Rideshare / taxi",
  };
}
