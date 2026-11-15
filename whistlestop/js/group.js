// The group planner: people who start in different places and want to arrive together.
//
//   "A needs to get to Venice, B is already in London. Is it cheaper for A to fly to London and then
//    both fly to Venice together, or for A to fly to Venice and B to fly there separately?"
//
// It reuses the one-person engine and joins the results:
//
//   Separate  = A's cheapest trip to the destination + B's cheapest trip there.
//   Meet      = A's trip via B's city (B lives there, or hosts), then ONE shared flight to the
//               destination that both are on. The shared flight is priced for both seats, so a fare
//               that needs two open seats is real. B only gets from home to the departure airport.
//
// Version 1: two or more people, one destination and date, one way. Everyone except the person
// travelling furthest must live in the same city (the meeting city). Meeting in a third city, and the
// way home, come later.
import { search } from "./engine.js";
import { haversineKm, groundLeg } from "./geo.js";

export const LOCAL_KM = 100; // "lives in the meeting city": within this distance of the shared airport
const round2 = (n) => Math.round(n * 100) / 100;
const MAX_MEET_PLANS = 8;

// How a local traveller gets from home to the shared flight's airport. Use the SAME ground model their own
// solo search used for that airport (so "separate" and "meet" are compared like for like); if their solo
// search never looked at that airport, fall back to a plain estimate.
function groundToAirport(soloRes, home, Y) {
  const pool = [soloRes?.best, ...(soloRes?.alternatives || []), ...(soloRes?.unverifiedOptions || [])].filter(Boolean);
  const it = pool.find((i) => i.mode === "air" && !i.pre.pos && i.jumpOff?.code === Y.code);
  if (it) {
    const names = [...new Set(it.pre.legs.filter((l) => l.kind !== "wait").map((l) => l.label))].join(", ");
    return { cost: it.pre.cost, minutes: it.pre.minutes, label: names || "Getting to the airport", source: "estimate" };
  }
  const g = groundLeg(home, Y);
  return { cost: g.cost, minutes: g.minutes, label: g.label, source: "estimate" };
}
const shortName = (p) => String(p?.name || "").split(",")[0].trim() || "there";

