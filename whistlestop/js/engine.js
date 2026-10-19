// Whistlestop search engine.
//
// An itinerary is   PRE-CHAIN  ->  MAIN LEG  ->  POST-CHAIN
//   pre-chain : origin -> a jump-off hub. Ground transfer, optionally with one
//               rail/bus/ferry ride in the middle (e.g. taxi -> Eurostar ->
//               taxi to CDG). Total time must fit in your "before" window.
//   main leg  : a flight between two airports, OR a rail/bus/ferry route.
//   post-chain: landing hub -> destination, same idea, "after" window.
// With overnight allowed the windows double, and anything beyond the plain
// window gets a hotel night at that end (cost shown on its own line).
//
// The "direct" baseline is the best itinerary that only uses hubs close to
// you (<= 90 min) at both ends, so every option is measured against simply
// leaving from your local hub.
//
// Pure ESM - runs in the browser and under `node --test`.
import { groundLeg, haversineKm, round2 } from "./geo.js";
import { flightEstimate, linkEstimate, hotelEstimate, pointsEstimate } from "./pricing.js";

export const MODES = ["air", "rail", "bus", "ferry"];
export const LOCAL_MINUTES = 90;

const clamp = (v, lo, hi, dflt) => (Number.isFinite(+v) && v !== "" && v !== null ? Math.min(hi, Math.max(lo, +v)) : dflt);

