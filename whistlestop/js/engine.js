// Whistlestop search engine.
//
// The idea: you're willing to TRAVEL up to X hours from where you start to reach
// a better departure point, and up to Y hours from where you land to your final
// destination. The cheapest way to get there is often not from your local airport.
//
// An itinerary is   PRE-CHAIN  ->  MAIN FLIGHT  ->  POST-CHAIN
//   pre-chain : origin -> the airport the main flight leaves from. Any mix of
//               taxi, train/bus/ferry rides (with changes) and ONE short
//               "positioning" flight to another hub (e.g. a budget flight London
//               -> Milan, then the long-haul from Milan).
//   main flight: the long flight (or a rail/bus/ferry route for non-air trips).
//   post-chain: the mirror image on arrival, within Y hours.
//
// Time limits count TIME SPENT TRAVELLING (vehicle time, getting to the airport,
// changes) - not time spent waiting around at airports, which is still shown in
// the total. With overnight allowed the limits double and anything beyond the
// plain limit gets a hotel night, shown on its own line.
//
// Two flights are two separate tickets: the engine inserts a long self-transfer
// gap, and flags it, because nobody protects you if the first one is late.
//
// The "direct" baseline is the best itinerary using only hubs close to you
// (<= 90 min) at both ends, so every option is measured against simply leaving
// from your local hub.
//
// Pure ESM - runs in the browser and under `node --test`.
import { groundLeg, groundMinutes, haversineKm, round2 } from "./geo.js";
import { flightEstimate, linkEstimate, hotelEstimate, pointsEstimate } from "./pricing.js";

export const MODES = ["air", "rail", "bus", "ferry"];
export const LOCAL_MINUTES = 90;

const MAX_RIDES = 3;
const TRANSFER_KM = 15; // two stations this close count as "a change in the same city"
const MAX_POSITIONING_KM = 3000; // a positioning flight is a short/medium hop, not the long leg
const SELF_TRANSFER_MIN = 90; // collect bags + re-check in, on top of the normal airport time
const MAX_HOP_STARTS = 12; // origin-side airports a repositioning flight may start from (nearest first)
const MAX_HOP_CHAINS = 250; // cap on repositioning chains kept per side (each starting airport still gets its best few)
const MIN_PER_START = 5;

const clamp = (v, lo, hi, dflt) => (Number.isFinite(+v) && v !== "" && v !== null ? Math.min(hi, Math.max(lo, +v)) : dflt);

export function normalize(input) {
  return {
    origin: input.origin,
    destination: input.destination,
    date: input.date || "",
    beforeHours: clamp(input.beforeHours, 0.25, 12, 3),
    afterHours: clamp(input.afterHours, 0.25, 12, 1.5),
    modes: new Set((input.modes || MODES).filter((m) => MODES.includes(m))),
    positioning: input.positioning !== false, // allow a short flight as a repositioning move
    overnight: !!input.overnight,
    ownCar: !!input.ownCar,
    valuePerHour: clamp(input.valuePerHour, 0, 500, 0),
    pointsCents: clamp(input.pointsCents, 0.1, 10, 1.4),
    rankBy: input.rankBy === "points" ? "points" : "cash",
  };
}

function buildContext(data, opts) {
  const hubsById = new Map(data.hubs.map((h) => [h.id, h]));
  const adj = new Map();
  for (const link of data.links) {
    const a = hubsById.get(link.a);
    const b = hubsById.get(link.b);
    if (!a || !b) continue;
    if (!adj.has(a.id)) adj.set(a.id, []);
    if (!adj.has(b.id)) adj.set(b.id, []);
    adj.get(a.id).push({ other: b, link });
    adj.get(b.id).push({ other: a, link });
  }
  const airports = data.hubs.filter((h) => h.type === "air");
  return {
    hubs: data.hubs,
    hubsById,
    adj,
    airports,
    // intercontinental gateways: the hubs worth repositioning TO
    gateways: airports.filter((a) => a.tier === 1 || a.longHaul),
    transitModes: ["rail", "bus", "ferry"].filter((m) => opts.modes.has(m)),
    positioning: opts.positioning && opts.modes.has("air"),
    date: opts.date,
    ownCar: opts.ownCar,
    value: opts.valuePerHour,
  };
}

// Flight estimates are pure and reused by thousands of itineraries - cache them.
function estimate(ctx, A, B) {
  ctx.estCache ??= new Map();
  const key = A.id + ">" + B.id;
  if (!ctx.estCache.has(key)) ctx.estCache.set(key, flightEstimate(A, B, ctx.date));
  return ctx.estCache.get(key);
}

// ---- legs ---------------------------------------------------------------------
const reverseLeg = (l) => ({
  ...l,
  from: l.to, to: l.from,
  fromId: l.toId, toId: l.fromId,
  fromCity: l.toCity, toCity: l.fromCity,
  fromCode: l.toCode, toCode: l.fromCode,
});

function rideLeg(link, from, to) {
  const est = linkEstimate(link, from, to);
  return {
    kind: link.mode,
    label: link.name,
    from: from.name,
    to: to.name,
    fromId: from.id,
    toId: to.id,
    fromCity: from.city,
    toCity: to.city,
    km: est.km,
    minutes: est.minutes,
    cost: est.fare,
    source: est.source,
  };
}

