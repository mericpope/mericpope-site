// Points (miles) alongside dollars - from prices YOU enter.
//
// Whistlestop cannot read award prices: Delta and the other programs don't publish them in a form anyone
// may collect automatically, and Google Flights (our price source) doesn't show them. So the points price
// of a flight is typed in by you - "New York to London: 21,200 SkyMiles + $6" - kept in this browser, and
// used everywhere that flight appears. This module is the arithmetic around that:
//
//   - which saved award prices match a flight leg
//   - every way to pay for a trip: all cash, or points on the legs you have a points price for,
//     limited by your balances, valued either at a cents-per-point figure or as already paid for ("sunk")
//   - the cheapest mix, in cash and in cash-plus-valued-points.
//
// A points price is per traveller: it is only applied to one-traveller trips.

export const PROGRAMS = [
  "Delta SkyMiles", "American AAdvantage", "United MileagePlus", "Alaska Mileage Plan", "JetBlue TrueBlue", "Southwest Rapid Rewards",
  "British Airways Avios", "Iberia Avios", "Aer Lingus AerClub", "Virgin Atlantic Flying Club", "Air Canada Aeroplan",
  "Air France-KLM Flying Blue", "Lufthansa Miles & More", "Turkish Miles&Smiles", "Qatar Privilege Club", "Emirates Skywards",
  "Singapore KrisFlyer", "Cathay Asia Miles", "JAL Mileage Bank", "Qantas Frequent Flyer", "Finnair Plus",
];

export const DEFAULT_CPP = 1.2; // cents per point when you haven't said
const MAX_CHOICES_PER_LEG = 3; // the cheapest few award prices per leg are considered
const round2 = (n) => Math.round(n * 100) / 100;

export function emptyPoints() {
  return { awards: [], balances: {}, cpp: {}, sunk: false };
}

// ---- award prices ---------------------------------------------------------------------------------
export function parseAward(input) {
  const program = String(input?.program ?? "").trim().replace(/\s+/g, " ");
  if (!program || program.length > 40) throw new Error("Say which program the points are in (for example Delta SkyMiles).");
  const from = String(input?.from ?? "").trim().toUpperCase();
  const to = String(input?.to ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) throw new Error("A points price belongs to a flight between two airports.");
  const points = Math.round(Number(input?.points));
  if (!Number.isFinite(points) || points <= 0 || points > 2_000_000) throw new Error("Enter the points price, for example 21200.");
  const feesRaw = input?.fees === "" || input?.fees == null ? 0 : Number(input.fees);
  if (!Number.isFinite(feesRaw) || feesRaw < 0 || feesRaw > 5000) throw new Error("Enter the cash taxes and fees in dollars (0 if none).");
  const date = input?.date ? String(input.date) : "";
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("The date should look like 2026-12-06.");
  return { id: `${program}|${from}|${to}|${date || "any"}`, program, from, to, date, points, fees: round2(feesRaw), note: String(input?.note ?? "").slice(0, 120) };
}

export function addAward(state, input) {
  const a = parseAward(input);
  return { ...state, awards: [...state.awards.filter((x) => x.id !== a.id), a] }; // same program/route/date replaces the old price
}

export const removeAward = (state, id) => ({ ...state, awards: state.awards.filter((x) => x.id !== id) });

export function setBalance(state, program, points) {
  const p = String(program || "").trim();
  if (!p) return state;
  const n = Math.max(0, Math.round(Number(points) || 0));
  return { ...state, balances: { ...state.balances, [p]: n } };
}

export function removeBalance(state, program) {
  const balances = { ...state.balances };
  delete balances[program];
  return { ...state, balances };
}

export const legDate = (leg) => leg.date || (leg.departs ? String(leg.departs).slice(0, 10) : "");

/** Saved award prices that apply to this flight leg: same airports, and the same day when the price names one. */
export function awardsForLeg(leg, awards) {
  if (!leg || leg.kind !== "flight") return [];
  const day = legDate(leg);
  return awards
    .filter((a) => a.from === leg.fromCode && a.to === leg.toCode && (!a.date || !day || a.date === day))
    .sort((x, y) => x.points - y.points);
}