export function normalize(input) {
  return {
    origin: input.origin,
    destination: input.destination,
    date: input.date || "",
    beforeHours: clamp(input.beforeHours, 0.25, 12, 2),
    afterHours: clamp(input.afterHours, 0.25, 12, 1),
    modes: new Set((input.modes || MODES).filter((m) => MODES.includes(m))),
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
  return {
    hubs: data.hubs,
    hubsById,
    adj,
    airports: data.hubs.filter((h) => h.type === "air"),
    transitModes: ["rail", "bus", "ferry"].filter((m) => opts.modes.has(m)),
    date: opts.date,
    ownCar: opts.ownCar,
    value: opts.valuePerHour,
  };
}

const reverseLeg = (l) => ({ ...l, from: l.to, to: l.from });

function rideLeg(link, from, to, date) {
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

// A rail/bus/ferry ride inside a chain only makes sense if it carries you
// meaningfully closer to the airport (otherwise you'd ride away and back).
export function makesProgress(S, S2, A) {
  return haversineKm(S2, A) <= 0.7 * haversineKm(S, A);
}

// ---- Chains: origin point <-> a hub ------------------------------------
function makeChain(legs, end, kind, ctx, noHotelMin) {
  const minutes = legs.reduce((s, l) => s + l.minutes, 0);
  const cost = legs.reduce((s, l) => s + l.cost, 0);
  const needsHotel = minutes > noHotelMin;
  const hotel = needsHotel ? hotelEstimate(end, ctx.date) : null;
  const score = cost + (hotel ? hotel.cost : 0) + (minutes / 60) * ctx.value;
  return { legs, end, kind, minutes, cost, needsHotel, hotel, score };
}

// Best chain per (end hub, needs-hotel) so the cheap option isn't buried.
function keepBest(map, chain) {
  const key = `${chain.end.id}|${chain.needsHotel}`;
  const cur = map.get(key);
  if (!cur || chain.score < cur.score) map.set(key, chain);
}

function chainsToAirports(point, windowMin, noHotelMin, ctx) {
  const best = new Map();
  const groundCache = new Map();
  const ground = (from, to) => {
    const k = `${from.id || from.name}>${to.id}`;
    if (!groundCache.has(k)) groundCache.set(k, groundLeg(from, to, { ownCar: ctx.ownCar }));
    return groundCache.get(k);
  };

  // Direct: taxi/drive straight to an airport.
  for (const A of ctx.airports) {
    const g = ground(point, A);
    if (g.minutes <= windowMin) keepBest(best, makeChain([g], A, "direct", ctx, noHotelMin));
  }

  // Via one rail/bus/ferry ride, then onward to an airport.
  for (const mode of ctx.transitModes) {
    for (const S of ctx.hubs) {
      if (S.type !== mode) continue;
      const g1 = ground(point, S);
      if (g1.minutes > windowMin) continue;
      for (const { other: S2, link } of ctx.adj.get(S.id) || []) {
        if (link.mode !== mode) continue;
        const ride = rideLeg(link, S, S2, ctx.date);
        if (g1.minutes + ride.minutes > windowMin) continue;
        for (const A of ctx.airports) {
          if (!makesProgress(S, S2, A)) continue;
          const g2 = ground(S2, A);
          if (g1.minutes + ride.minutes + g2.minutes > windowMin) continue;
          keepBest(best, makeChain([g1, ride, g2], A, "transit", ctx, noHotelMin));
        }
      }
    }
  }
  return [...best.values()];
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

// ---- Itinerary assembly -------------------------------------------------
function hotelLeg(chain) {
  return {
    kind: "hotel",
    label: `Hotel night near ${chain.end.name}`,
    from: chain.end.name,
    to: chain.end.name,
    city: chain.end.city,
    minutes: 0,
    cost: chain.hotel.cost,
    source: chain.hotel.source,
  };
}

function finish(itin, opts) {
  itin.totalCost = round2(itin.legs.reduce((s, l) => s + l.cost, 0));
  itin.travelMinutes = itin.legs.reduce((s, l) => s + l.minutes, 0);
  itin.hotelNights = itin.legs.filter((l) => l.kind === "hotel").length;
  itin.hasEstimate = itin.legs.some((l) => l.cost > 0 && l.source !== "live");
  const timeCost = (itin.travelMinutes / 60) * opts.valuePerHour;
  itin.scoreCash = itin.totalCost + timeCost;
  if (itin.points) {
    itin.pointsEffectiveCost = round2(
      itin.totalCost - itin.points.cashFare + (itin.points.points * opts.pointsCents) / 100
    );
    itin.scorePoints = itin.pointsEffectiveCost + timeCost;
  } else {
    itin.pointsEffectiveCost = itin.totalCost;
    itin.scorePoints = itin.scoreCash;
  }
  itin.score = opts.rankBy === "points" ? itin.scorePoints : itin.scoreCash;
  return itin;
}

function airItinerary(pre, post, opts, ctx, live) {
  const A = pre.end;
  const B = post.end;
  const est = flightEstimate(A, B, ctx.date);
  if (!est) return null;

  const intl = A.cc !== B.cc;
  const fare = live ? live.fare : est.fare;
  const minutes = live?.minutes ?? est.minutes;
  const taxes = live ? (live.taxesIncluded ? 0 : est.taxes) : est.taxes;
  const source = live ? "live" : est.source;

  const legs = [...pre.legs];
  if (pre.hotel) legs.push(hotelLeg(pre));
  legs.push({ kind: "wait", label: "Check-in & security", from: A.name, to: A.name, minutes: intl ? 150 : 100, cost: 0, source: "estimate" });
  legs.push({ kind: "flight", label: "Flight", from: A.name, to: B.name, fromCode: A.code, toCode: B.code, fromCity: A.city, toCity: B.city, km: est.km, minutes, cost: fare, source });
  if (taxes > 0) {
    legs.push({
      kind: "tax",
      label: `Departure taxes & fees (${A.cc})`,
      from: A.name, to: A.name, minutes: 0, cost: taxes, source: live ? "live" : "estimate",
    });
  }
  legs.push({ kind: "wait", label: "Arrival & baggage", from: B.name, to: B.name, minutes: intl ? 60 : 30, cost: 0, source: "estimate" });
  if (post.hotel) legs.push(hotelLeg(post));
  legs.push(...[...post.legs].reverse().map(reverseLeg));

  const pts = pointsEstimate(fare, `${A.id}:${B.id}:${ctx.date}`);
  return finish(
    {
      mode: "air",
      jumpOff: A,
      landing: B,
      pre,
      post,
      legs,
      points: { points: pts.points, fees: taxes, cashFare: fare, source: pts.source },
    },
    opts
  );
}

function transitItinerary(link, S, S2, pre, post, opts, ctx) {
  const main = rideLeg(link, S, S2, ctx.date);
  const legs = [...pre.legs];
  if (pre.hotel) legs.push(hotelLeg(pre));
  legs.push(main);
  if (post.hotel) legs.push(hotelLeg(post));
  legs.push(...[...post.legs].reverse().map(reverseLeg));
  return finish({ mode: link.mode, jumpOff: S, landing: S2, pre, post, legs, points: null }, opts);
}

// ---- Public API ---------------------------------------------------------
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
        const it = airItinerary(pre, post, opts, ctx, null);
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

  // Optional live refinement: re-price the most promising flights with real
  // fares, then re-rank. Without a provider everything stays an estimate.
  if (deps.livePrice) await refineWithLive(itineraries, opts, ctx, deps);

  itineraries.sort((x, y) => x.score - y.score || x.travelMinutes - y.travelMinutes);

  const baseline = pickBaseline(itineraries, opts);
  const picked = dedupe(itineraries);
  const best = picked[0] || null;

  return {
    input: opts,
    best,
    baseline,
    alternatives: picked.slice(1, 13),
    overnightOptions: opts.overnight ? picked.filter((i) => i.hotelNights > 0).slice(0, 6) : [],
    savings: best && baseline ? round2(baseline.totalCost - best.totalCost) : null,
    minutesSaved: best && baseline ? baseline.travelMinutes - best.travelMinutes : null,
    stats: {
      itineraries: itineraries.length,
      hubsNearOrigin: countHubs(origin, preWindow, opts, ctx),
      hubsNearDestination: countHubs(destination, postWindow, opts, ctx),
    },
    warnings: warn(itineraries, opts, ctx, origin, destination, preWindow, postWindow),
  };
}

function countHubs(point, windowMin, opts, ctx) {
  const wanted = new Set(opts.modes);
  return ctx.hubs.filter(
    (h) => wanted.has(h.type) && groundLeg(point, h, { ownCar: ctx.ownCar }).minutes <= windowMin
  ).length;
}

function warn(itineraries, opts, ctx, origin, destination, preWindow, postWindow) {
  const out = [];
  const a = countHubs(origin, preWindow, opts, ctx);
  const b = countHubs(destination, postWindow, opts, ctx);
  if (a === 0) out.push("No supported hubs found within your 'before' window of the origin — try more hours or more modes, or the area may not be in the built-in dataset yet.");
  if (b === 0) out.push("No supported hubs found within your 'after' window of the destination — try more hours or more modes, or the area may not be in the built-in dataset yet.");
  if (a > 0 && b > 0 && itineraries.length === 0) out.push("Hubs were found on both ends but no route connects them with the selected modes.");
  return out;
}

// Direct baseline: best itinerary using only local (<= 90 min) hubs at both
// ends, no hotel. Falls back to the closest-hub itinerary when nothing local
// connects.
function pickBaseline(itineraries, opts) {
  const direct = itineraries.filter((i) => i.pre.kind === "direct" && i.post.kind === "direct");
  const local = direct.filter((i) => i.pre.minutes <= LOCAL_MINUTES && i.post.minutes <= LOCAL_MINUTES && !i.pre.needsHotel && !i.post.needsHotel);
  if (local.length) return { ...local.sort((x, y) => x.score - y.score)[0], fallback: false };
  if (direct.length) {
    const nearest = [...direct].sort((x, y) => x.pre.minutes + x.post.minutes - (y.pre.minutes + y.post.minutes) || x.score - y.score)[0];
    return { ...nearest, fallback: true };
  }
  return null;
}

// One entry per (mode, jump-off, landing, hotel pattern), best first.
function dedupe(sorted) {
  const seen = new Set();
  const out = [];
  for (const it of sorted) {
    const key = `${it.mode}|${it.jumpOff.id}|${it.landing.id}|${it.pre.needsHotel}|${it.post.needsHotel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

async function refineWithLive(itineraries, opts, ctx, deps) {
  const K = deps.liveTopK ?? 8;
  const candidates = dedupe([...itineraries].sort((x, y) => x.score - y.score)).filter((i) => i.mode === "air").slice(0, K);
  const pairs = new Map();
  for (const it of candidates) pairs.set(`${it.jumpOff.id}>${it.landing.id}`, it);

  await Promise.all(
    [...pairs.values()].map(async (it) => {
      try {
        const live = await deps.livePrice(it.jumpOff, it.landing, ctx.date);
        if (!live || !Number.isFinite(live.fare)) return;
        for (let i = 0; i < itineraries.length; i++) {
          const cur = itineraries[i];
          if (cur.mode !== "air" || cur.jumpOff.id !== it.jumpOff.id || cur.landing.id !== it.landing.id) continue;
          const rebuilt = airItinerary(cur.pre, cur.post, opts, ctx, live);
          if (rebuilt) itineraries[i] = rebuilt;
        }
      } catch {
        /* a failed live lookup just leaves the estimate in place */
      }
    })
  );
}