const waitLeg = (A, label, minutes, role) => ({ kind: "wait", label, from: A.name, to: A.name, minutes, cost: 0, source: "estimate", role });

// side: "pre" (a repositioning flight before the main one), "main", or "post".
function flightLeg(A, B, est, side) {
  return {
    kind: "flight",
    id: `${side}:${A.code}-${B.code}`,
    side,
    role: side === "main" ? "main" : "position",
    label: side === "main" ? "Flight" : "Short flight (separate ticket)",
    from: A.name, to: B.name,
    fromCode: A.code, toCode: B.code, fromCity: A.city, toCity: B.city,
    km: est.km, minutes: est.minutes, cost: est.fare, source: est.source,
    expected: est.minutes, // our own estimate, sent to the price provider as a sanity check
  };
}

const taxLeg = (A, est, flightId) => ({
  kind: "tax", label: `Departure taxes & fees (${A.cc})`, from: A.name, to: A.name, minutes: 0, cost: est.taxes, source: "estimate", forFlight: flightId,
});

// A rail/bus/ferry journey inside a chain only makes sense if, taken as a whole,
// it carries you meaningfully closer to the airport (otherwise you'd ride away
// and back).
export function makesProgress(S, S2, A) {
  return haversineKm(S2, A) <= 0.7 * haversineKm(S, A);
}

// ---- chains: a point <-> an airport ---------------------------------------------
// base = ground/rides; pos = optional repositioning flight { from, to, est }.
// `minutes` is time spent MOVING (what the X/Y-hour limits count); waiting at
// airports is in `waitMinutes` and still appears in the itinerary's total.
function makeChain(base, end, kind, ctx, noHotelMin, pos = null) {
  const baseMin = base.reduce((s, l) => s + l.minutes, 0);
  const baseCost = base.reduce((s, l) => s + l.cost, 0);
  const intl = pos ? pos.from.cc !== pos.to.cc : false;
  const waitMinutes = pos ? (intl ? 150 : 100) + SELF_TRANSFER_MIN : 0;
  const minutes = baseMin + (pos ? pos.est.minutes : 0);
  const cost = baseCost + (pos ? pos.est.fare + pos.est.taxes : 0);
  const needsHotel = minutes > noHotelMin;
  const hotel = needsHotel ? hotelEstimate(end, ctx.date) : null;
  const score = cost + (hotel ? hotel.cost : 0) + ((minutes + waitMinutes) / 60) * ctx.value;
  const chain = { base, pos, end, kind, minutes, waitMinutes, cost, needsHotel, hotel, score };
  chain.legs = chainLegs(chain, "pre", ctx);
  return chain;
}

// The legs of a chain in travel order. "pre": origin -> ... -> the main flight's
// departure airport. "post": from the main flight's arrival airport -> ... -> the
// destination (a mirror image, built from the destination outwards).
function chainLegs(chain, side, ctx) {
  const base = side === "pre" ? [...chain.base] : [...chain.base].reverse().map(reverseLeg);
  if (!chain.pos) return base;
  const { from: A1, to: A2 } = chain.pos;
  const intl = A1.cc !== A2.cc;
  const between = (A) => waitLeg(A, "Between flights: collect bags & re-check in (separate tickets)", SELF_TRANSFER_MIN, "connect");
  if (side === "pre") {
    const est = chain.pos.est;
    const f = flightLeg(A1, A2, est, "pre");
    return [
      ...base,
      waitLeg(A1, "Airport time before the first flight", intl ? 150 : 100, "checkin"),
      f,
      ...(est.taxes > 0 ? [taxLeg(A1, est, f.id)] : []),
      between(A2),
    ];
  }
  // post: the main flight has landed at A2; fly on to A1, near the destination
  const est = estimate(ctx, A2, A1) ?? chain.pos.est;
  const f = flightLeg(A2, A1, est, "post");
  return [between(A2), f, ...(est.taxes > 0 ? [taxLeg(A2, est, f.id)] : []), waitLeg(A1, "Arrival & baggage", intl ? 60 : 30, "arrive"), ...base];
}

// Best chain per (end airport, needs-hotel) so the cheap option isn't buried.
// Repositioning-flight chains are kept per STARTING airport too: our estimate model
// can't know that a budget airline from Stansted may be far cheaper than a flight
// from Heathrow, so we must not discard the Stansted version before real prices
// have had a chance to look at it.
function keepBest(map, chain) {
  const key = `${chain.end.id}|${chain.needsHotel}|${chain.pos ? chain.pos.from.id : ""}`;
  const cur = map.get(key);
  if (!cur || chain.score < cur.score) map.set(key, chain);
}

// ---- spatial prefilter ------------------------------------------------------------
// With ~4,000 airports, never test them all: a road transfer of N minutes can't
// cover more than ~0.9*N km in a straight line (70 km/h road speed / 1.3 detour),
// so only airports inside that box can possibly fit. Cached per hub.
const windowKm = (minutes) => Math.max(10, minutes * 0.9 + 10);