// ---- ways to pay ----------------------------------------------------------------------------------
/**
 * Every way to pay for itinerary `it` using the saved award prices, and the best of them.
 * settings: { balances, cpp (per program, cents), defaultCpp, sunk }
 *  - a program with a balance entered can only be used up to that balance; a program with none entered is
 *    assumed to be enough (flagged `assumesBalance`)
 *  - sunk: points count as $0 (they are already paid for); otherwise each point is worth cpp cents
 */
export function pointsOptions(it, awards, settings = {}) {
  const cppFor = (program) => Number(settings.cpp?.[program]) > 0 ? Number(settings.cpp[program]) : Number(settings.defaultCpp) > 0 ? Number(settings.defaultCpp) : DEFAULT_CPP;
  const flights = it.legs.map((leg, index) => ({ leg, index })).filter((x) => x.leg.kind === "flight");
  const per = flights
    .map(({ leg, index }) => ({ leg, index, choices: awardsForLeg(leg, awards).slice(0, MAX_CHOICES_PER_LEG) }))
    .filter((x) => x.choices.length);
  const none = { has: false, allCash: round2(it.totalCost), options: [], bestCash: null, bestEffective: null };
  if (!per.length) return none;

  const balances = settings.balances || {};
  const options = [];
  const walk = (k, picked) => {
    if (k === per.length) {
      if (picked.every((p) => !p)) return; // all cash is the baseline, not an option
      const used = {};
      let cash = it.totalCost;
      let value = 0;
      let assumesBalance = false;
      picked.forEach((a, j) => {
        if (!a) return;
        cash = cash - per[j].leg.cost + a.fees;
        used[a.program] = (used[a.program] || 0) + a.points;
        value += (a.points * cppFor(a.program)) / 100;
      });
      for (const [program, n] of Object.entries(used)) {
        if (balances[program] === undefined) assumesBalance = true;
        else if (n > balances[program]) return; // you can't afford this mix
      }
      options.push({
        legs: picked.map((a, j) => ({ index: per[j].index, leg: per[j].leg, award: a || null })),
        cash: round2(cash),
        points: used,
        pointsTotal: Object.values(used).reduce((s, n) => s + n, 0),
        value: round2(value),
        effective: round2(cash + (settings.sunk ? 0 : value)),
        assumesBalance,
      });
      return;
    }
    for (const c of [null, ...per[k].choices]) walk(k + 1, [...picked, c]);
  };
  walk(0, []);
  if (!options.length) return { ...none, has: true, affordable: false, awardLegs: per.length };
  const by = (key) => options.reduce((best, o) => (!best || o[key] < best[key] || (o[key] === best[key] && o.pointsTotal < best.pointsTotal) ? o : best), null);
  options.sort((a, b) => a.effective - b.effective || a.cash - b.cash);
  return { has: true, affordable: true, awardLegs: per.length, allCash: round2(it.totalCost), options, bestCash: by("cash"), bestEffective: by("effective") };
}

/** The number to rank a trip by when ranking "using my points": its best effective cost, else its cash price. */
export const pointsRank = (it, awards, settings) => {
  const p = pointsOptions(it, awards, settings);
  return p.bestEffective ? Math.min(p.bestEffective.effective, it.totalCost) : it.totalCost;
};

/** Short text for a mix: "21,200 Delta SkyMiles + $6 cash fees". */
export function describeOption(o) {
  return Object.entries(o.points).map(([program, n]) => `${n.toLocaleString("en-US")} ${program}`).join(" + ");
}

// ---- storage (this browser only) --------------------------------------------------------------------
export const STORE_KEY = "whistlestop:points:v1";

export function loadPoints(storage) {
  try {
    const raw = JSON.parse(storage.getItem(STORE_KEY) || "null");
    if (!raw || typeof raw !== "object") return emptyPoints();
    const awards = [];
    for (const a of Array.isArray(raw.awards) ? raw.awards : []) {
      try { awards.push(parseAward(a)); } catch { /* skip a damaged entry */ }
    }
    const numbers = (o) => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).filter(([k, v]) => k && Number.isFinite(Number(v)) && Number(v) >= 0).map(([k, v]) => [k, Number(v)]));
    return { awards, balances: numbers(raw.balances), cpp: numbers(raw.cpp), sunk: raw.sunk === true };
  } catch {
    return emptyPoints();
  }
}

export function savePoints(storage, state) {
  try { storage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage is optional */ }
}
