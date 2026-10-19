// Price + duration ESTIMATE model. Everything returned here is tagged
// source: "estimate". A live provider (see engine.js `livePrice` hook) can
// replace the flight fare with source: "live".
//
// All rates live in the tables below so they are easy to audit and tune.
import { haversineKm, round2 } from "./geo.js";
import { departureTaxUsd } from "./data/taxes.js";

// Deterministic noise so the same query always gives the same numbers.
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function rand01(seed) {
  let t = (hashStr(seed) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---- Flights ----------------------------------------------------------
// One-way economy, USD, before departure taxes.
export function flightEstimate(A, B, date) {
  const d = haversineKm(A, B);
  if (d < 120) return null;
  if (d > 4800 && !(A.longHaul && B.longHaul)) return null; // no intercontinental service
  if (A.tier === 3 && B.tier === 3 && d > 1200) return null; // two small fields: no long routes

  const base = d < 1500 ? 55 + 0.085 * d : d < 4800 ? 95 + 0.05 * d : 170 + 0.045 * d;
  const lowCost = A.tier === 3 || B.tier === 3 ? 0.85 : 1;
  const noise = 0.9 + 0.2 * rand01(`fl:${A.id}:${B.id}:${date}`);
  const fare = Math.round(base * lowCost * noise);
  const minutes = Math.round((d / 780) * 60 + 45 + (d > 4800 ? 20 : 0));
  const taxes = departureTaxUsd(A.cc, d);

  return { fare, taxes, minutes, km: d, source: "estimate" };
}

// ---- Rail / bus / ferry routes ---------------------------------------
// kinds: highspeed = Eurostar/TGV-class; fast = British/US mainline express;
// intercity = ordinary long-distance rail; airport = airport express/shuttle;
// bus; ferry. A route may override speed (`speedKmh`), boarding time (`checkin`)
// and fare (`fare`, USD) when we know better than the per-kind averages.
const SPEED_KMH = { highspeed: 190, fast: 130, intercity: 100, airport: 70, bus: 65, ferry: 24 };
const DETOUR = { highspeed: 1.15, fast: 1.15, intercity: 1.15, airport: 1.2, bus: 1.25, ferry: 1.1 };
const CHECKIN_MIN = { highspeed: 40, fast: 10, intercity: 15, airport: 5, bus: 15, ferry: 60 };

export function linkEstimate(link, A, B) {
  const straight = haversineKm(A, B);
  const km = straight * DETOUR[link.kind];
  const speed = link.speedKmh ?? SPEED_KMH[link.kind];
  const minutes = Math.round((km / speed) * 60 + (link.checkin ?? CHECKIN_MIN[link.kind]));
  const noise = 0.9 + 0.2 * rand01(`lk:${link.a}:${link.b}`);

  let fare;
  if (link.fare != null) fare = link.fare;
  else if (link.kind === "highspeed") fare = Math.max(25, 0.19 * km);
  else if (link.kind === "fast") fare = Math.max(15, 0.18 * km);
  else if (link.kind === "intercity") fare = Math.max(12, 0.15 * km);
  else if (link.kind === "airport") fare = Math.max(8, 0.35 * km);
  else if (link.kind === "bus") fare = Math.max(9, 0.07 * km);
  else fare = 18 + 0.45 * km; // ferry, foot passenger
  fare = Math.round(fare * (link.fare != null ? 1 : noise)); // a known fixed fare isn't jittered

  return { fare, minutes, km, source: "estimate" };
}

// ---- Hotels ------------------------------------------------------------
const HOTEL_NIGHT_USD = { US: 170, GB: 150, FR: 135, BE: 115, NL: 140, DE: 120 };

// One night near a hub (a standard mid-range room).
export function hotelEstimate(hub, date) {
  const base = HOTEL_NIGHT_USD[hub.cc] ?? 120;
  const noise = 0.85 + 0.3 * rand01(`ho:${hub.id}:${date}`);
  const near = hub.type === "air" ? 0.92 : 1; // airport hotels run a touch cheaper
  return { cost: Math.round(base * near * noise), source: "estimate" };
}

// ---- Points (award) estimate for flights ------------------------------
// Award prices don't track cash fares 1:1, and taxes/fees stay payable in
// cash on an award ticket - so the cash taxes line is reused unchanged.
export const TYPICAL_CENTS_PER_POINT = 1.4;

export function pointsEstimate(fare, seed) {
  const variance = 0.75 + 0.6 * rand01(`pt:${seed}`);
  const pts = Math.max(5000, Math.round(((fare * variance) / (TYPICAL_CENTS_PER_POINT / 100)) / 500) * 500);
  return { points: pts, source: "estimate" };
}

export { round2 };