function within(list, p, km) {
  const dLat = km / 111;
  const dLon = km / (111 * Math.max(0.15, Math.cos((p.lat * Math.PI) / 180)));
  return list.filter((a) => {
    const dl = Math.abs(a.lon - p.lon);
    return Math.abs(a.lat - p.lat) <= dLat && Math.min(dl, 360 - dl) <= dLon;
  });
}

function airportsNear(ctx, p, km) {
  const key = p.id ? `${p.id}|${Math.ceil(km / 25)}` : null; // plain points (the origin/destination) aren't cached
  ctx.airportCache ??= new Map();
  if (key && ctx.airportCache.has(key)) return ctx.airportCache.get(key);
  const out = within(ctx.airports, p, km);
  if (key) ctx.airportCache.set(key, out);
  return out;
}

function gatewaysNear(ctx, p) {
  ctx.gatewayCache ??= new Map();
  if (!ctx.gatewayCache.has(p.id)) ctx.gatewayCache.set(p.id, within(ctx.gateways, p, MAX_POSITIONING_KM));
  return ctx.gatewayCache.get(p.id);
}

// ---- multi-ride helpers -------------------------------------------------------------
// Keep only non-dominated (minutes, cost) labels per hub.
function addLabel(map, hubId, label) {
  const list = map.get(hubId) || [];
  if (list.some((l) => l.minutes <= label.minutes && l.cost <= label.cost)) return;
  const kept = list.filter((l) => !(label.minutes <= l.minutes && label.cost <= l.cost));
  kept.push(label);
  map.set(hubId, kept);
}

function nearbyHubs(ctx, hub) {
  ctx.nearCache ??= new Map();
  if (!ctx.nearCache.has(hub.id)) {
    ctx.nearCache.set(hub.id, ctx.hubs.filter((h) => h.id === hub.id || haversineKm(hub, h) <= TRANSFER_KM));
  }
  return ctx.nearCache.get(hub.id);
}

// A change between two hubs in the same city: same hub = change platforms;
// otherwise a metro/taxi blend.
function transferLeg(a, b) {
  if (a.id === b.id) return { kind: "ground", label: "Change trains", from: a.name, to: b.name, minutes: 12, cost: 0, source: "estimate" };
  const km = haversineKm(a, b);
  if (km < 0.3) return { kind: "ground", label: "Walk", from: a.name, to: b.name, km, minutes: 5, cost: 0, source: "estimate" };
  return {
    kind: "ground", label: "Local transfer (metro/taxi)", from: a.name, to: b.name, km,
    minutes: groundMinutes(km) + 8, cost: round2(3 + 0.9 * km), source: "estimate",
  };
}

// All the ways to get from a point to an airport within `windowMin` minutes of
// travelling: taxi; rides (up to MAX_RIDES) with changes; and - the key idea - ONE
// short flight to another hub.
function chainsToAirports(point, windowMin, noHotelMin, ctx) {
  const best = new Map();
  const groundCache = new Map();
  const ground = (from, to) => {
    const k = `${from.id || from.name}>${to.id}`;
    if (!groundCache.has(k)) groundCache.set(k, groundLeg(from, to, { ownCar: ctx.ownCar }));
    return groundCache.get(k);
  };

  // Direct: taxi/drive straight to an airport.
  for (const A of airportsNear(ctx, point, windowKm(windowMin))) {
    const g = ground(point, A);
    if (g.minutes <= windowMin) keepBest(best, makeChain([g], A, "direct", ctx, noHotelMin));
  }

  // Via one or more rail/bus/ferry rides, with a change between each, then onward
  // to an airport (e.g. Cardiff -> train -> Paddington -> Heathrow Express -> LHR).
  // Breadth-first by number of rides, keeping only non-dominated (cost, minutes)
  // labels at each hub so the work stays small.
  if (ctx.transitModes.length) {
    const allowed = new Set(ctx.transitModes);
    let ready = new Map(); // hubId -> labels: standing at a hub, able to board
    for (const S of ctx.hubs) {
      if (!allowed.has(S.type)) continue;
      const g1 = ground(point, S);
      if (g1.minutes > windowMin) continue;
      addLabel(ready, S.id, { minutes: g1.minutes, cost: g1.cost, legs: [g1], first: S });
    }

    for (let depth = 1; depth <= MAX_RIDES && ready.size; depth++) {
      const arrived = new Map(); // hubId -> labels: just got off a ride here
      for (const [hubId, labels] of ready) {
        const H = ctx.hubsById.get(hubId);
        for (const L of labels) {
          for (const { other: H2, link } of ctx.adj.get(hubId) || []) {
            if (!allowed.has(link.mode)) continue;
            const ride = rideLeg(link, H, H2);
            const minutes = L.minutes + ride.minutes;
            if (minutes > windowMin) continue;
            addLabel(arrived, H2.id, { minutes, cost: L.cost + ride.cost, legs: [...L.legs, ride], first: L.first });
          }
        }
      }

      for (const [hubId, labels] of arrived) {
        const H2 = ctx.hubsById.get(hubId);
        for (const L of labels) {
          for (const A of airportsNear(ctx, H2, windowKm(windowMin - L.minutes))) {
            if (!makesProgress(L.first, H2, A)) continue;
            const g2 = ground(H2, A);
            if (L.minutes + g2.minutes > windowMin) continue;
            keepBest(best, makeChain([...L.legs, g2], A, "transit", ctx, noHotelMin));
          }
        }
      }

      if (depth === MAX_RIDES) break;
      const next = new Map();
      for (const [hubId, labels] of arrived) {
        const H2 = ctx.hubsById.get(hubId);
        for (const H3 of nearbyHubs(ctx, H2)) {
          if (!allowed.has(H3.type)) continue;
          const t = transferLeg(H2, H3);
          for (const L of labels) {
            const minutes = L.minutes + t.minutes;
            if (minutes > windowMin) continue;
            addLabel(next, H3.id, { minutes, cost: L.cost + t.cost, legs: [...L.legs, t], first: L.first });
          }
        }
      }
      ready = next;
    }
  }

  // One short flight to another hub: reach airport A1 within the limit, fly to a
  // gateway A2 (e.g. a budget airline to Milan), and the long flight leaves from A2.
  // The flight time counts toward your X hours; waiting around does not.
  if (ctx.positioning) {
    const starts = [...best.values()]
      .filter((c) => !c.needsHotel && !c.pos)
      .sort((a, b) => a.minutes - b.minutes)
      .slice(0, MAX_HOP_STARTS);
    const hops = [];
    for (const C0 of starts) {
      const A1 = C0.end;
      for (const A2 of gatewaysNear(ctx, A1)) {
        if (A2.id === A1.id) continue;
        const est = estimate(ctx, A1, A2);
        if (!est || C0.minutes + est.minutes > windowMin) continue;
        hops.push(makeChain(C0.base, A2, "flight", ctx, noHotelMin, { from: A1, to: A2, est }));
      }
    }
    for (const c of capHopped(hops)) keepBest(best, c);
  }
  return [...best.values()];
}