export async function planGroup(raw, data, deps = {}) {
  const people = (raw.people || []).filter((p) => p?.origin);
  if (people.length < 2) throw new Error("A group needs at least two travellers.");
  if (people.length > 4) throw new Error("The group planner handles up to four travellers.");
  const dest = raw.destination;

  // The traveller with the furthest to go is the one who flies in; the rest are "locals".
  const far = people.reduce((a, b) => (haversineKm(b.origin, dest) > haversineKm(a.origin, dest) ? b : a));
  const locals = people.filter((p) => p !== far);
  const centre = locals[0].origin;
  const sameCity = locals.every((p) => haversineKm(p.origin, centre) <= LOCAL_KM);
  const base = { ...raw, people: undefined, origin: far.origin, travellers: 1, hopTravellers: 1 };
  const notes = [];

  // ---- separate: everyone makes their own way ---------------------------------------------------
  const resFar = await search(base, data, deps);
  const resLocals = [];
  // The people who are already near the destination end don't need a repositioning flight of their own;
  // that keeps the live-search cost down.
  for (const p of locals) {
    // (skip the local searches when the traveller's own search found no real prices: nothing to compare)
    if (deps.livePrices && !resFar.live?.active) { resLocals.push(null); continue; }
    resLocals.push(await search({ ...base, origin: p.origin, stopover: false, positioning: false, freeStay: null }, data, deps));
  }

  const plans = [];
  const bests = [resFar.best, ...resLocals.map((r) => r?.best)];
  if (bests.every(Boolean)) {
    const per = [
      { name: far.name, cost: round2(resFar.best.totalCost), route: resFar.best.route.join(" → "), itinerary: resFar.best },
      ...locals.map((p, i) => ({ name: p.name, cost: round2(resLocals[i].best.totalCost), route: resLocals[i].best.route.join(" → "), itinerary: resLocals[i].best })),
    ];
    plans.push({ kind: "separate", label: `Everyone travels separately and meets in ${shortName(dest)}`, total: round2(per.reduce((s, x) => s + x.cost, 0)), perPerson: per });
  } else {
    notes.push("Not every traveller has a real price for travelling alone, so the separate plan can't be totalled.");
  }

  // ---- meet: fly in to where the others live, then one shared flight ----------------------------
  let resMeet = null;
  if (!sameCity) {
    notes.push("Meeting plans need everyone except the person travelling furthest to live in the same city. Showing separate travel only.");
  } else if (deps.livePrices && !resFar.live?.active) {
    notes.push("No real prices came back, so no meeting plan was worked out.");
  } else {
    const host = locals.find((p) => p.hosts);
    resMeet = await search(
      {
        ...base,
        stopover: true,
        hopTravellers: people.length,
        stopoverNear: { lat: centre.lat, lon: centre.lon, km: LOCAL_KM },
        freeStay: host ? { name: shortName(host.origin), lat: host.origin.lat, lon: host.origin.lon } : raw.freeStay || null,
      },
      data,
      deps
    );
    const pool = [resMeet.best, ...resMeet.alternatives].filter((it) => it && it.post?.pos && haversineKm(centre, it.post.pos.to) <= LOCAL_KM);
    const seen = new Set();
    const meets = [];
    for (const it of pool) {
      const key = `${it.post.pos.to.code}>${it.post.pos.from.code}|${it.hotelNights}`; // meeting airport, destination airport, night or not
      if (seen.has(key)) continue; // pool is cheapest-first, so the first one seen is the cheapest way to that plan
      seen.add(key);
      const hop = it.legs.find((l) => l.kind === "flight" && l.side === "post");
      const shared = hop.cost; // the provider's price for ALL seats on the shared flight
      const Y = it.post.pos.to;
      const grounds = locals.map((p, i) => groundToAirport(resLocals[i], p.origin, Y));
      const total = round2(it.totalCost + grounds.reduce((s, g) => s + g.cost, 0));
      const share = shared / people.length;
      const per = [
        { name: far.name, cost: round2(it.totalCost - shared + share), route: it.route.join(" → "), itinerary: it },
        ...locals.map((p, i) => ({
          name: p.name,
          cost: round2(share + grounds[i].cost),
          route: `${shortName(p.origin)} → ${Y.code}`,
          ground: grounds[i],
          departs: hop.departs || null,
        })),
      ];
      meets.push({
        kind: "meet",
        label: `${far.name} flies to ${shortName(centre)}, then everyone flies to ${shortName(dest)} together${it.hotelNights ? " (a night in between)" : ""}`,
        total,
        perPerson: per,
        meetAirport: Y.code,
        landsAt: it.post.end.code,
        sharedFlight: { from: hop.fromCode, to: hop.toCode, fare: shared, seats: people.length, flightNumber: hop.flightNumber || null, departs: hop.departs || null, airline: hop.airline || null },
        itinerary: it,
      });
    }
    plans.push(...meets.sort((a, b) => a.total - b.total).slice(0, MAX_MEET_PLANS));
    if (!pool.length) notes.push(`No meeting plan through ${shortName(centre)} came back with real prices for ${people.length} seats on the shared flight.`);
  }

  plans.sort((a, b) => a.total - b.total);
  const separate = plans.find((p) => p.kind === "separate") || null;
  const bestMeet = plans.find((p) => p.kind === "meet") || null;
  return {
    people: people.map((p) => p.name),
    far: far.name,
    meetingCity: sameCity ? shortName(centre) : null,
    plans,
    best: plans[0] || null,
    separate,
    bestMeet,
    savings: separate && bestMeet ? round2(separate.total - bestMeet.total) : null,
    notes,
    runs: { far: resFar, locals: resLocals, meet: resMeet },
    live: {
      calls: [resFar, ...resLocals, resMeet].filter(Boolean).reduce((s, r) => s + (r.live?.calls || 0), 0),
      active: !!resFar.live?.active,
    },
  };
}