// Keep the best repositioning chains overall, but guarantee every starting airport
// its own best few - the estimate model can't tell which airport has the cheap
// budget service, so no starting airport may be crowded out entirely.
function capHopped(hops) {
  if (hops.length <= MAX_HOP_CHAINS) return hops;
  const sorted = [...hops].sort((a, b) => a.score - b.score);
  const keep = new Set();
  const perStart = new Map();
  for (const c of sorted) {
    const n = perStart.get(c.pos.from.id) || 0;
    if (n < MIN_PER_START) {
      keep.add(c);
      perStart.set(c.pos.from.id, n + 1);
    }
  }
  for (const c of sorted) {
    if (keep.size >= MAX_HOP_CHAINS) break;
    keep.add(c);
  }
  return [...keep];
}

function chainsToStations(point, mode, windowMin, noHotelMin, ctx) {
  const out = new Map();
  for (const S of ctx.hubs) {
    if (S.type !== mode) continue;
    const g = groundLeg(point, S, { ownCar: ctx.ownCar });
    if (g.minutes <= windowMin) out.set(S.id, makeChain([g], S, "direct", ctx, noHotelMin));
  }
  return out;
}

// ---- itinerary assembly ---------------------------------------------------------------
function hotelLeg(chain, phase) {
  return {
    kind: "hotel",
    label: `Hotel night near ${chain.end.name}`,
    from: chain.end.name,
    to: chain.end.name,
    city: chain.end.city,
    hubId: chain.end.id,
    phase, // "pre" = the night before departing, "post" = the night after landing
    minutes: 0,
    cost: chain.hotel.cost,
    source: chain.hotel.source,
  };
}

// Points apply to the MAIN flight only (the short hops are cash).
function attachPoints(it, ctx) {
  const main = it.legs.find((l) => l.kind === "flight" && l.role === "main");
  if (!main) {
    it.points = null;
    return;
  }
  const tax = it.legs.find((l) => l.kind === "tax" && l.forFlight === main.id);
  const pts = pointsEstimate(main.cost, `${main.fromCode}:${main.toCode}:${ctx.date}`);
  it.points = { points: pts.points, fees: tax ? tax.cost : 0, cashFare: main.cost, source: pts.source };
}

function finish(itin, opts) {
  const flights = itin.legs.filter((l) => l.kind === "flight");
  itin.totalCost = round2(itin.legs.reduce((s, l) => s + l.cost, 0));
  itin.travelMinutes = itin.legs.reduce((s, l) => s + l.minutes, 0);
  itin.hotelNights = itin.legs.filter((l) => l.kind === "hotel").length;
  itin.hasEstimate = itin.legs.some((l) => l.cost > 0 && l.source !== "live");
  itin.flightCount = flights.length;
  itin.separateTickets = flights.length > 1; // two flights = two tickets, no protection if one is late
  const timeCost = (itin.travelMinutes / 60) * opts.valuePerHour;
  itin.scoreCash = itin.totalCost + timeCost;
  if (itin.points) {
    itin.pointsEffectiveCost = round2(itin.totalCost - itin.points.cashFare + (itin.points.points * opts.pointsCents) / 100);
    itin.scorePoints = itin.pointsEffectiveCost + timeCost;
  } else {
    itin.pointsEffectiveCost = itin.totalCost;
    itin.scorePoints = itin.scoreCash;
  }
  itin.score = opts.rankBy === "points" ? itin.scorePoints : itin.scoreCash;
  return itin;
}

const hoursMinutes = (min) => (Number.isFinite(min) ? `${Math.floor(min / 60)}h${min % 60 ? ` ${Math.round(min % 60)}m` : ""}` : "much longer");

function liveNote(q) {
  const base = q.taxesIncluded ? "Price includes taxes & fees" : "Taxes added separately";
  const s = q.slowerCheaper;
  if (!s) return base;
  const stops = s.stops ? `, ${s.stops} stop${s.stops > 1 ? "s" : ""}` : "";
  return `${base} · a cheaper $${s.fare} option exists but takes ${hoursMinutes(s.minutes)}${stops}`;
}

// The airports a trip visits, in flying order: e.g. ["STN", "MXP", "JFK"].
function routeCodes(pre, A, B, post) {
  return [pre.pos?.from.code, A.code, B.code, post.pos?.from.code].filter(Boolean);
}

function airItinerary(pre, post, opts, ctx) {
  const A = pre.end;
  const B = post.end;
  const est = estimate(ctx, A, B);
  if (!est) return null;
  const intl = A.cc !== B.cc;
  const main = flightLeg(A, B, est, "main");

  const legs = [...pre.legs];
  if (pre.hotel) legs.push(hotelLeg(pre, "pre"));
  legs.push(waitLeg(A, "Check-in & security", intl ? 150 : 100, "checkin"));
  legs.push(main);
  if (est.taxes > 0) legs.push(taxLeg(A, est, main.id));
  legs.push(waitLeg(B, "Arrival & baggage", intl ? 60 : 30, "arrive"));
  if (post.hotel) legs.push(hotelLeg(post, "post"));
  legs.push(...chainLegs(post, "post", ctx));

  const it = { mode: "air", jumpOff: A, landing: B, pre, post, legs, points: null, route: routeCodes(pre, A, B, post) };
  attachPoints(it, ctx);
  return finish(it, opts);
}

function transitItinerary(link, S, S2, pre, post, opts, ctx) {
  const main = rideLeg(link, S, S2);
  const legs = [...pre.legs];
  if (pre.hotel) legs.push(hotelLeg(pre, "pre"));
  legs.push(main);
  if (post.hotel) legs.push(hotelLeg(post, "post"));
  legs.push(...chainLegs(post, "post", ctx));
  return finish({ mode: link.mode, jumpOff: S, landing: S2, pre, post, legs, points: null, route: [] }, opts);
}

// ---- public API ---------------------------------------------------------------------------
export async function search(rawInput, data, deps = {}) {
  const opts = normalize(rawInput);
  const ctx = buildContext(data, opts);
  const { origin, destination } = opts;

  const beforeMin = opts.beforeHours * 60;
  const afterMin = opts.afterHours * 60;
  const preWindow = opts.overnight ? beforeMin * 2 : beforeMin;
  const postWindow = opts.overnight ? afterMin * 2 : afterMin;

  const itineraries = [];

  if (opts.modes.has("air")) {
    const pres = chainsToAirports(origin, preWindow, beforeMin, ctx);
    const posts = chainsToAirports(destination, postWindow, afterMin, ctx);
    for (const pre of pres) {
      for (const post of posts) {
        if (pre.end.id === post.end.id) continue;
        if (pre.pos && post.pos) continue; // at most ONE repositioning flight per trip
        const it = airItinerary(pre, post, opts, ctx);
        if (it) itineraries.push(it);
      }
    }
  }

  for (const mode of ctx.transitModes) {
    const pres = chainsToStations(origin, mode, preWindow, beforeMin, ctx);
    const posts = chainsToStations(destination, mode, postWindow, afterMin, ctx);
    for (const link of data.links) {
      if (link.mode !== mode) continue;
      const a = ctx.hubsById.get(link.a);
      const b = ctx.hubsById.get(link.b);
      if (!a || !b) continue;
      for (const [S, S2] of [[a, b], [b, a]]) {
        const pre = pres.get(S.id);
        const post = posts.get(S2.id);
        if (pre && post) itineraries.push(transitItinerary(link, S, S2, pre, post, opts, ctx));
      }
    }
  }

  // Live pricing (optional). Estimates pick the candidates; real quotes decide.
  const live = { active: false, requested: 0, priced: 0, hotelsPriced: 0, error: null };
  const byScore = (x, y) => x.score - y.score || x.travelMinutes - y.travelMinutes;
  if (deps.livePrices) await refineFlights(itineraries, opts, ctx, deps, live);
  if (deps.liveHotel) await refineHotels(itineraries, opts, ctx, deps, live);

  itineraries.sort(byScore);

  // When live fares are on, only trips whose flights were ALL live-priced may win -
  // an unverified estimate must never beat a real quote. The rest are still shown,
  // clearly labelled, so nothing is hidden.
  const pool = live.active ? itineraries.filter(isVerified) : itineraries;
  const baseline = pickBaseline(pool, opts);
  const picked = dedupe(pool);
  const best = picked[0] || null;
  const baselineKey = baseline ? routeKey(baseline) : null;
  const others = picked.filter((i) => i !== best && routeKey(i) !== baselineKey);
  const unverified = live.active ? dedupe(itineraries.filter((i) => !isVerified(i))) : [];

  const warnings = warn(pool, opts, ctx, origin, destination, preWindow, postWindow, live);

  // Nothing found: don't just say so - find the smallest change that makes a
  // route appear (probing wider windows with the same estimate model).
  let hint = null;
  if (!best && !deps._probe) {
    hint = await findHint(rawInput, data, opts);
    if (hint) {
      // a concrete suggestion replaces the generic "none are linked" sentence
      for (let i = warnings.length - 1; i >= 0; i--) if (/none are linked/.test(warnings[i])) warnings.splice(i, 1);
      warnings.unshift(hintMessage(hint, opts));
    }
  }

  return {
    input: opts,
    best,
    baseline,
    alternatives: others.slice(0, 60),
    overnightOptions: opts.overnight ? picked.filter((i) => i.hotelNights > 0).slice(0, 6) : [],
    unverifiedOptions: unverified.slice(0, 20),
    savings: best && baseline ? round2(baseline.totalCost - best.totalCost) : null,
    minutesSaved: best && baseline ? baseline.travelMinutes - best.travelMinutes : null,
    live,
    hint,
    stats: {
      itineraries: itineraries.length,
      verified: pool.length,
      unverified: itineraries.length - pool.length,
      hubsNearOrigin: countHubs(origin, preWindow, opts, ctx),
      hubsNearDestination: countHubs(destination, postWindow, opts, ctx),
    },
    warnings,
  };
}

// ---- "nothing found" help -----------------------------------------------------------------
const shortName = (p) => String(p?.name || "").split(",")[0].trim() || "there";

// Smallest widening that yields a route: first the "before" window, then the
// "after" window, then both together.
async function findHint(rawInput, data, opts) {
  const probe = async (before, after) => (await search({ ...rawInput, beforeHours: before, afterHours: after }, data, { _probe: true })).best;
  for (let h = opts.beforeHours + 0.5; h <= 12; h += 0.5) {
    const b = await probe(h, opts.afterHours);
    if (b) return { side: "before", hours: h, best: b };
  }
  for (let h = opts.afterHours + 0.5; h <= 12; h += 0.5) {
    const b = await probe(opts.beforeHours, h);
    if (b) return { side: "after", hours: h, best: b };
  }
  for (let h = Math.max(opts.beforeHours, opts.afterHours) + 1; h <= 12; h += 1) {
    const b = await probe(h, h);
    if (b) return { side: "both", hours: h, best: b };
  }
  return null;
}

function hintMessage(hint, opts) {
  const b = hint.best;
  const onward = b.mode === "air" ? `fly to ${b.landing.name}` : `continue to ${b.landing.name}`;
  const h = `${hint.hours}h`;
  if (hint.side === "before") return `Nothing connects within ${opts.beforeHours}h of ${shortName(opts.origin)}. Allow ${h} of travel and you could reach ${b.jumpOff.name} and ${onward}.`;
  if (hint.side === "after") return `Nothing connects within ${opts.afterHours}h of ${shortName(opts.destination)}. Allow ${h} and you could land at ${b.landing.name} (from ${b.jumpOff.name}).`;
  return `Nothing connects with ${opts.beforeHours}h at the start / ${opts.afterHours}h at the end. Allow about ${h} at both ends and ${b.jumpOff.name} → ${b.landing.name} becomes possible.`;
}

// ---- live pricing -------------------------------------------------------------------------------
// Every flight in a trip - the main one AND any short repositioning flights - must
// be live-priced for the trip to count as verified.
const isVerified = (it) => it.mode !== "air" || it.legs.filter((l) => l.kind === "flight").every((l) => l.source === "live");

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Pairs of airports to price, per role. Providers charge per search, so each group
// goes in ONE batched request, capped (what a request can carry / what we can afford).
const GROUP_LIMITS = { main: { pairs: 20, airports: 8 }, pre: { pairs: 16, airports: 8 }, post: { pairs: 16, airports: 8 } };
const HOP_STARTS = 4; // origin-side airports to try a repositioning flight from
const HOP_HUBS = 4; // hub airports to try repositioning flights to

function newGroup(name) {
  return { name, limits: GROUP_LIMITS[name], pairs: new Map(), from: new Set(), to: new Set() };
}
function groupFits(g, f) {
  if (g.pairs.has(`${f.fromCode}-${f.toCode}`)) return true;
  return g.pairs.size < g.limits.pairs && (g.from.has(f.fromCode) || g.from.size < g.limits.airports) && (g.to.has(f.toCode) || g.to.size < g.limits.airports);
}
function groupAdd(g, f) {
  g.pairs.set(`${f.fromCode}-${f.toCode}`, { from: f.fromCode, to: f.toCode, expected: f.expected });
  g.from.add(f.fromCode);
  g.to.add(f.toCode);
}

function liveFlightLeg(leg, q) {
  const stops = q.stops === 0 ? "nonstop" : Number.isFinite(q.stops) ? `${q.stops} stop${q.stops > 1 ? "s" : ""}` : "";
  const head = leg.role === "main" ? "Flight" : "Short flight";
  return {
    ...leg,
    label: [head, q.airline, stops].filter(Boolean).join(" · ") + (leg.role === "main" ? "" : " (separate ticket)"),
    minutes: q.minutes ?? leg.minutes,
    cost: q.fare,
    source: "live",
    stops: q.stops,
    note: liveNote(q),
  };
}

function applyQuotes(it, byKey, opts, ctx) {
  const quoted = new Map();
  for (const l of it.legs) {
    if (l.kind !== "flight") continue;
    const q = byKey.get(`${l.fromCode}-${l.toCode}`);
    if (q) quoted.set(l.id, q);
  }
  if (!quoted.size) return it;
  const legs = [];
  for (const l of it.legs) {
    if (l.kind === "flight" && quoted.has(l.id)) legs.push(liveFlightLeg(l, quoted.get(l.id)));
    else if (l.kind === "tax" && quoted.get(l.forFlight)?.taxesIncluded) continue; // live all-in fare already has the taxes
    else legs.push(l);
  }
  const next = { ...it, legs };
  attachPoints(next, ctx);
  return finish(next, opts);
}

async function refineFlights(itineraries, opts, ctx, deps, live) {
  const K = deps.liveTopK ?? 10;
  const air = itineraries.filter((i) => i.mode === "air").sort((x, y) => x.score - y.score);
  const groups = { main: newGroup("main"), pre: newGroup("pre"), post: newGroup("post") };
  const flightsOf = (it) => it.legs.filter((l) => l.kind === "flight");
  const tryAdd = (it, force) => {
    const flights = flightsOf(it);
    if (!force && !flights.every((f) => groupFits(groups[f.side], f))) return false;
    for (const f of flights) groupAdd(groups[f.side], f);
    return true;
  };

  // 1. The direct baseline always goes first, so the comparison is apples to apples.
  let chosen = 0;
  const base = pickBaseline(air, opts);
  if (base && tryAdd(base, true)) chosen++;

  // 2. Plain trips (a taxi/train to one airport, one flight), best-estimate first.
  //    Small airports often have no service on a route, so they get at most 2 slots.
  const candidates = dedupe(air);
  const isSmall = (it) => [it.jumpOff, it.landing, it.pre.pos?.from, it.post.pos?.from].some((h) => h && h.tier === 3);
  let smallPairs = 0;
  for (const it of candidates) {
    if (chosen >= K + 1) break;
    if (it.pre.pos || it.post.pos) continue;
    if (isSmall(it) && smallPairs >= 2) continue;
    if (tryAdd(it, false)) {
      chosen++;
      if (isSmall(it)) smallPairs++;
    }
  }

  // 3. Repositioning-flight trips. The estimate model can't know a budget airline
  //    might be dirt cheap, so instead of trusting its ranking we price a GRID:
  //    the few nearest starting airports x the few best hub airports. (The proxy
  //    returns every pair Google has for that grid, so this costs one request.)
  const hopped = candidates.filter((i) => (i.pre.pos || i.post.pos) && !isSmall(i));
  for (const side of ["pre", "post"]) {
    const ofSide = hopped.filter((i) => i[side].pos);
    const hubs = [];
    for (const it of ofSide) {
      if (hubs.length >= HOP_HUBS) break;
      if (!hubs.includes(it.jumpOff.id === it[side].end.id ? it[side].end.id : it[side].end.id)) hubs.push(it[side].end.id);
    }
    const starts = [...new Map(ofSide.map((i) => [i[side].pos.from.id, i[side].base.reduce((s, l) => s + l.minutes, 0)])).entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, HOP_STARTS)
      .map(([id]) => id);
    for (const it of ofSide) {
      if (!hubs.includes(it[side].end.id) || !starts.includes(it[side].pos.from.id)) continue;
      tryAdd(it, false);
    }
  }

  const byKey = new Map();
  let mainPriced = 0;
  await Promise.all(
    Object.values(groups)
      .filter((g) => g.pairs.size)
      .map(async (g) => {
        live.requested += g.pairs.size;
        try {
          // `group` lets the caller tune cost: only the main flight is worth gap-fill lookups
          const rows = await deps.livePrices([...g.pairs.values()], ctx.date, { group: g.name });
          for (const r of rows || []) {
            if (!Number.isFinite(r?.fare)) continue;
            byKey.set(`${r.from}-${r.to}`, r);
            live.priced++;
            if (g.name === "main") mainPriced++;
          }
        } catch (e) {
          live.error = live.error || e?.message || String(e);
        }
      })
  );
  if (!mainPriced) return; // nothing trustworthy: stay on estimates (and say so)
  live.active = true;

  for (let i = 0; i < itineraries.length; i++) {
    if (itineraries[i].mode === "air") itineraries[i] = applyQuotes(itineraries[i], byKey, opts, ctx);
  }
}

// Live hotel rates for the few overnight options that matter, applied to every
// itinerary that uses the same hub/side so numbers stay consistent.
async function refineHotels(itineraries, opts, ctx, deps, live) {
  if (!ctx.date) return;
  const N = deps.liveHotelTop ?? 3; // each lookup costs a search
  const pool = (live.active ? itineraries.filter(isVerified) : itineraries)
    .filter((i) => i.hotelNights > 0)
    .sort((x, y) => x.score - y.score);

  const lookups = new Map();
  for (const it of dedupe(pool).slice(0, N)) {
    for (const leg of it.legs) if (leg.kind === "hotel") lookups.set(`${leg.hubId}|${leg.phase}`, leg);
  }
  const rates = new Map();
  await Promise.all(
    [...lookups.entries()].map(async ([key, leg]) => {
      try {
        const checkIn = leg.phase === "pre" ? addDays(ctx.date, -1) : ctx.date;
        const r = await deps.liveHotel(ctx.hubsById.get(leg.hubId), checkIn, addDays(checkIn, 1));
        if (r && Number.isFinite(r.nightly) && r.nightly > 0) rates.set(key, r);
      } catch {
        /* a failed hotel lookup just leaves the estimate in place */
      }
    })
  );
  live.hotelsPriced = rates.size;
  if (!rates.size) return;

  for (const it of itineraries) {
    let changed = false;
    for (const leg of it.legs) {
      const r = leg.kind === "hotel" ? rates.get(`${leg.hubId}|${leg.phase}`) : null;
      if (r) {
        leg.cost = Math.round(r.nightly);
        leg.source = "live";
        leg.note = r.name ? `Typical cheaper room: ${r.name}` : undefined;
        changed = true;
      }
    }
    if (changed) finish(it, opts);
  }
}

// ---- diagnostics + selection ------------------------------------------------------------------------
function countHubs(point, windowMin, opts, ctx) {
  const wanted = new Set(opts.modes);
  return ctx.hubs.filter(
    (h) => wanted.has(h.type) && groundLeg(point, h, { ownCar: ctx.ownCar }).minutes <= windowMin
  ).length;
}

function warn(itineraries, opts, ctx, origin, destination, preWindow, postWindow, live) {
  const out = [];
  if (live.error) out.push(`Live prices were unavailable (${live.error}) — showing estimates instead.`);
  else if (live.requested > 0 && live.priced === 0) out.push("The live price provider returned no fares for these routes — showing estimates instead.");
  const a = countHubs(origin, preWindow, opts, ctx);
  const b = countHubs(destination, postWindow, opts, ctx);
  const nearest = (point) =>
    ctx.hubs
      .filter((h) => opts.modes.has(h.type))
      .map((h) => ({ h, m: groundLeg(point, h, { ownCar: ctx.ownCar }).minutes }))
      .filter((x) => x.m <= 12 * 60) // beyond ~12h by road it's just not this area
      .sort((x, y) => x.m - y.m)
      .slice(0, 3)
      .map((x) => `${x.h.name} (${hoursMinutes(x.m)} by road)`)
      .join(", ");
  if (a === 0) out.push(`No departure point within ${opts.beforeHours}h of ${shortName(origin)}. Nearest in the built-in data: ${nearest(origin) || "none — this area isn't covered yet"}.`);
  if (b === 0) out.push(`No arrival point within ${opts.afterHours}h of ${shortName(destination)}. Nearest in the built-in data: ${nearest(destination) || "none — this area isn't covered yet"}.`);
  if (a > 0 && b > 0 && itineraries.length === 0) out.push("Departure and arrival points were found, but none are linked by the selected travel modes (flights need an airport at both ends; trains, buses and ferries need stations on a known route).");
  return out;
}

// Direct baseline: best itinerary using only local (<= 90 min) hubs at both
// ends, no hotel, no repositioning flight. Falls back to the closest-hub
// itinerary when nothing local connects.
function pickBaseline(itineraries, opts) {
  // "Local" is about TIME, not method: reaching Heathrow by Heathrow Express is
  // still just leaving from your local hub. (Jump-offs like Paris-via-Eurostar
  // take far longer, so they never qualify.)
  const plain = itineraries.filter((i) => !i.pre.pos && !i.post.pos);
  const local = plain.filter((i) => i.pre.minutes <= LOCAL_MINUTES && i.post.minutes <= LOCAL_MINUTES && !i.pre.needsHotel && !i.post.needsHotel);
  if (local.length) return { ...local.sort((x, y) => x.score - y.score)[0], fallback: false };
  if (plain.length) {
    const nearest = [...plain].sort((x, y) => x.pre.minutes + x.post.minutes - (y.pre.minutes + y.post.minutes) || x.score - y.score)[0];
    return { ...nearest, fallback: true };
  }
  return null;
}

// One entry per distinct journey (route + hotel pattern), best first.
const routeKey = (it) => `${it.mode}|${it.pre.pos?.from.id || ""}|${it.jumpOff.id}|${it.landing.id}|${it.post.pos?.from.id || ""}|${it.pre.needsHotel}|${it.post.needsHotel}`;

function dedupe(sorted) {
  const seen = new Set();
  const out = [];
  for (const it of sorted) {
    const key = routeKey(it);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}
