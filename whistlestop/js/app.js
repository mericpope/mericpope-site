import { search, searchRoundTrip, returnLeg } from "./engine.js";
import { HUBS, LINKS } from "./data/hubs.js";
import { suggest } from "./places.js";
import { attachCombobox } from "./combobox.js";
import { legLink } from "./links.js";
import { LIVE_PROVIDER_URL } from "./config.js";
import { haversineKm } from "./geo.js";

const $ = (id) => document.getElementById(id);
const els = {
  form: $("form"), from: $("from"), to: $("to"), date: $("date"), before: $("before"), after: $("after"),
  overnight: $("overnight"), positioning: $("positioning"), positioningEnd: $("positioningEnd"), stopoverHours: $("stopoverHours"), stopoverWrap: $("stopoverHoursWrap"), owncar: $("owncar"),
  value: $("value"), cents: $("cents"),
  go: $("go"), status: $("status"), notice: $("notice"), results: $("results"), summary: $("summary"), recent: $("recent"),
  rdate: $("rdate"), returnBox: $("returnBox"), roundbar: $("roundbar"),
  prefs: $("prefs"), prefcount: $("prefcount"), costnote: $("costnote"), livepill: $("livepill"),
  vSearch: $("view-search"), vResults: $("view-results"), vTrip: $("view-trip"),
};
const STORE = "whistlestop:form:v1";
const RECENT = "whistlestop:recent:v1";
const DATA = { hubs: HUBS, links: LINKS };
const BAG_VALUES = ["personal", "carryon", "checked1", "checked2"];
const BAG_LABEL = { personal: "Personal item", carryon: "Cabin bag", checked1: "1 checked bag", checked2: "2 checked bags" };

const getSuggestions = (text, signal) => suggest(text, HUBS, { signal });
const fromBox = attachCombobox(els.from, { getSuggestions });
const toBox = attachCombobox(els.to, { getSuggestions });
const toPoint = (s) => ({ name: s.label, lat: s.lat, lon: s.lon, cc: s.cc });

let places = null; // { origin, destination } once resolved
let view = null; // { res, query, items, filter, sort, showAll }

// ---------- small helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
const num = (n) => Math.round(n).toLocaleString("en-US");
const dur = (min) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} h${m ? ` ${m} m` : ""}` : `${m} m`;
};
const shortName = (p) => (p?.name || "").split(",")[0].trim() || "your location";
const dayLabel = (iso) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
// "2026-12-10 11:05" -> "Thu 10 Dec, 11:05"; with a reference, just the time when it's the same day.
function clock(s, ref) {
  const time = s.slice(11, 16);
  return ref && ref.slice(0, 10) === s.slice(0, 10) ? time : `${dayLabel(s)}, ${time}`;
}
const timeOf = (s) => s.slice(11, 16);
const hoursText = (v) => `${+v} h`;

const I = {
  plane: '<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>',
  train: '<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M8 20l2-3M16 20l-2-3"/></svg>',
  bus: '<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><rect x="4" y="4" width="16" height="13" rx="2"/><path d="M4 11h16M7 20v-3M17 20v-3"/></svg>',
  ferry: '<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M3 17c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0M5 14l1-6h12l1 6M12 8V4"/></svg>',
  car: '<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M5 17h14M6 17l1-6h10l1 6M7 11l1-4h8l1 4"/></svg>',
  bed: '<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/></svg>',
  bag: '<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><rect x="5" y="8" width="14" height="12" rx="2"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  clock: '<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
  chev: '<svg viewBox="0 0 24 24" class="ico chev" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  back: '<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  ext: '<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M8 8h8v8M8 16l8-8"/></svg>',
  edit: '<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4zM13 7l4 4"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};
const kindIcon = (k) => (k === "flight" ? I.plane : k === "rail" ? I.train : k === "bus" ? I.bus : k === "ferry" ? I.ferry : k === "hotel" ? I.bed : I.car);

// ---------- views ----------
function showView(name, { push = true } = {}) {
  els.vSearch.hidden = name !== "search";
  els.vResults.hidden = name !== "results";
  els.vTrip.hidden = name !== "trip";
  if (push) { try { history.pushState({ v: name }, ""); } catch { /* ignore */ } }
  window.scrollTo(0, 0);
}
window.addEventListener("popstate", (e) => {
  const v = e.state?.v || "search";
  showView(v === "results" && !view ? "search" : v === "trip" && !view?.trip ? (view ? "results" : "search") : v, { push: false });
});
try { history.replaceState({ v: "search" }, ""); } catch { /* ignore */ }

// ---------- form state ----------
const modes = () => [...document.querySelectorAll('input[name="mode"]:checked')].map((i) => i.value);
const radio = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;
const setRadio = (name, value) => { document.querySelectorAll(`input[name="${name}"]`).forEach((r) => { r.checked = r.value === value; }); };

const LADDER = [0.25, 0.5, ...Array.from({ length: 23 }, (_, i) => 1 + i * 0.5)];
function setHours(which, v) {
  const nearest = LADDER.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), LADDER[0]);
  els[which].value = String(nearest);
  $(`${which}Out`).textContent = hoursText(nearest);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-step]");
  if (!b) return;
  const which = b.dataset.step;
  const cur = LADDER.reduce((bi, x, i) => (Math.abs(x - +els[which].value) < Math.abs(LADDER[bi] - +els[which].value) ? i : bi), 0);
  setHours(which, LADDER[Math.max(0, Math.min(LADDER.length - 1, cur + Number(b.dataset.dir)))]);
  saveForm();
});

function prefState() {
  return {
    bags: radio("bags") || "personal", overnight: els.overnight.checked, positioning: els.positioning.checked, positioningEnd: els.positioningEnd.checked, stopoverHours: els.stopoverHours.value,
    owncar: els.owncar.checked, value: els.value.value, cents: els.cents.value, rank: radio("rank") || "cash",
    round: radio("triptype") === "round", rdate: els.rdate.value,
  };
}

const addDaysIso = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// The return date: shown for round trips, never before the outbound date.
function syncReturn() {
  const round = radio("triptype") === "round";
  els.returnBox.hidden = !round;
  els.rdate.min = els.date.value || els.date.min;
  if (round && els.date.value && (!els.rdate.value || els.rdate.value < els.date.value)) els.rdate.value = addDaysIso(els.date.value, 7);
}

function updatePrefsUi() {
  const p = prefState();
  const n = [p.bags !== "personal", p.overnight, !p.positioning, p.owncar, +p.value > 0, p.rank === "points"].filter(Boolean).length;
  els.prefcount.textContent = n;
  els.prefcount.hidden = n === 0;
  els.stopoverWrap.hidden = !p.positioningEnd;
  // a stopover prices the long flight to ~30 gateway hubs, then the second flight from those with a real fare:
  // about 8 more searches (14 with a night)
  const oneWay = (p.overnight ? 20 : 13) + (p.positioningEnd ? (p.overnight ? 14 : 8) : 0);
  syncReturn();
  els.costnote.textContent = `About ${p.round ? oneWay * 2 : oneWay} live searches${p.round ? " (both ways)" : ""}`;
}

function saveForm() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      from: els.from.value, to: els.to.value, date: els.date.value, before: els.before.value, after: els.after.value,
      ...prefState(), modes: modes(), fromPlace: fromBox.place, toPlace: toBox.place,
    }));
  } catch { /* storage optional */ }
  updatePrefsUi();
}

function restoreForm() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(STORE) || "null"); } catch { /* ignore */ }
  const soon = new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10);
  els.date.min = new Date().toISOString().slice(0, 10);
  els.date.value = soon;
  setHours("before", s?.before ?? 3);
  setHours("after", s?.after ?? 1.5);
  if (s) {
    els.from.value = s.from ?? ""; els.to.value = s.to ?? "";
    if (s.fromPlace) fromBox.setPlace(s.fromPlace);
    if (s.toPlace) toBox.setPlace(s.toPlace);
    if (s.date && s.date >= els.date.min) els.date.value = s.date;
    setRadio("triptype", s.round ? "round" : "one");
    if (s.rdate && s.rdate >= els.date.value) els.rdate.value = s.rdate;
    els.overnight.checked = !!s.overnight; els.positioning.checked = s.positioning !== false; els.positioningEnd.checked = s.positioningEnd === true; els.owncar.checked = !!s.owncar;
    if ([...els.stopoverHours.options].some((o) => o.value === String(s.stopoverHours))) els.stopoverHours.value = String(s.stopoverHours);
    els.value.value = s.value ?? 0; els.cents.value = s.cents ?? 1.4;
    setRadio("rank", s.rank === "points" ? "points" : "cash");
    setRadio("bags", BAG_VALUES.includes(s.bags) ? s.bags : "personal");
    if (Array.isArray(s.modes)) document.querySelectorAll('input[name="mode"]').forEach((i) => { i.checked = s.modes.includes(i.value); });
  }
  updatePrefsUi();
}

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle("error", isError);
}

// swap From and To
$("swap").addEventListener("click", () => {
  const a = fromBox.place;
  const b = toBox.place;
  const av = els.from.value;
  const bv = els.to.value;
  if (b) fromBox.setPlace(b); else els.from.value = bv;
  if (a) toBox.setPlace(a); else els.to.value = av;
  saveForm();
});

// ---------- recent searches ----------
function loadRecent() { try { return JSON.parse(localStorage.getItem(RECENT) || "[]"); } catch { return []; } }
function saveRecent() {
  if (!places) return;
  const round = radio("triptype") === "round";
  const entry = { from: els.from.value, to: els.to.value, date: els.date.value, round, rdate: round ? els.rdate.value : "", fromPlace: fromBox.place, toPlace: toBox.place };
  const list = [entry, ...loadRecent().filter((r) => !(r.from === entry.from && r.to === entry.to))].slice(0, 4);
  try { localStorage.setItem(RECENT, JSON.stringify(list)); } catch { /* optional */ }
  renderRecent();
}
function renderRecent() {
  const list = loadRecent();
  els.recent.hidden = !list.length;
  els.recent.innerHTML = list.length
    ? `<span class="label">Recent</span>${list.map((r, i) => `<button type="button" data-recent="${i}">${esc(r.from.split(",")[0])} → ${esc(r.to.split(",")[0])} <span>${esc(r.date && r.date >= els.date.min ? dayLabel(r.date) : "")}</span></button>`).join("")}`
    : "";
}
els.recent.addEventListener("click", (e) => {
  const b = e.target.closest("[data-recent]");
  if (!b) return;
  const r = loadRecent()[Number(b.dataset.recent)];
  if (!r) return;
  els.from.value = r.from; els.to.value = r.to;
  if (r.fromPlace) fromBox.setPlace(r.fromPlace);
  if (r.toPlace) toBox.setPlace(r.toPlace);
  if (r.date && r.date >= els.date.min) els.date.value = r.date;
  setRadio("triptype", r.round ? "round" : "one");
  if (r.round && r.rdate && r.rdate >= els.date.value) els.rdate.value = r.rdate;
  syncReturn();
  els.form.requestSubmit();
});

// ---------- itinerary helpers ----------
const flightsOf = (it) => it.legs.filter((l) => l.kind === "flight");
const allLive = (it) => flightsOf(it).every((l) => l.source === "live");
const amt = (l) => (l.source === "live" ? money(l.cost) : `~${money(l.cost)}`);
const badge = (src) => `<span class="mini ${src === "live" ? "live" : "est"}">${src === "live" ? "LIVE" : "EST"}</span>`;
const waitMinutes = (it) => it.legs.filter((l) => l.kind === "wait").reduce((s, l) => s + l.minutes, 0);

function routeTitle(it) { return it.route?.length ? it.route.join(" → ") : `${it.jumpOff.name} → ${it.landing.name}`; }
function routeNames(it) {
  if (!it.route?.length) return "";
  const names = [it.pre.pos?.from, it.jumpOff, it.landing, it.post.pos?.from].filter(Boolean).map((h) => h.city || h.name);
  return names.filter((n, i) => n !== names[i - 1]).join(", ");
}
function sameAs(a, b) {
  return a && b && a.mode === b.mode && a.jumpOff.id === b.jumpOff.id && a.landing.id === b.landing.id && (a.route || []).join(">") === (b.route || []).join(">") && a.totalCost === b.totalCost;
}
function flightsLine(it) {
  const fl = flightsOf(it);
  if (!fl.length) return it.legs.filter((l) => ["rail", "bus", "ferry"].includes(l.kind)).map((l) => l.label).slice(0, 2).join(" + ");
  const names = fl.map((l) => [l.airline, l.flightNumber].filter(Boolean).join(" ") || "Flight");
  const main = fl.find((l) => l.role === "main") || fl[0];
  const stops = main.stops === 0 ? "nonstop" : Number.isFinite(main.stops) ? `${main.stops} stop${main.stops > 1 ? "s" : ""}` : "";
  return [names.join(" + "), fl.length === 1 ? stops : ""].filter(Boolean).join(" · ");
}
// Leaving from somewhere other than your own city (a train to Paris, say), as opposed to the airport train.
function awayFromHome(it) {
  const hub = it.pre?.pos?.from || it.jumpOff;
  return !!hub && Number.isFinite(hub.lat) && haversineKm(view.query.origin, hub) > 60;
}
function transitTag(it) {
  const first = it.legs.find((l) => ["rail", "bus", "ferry"].includes(l.kind));
  return first && it.mode === "air" && awayFromHome(it) ? first.label : "";
}

function compareParts(it, res) {
  const b = res.baseline;
  if (!b || sameAs(it, b)) return null;
  const diff = b.totalCost - it.totalCost;
  const dt = it.travelMinutes - b.travelMinutes;
  return { diff, dt, perHour: diff > 0.5 && dt > 30 ? diff / (dt / 60) : 0 };
}

// ---------- notices ----------
function noticeHtml(res) {
  const lv = res.live;
  if (lv?.active) {
    const hotels = lv.hotelsPriced ? ` and ${lv.hotelsPriced} hotel rate${lv.hotelsPriced > 1 ? "s" : ""}` : "";
    const dropped = res.stats.unverified ? ` ${num(res.stats.unverified)} other route${res.stats.unverified > 1 ? "s" : ""} couldn’t be priced with a real quote, so ${res.stats.unverified > 1 ? "they aren’t" : "it isn’t"} shown.` : "";
    const uniq = (a) => [...new Set(a)];
    const un = uniq(lv.unpriced || []);
    const dr = uniq(lv.dropped || []);
    const detail = [
      un.length ? `<p><b>No real fare came back for ${num(un.length)} airport pair${un.length > 1 ? "s" : ""}</b> that were asked about: ${esc(un.slice(0, 60).join(", "))}${un.length > 60 ? "…" : ""}.</p>` : "",
      dr.length ? `<p><b>Dropped because the real flight times don’t connect:</b> ${esc(dr.slice(0, 30).join(", "))}${dr.length > 30 ? "…" : ""}.</p>` : "",
    ].join("");
    return `<details class="notice ok"><summary><b>Live prices.</b> ${num(lv.priced)} airport pairs checked in ${lv.calls} live request${lv.calls > 1 ? "s" : ""}${hotels}.</summary><p>Every flight shown is a real quote with its flight number.${dropped} Taxis, trains, buses, ferries and any hotel without a live rate are estimates (marked EST) — there is no real-time source for them.</p>${detail}</details>`;
  }
  const why = lv?.error
    ? `Live flight prices couldn’t be fetched right now (${esc(lv.error)}). This is most often the site’s daily limit on live searches being used up — it resets at midnight UTC.`
    : "Live flight prices are switched off.";
  return `<div class="notice alert"><b>No real prices available, so no flights are shown.</b> ${why} Whistlestop only shows flights it has a real quote for, rather than guess. Try again later.</div>`;
}

// ---------- results: summary bar ----------
function summaryHtml(q, returnDate = "") {
  const dest = shortName(q.destination);
  return `<div class="facts">
      <b>${esc(shortName(q.origin))} ${returnDate ? "⇄" : "→"} ${esc(dest)}</b><span class="sep"></span>
      <span>${esc(dayLabel(q.date))}${returnDate ? ` – ${esc(dayLabel(returnDate))}` : ""}</span><span class="sep"></span>
      <span>${hoursText(q.beforeHours)} to start · ${hoursText(q.afterHours)} to finish</span><span class="sep"></span>
      <span>${esc(BAG_LABEL[q.bags])}</span>
    </div>
    <button type="button" class="pillbtn" data-edit>${I.edit}Edit search</button>`;
}

// ---------- results: route graphic ----------
function segmentsOf(it) {
  const segs = [];
  let g = null;
  const flush = () => { if (g) { segs.push(g); g = null; } };
  for (const l of it.legs) {
    if (l.kind === "wait" || l.kind === "tax") continue;
    if (l.kind === "flight") {
      flush();
      segs.push({ type: "flight", leg: l, minutes: l.minutes, cost: l.cost, live: l.source === "live" });
    } else if (l.kind === "hotel") {
      flush();
      segs.push({ type: "hotel", leg: l, minutes: 0, cost: l.cost, live: l.source === "live" });
    } else {
      g ??= { type: "ground", minutes: 0, cost: 0, kinds: new Set(), legs: [], live: false };
      g.minutes += l.minutes; g.cost += l.cost; g.kinds.add(l.kind); g.legs.push(l);
    }
  }
  flush();
  return segs;
}
const segIcon = (s) => (s.type === "flight" ? I.plane : s.type === "hotel" ? I.bed : s.kinds.has("rail") ? I.train : s.kinds.has("bus") ? I.bus : s.kinds.has("ferry") ? I.ferry : I.car);
function segName(s) {
  if (s.type === "flight") return [s.leg.airline, s.leg.flightNumber].filter(Boolean).join(" ") || "Flight";
  if (s.type === "hotel") return "Hotel night";
  const ride = s.legs.find((l) => l.kind !== "ground");
  return ride ? ride.label : "Taxi";
}
const placeLabel = (n) => { const m = /\(([A-Z]{3})\)/.exec(n || ""); const t = m ? m[1] : String(n || "").split(",")[0].trim(); return t.length > 12 ? `${t.slice(0, 11)}…` : t; };

function routeGraphHtml(it) {
  const segs = segmentsOf(it);
  const t = it.times || {};
  const connect = it.separateTickets ? waitBetweenFlights(it) : 0;
  // nodes
  const nodes = [{ label: shortName(view.query.origin), sub: t.leaveBy ? timeOf(t.leaveBy) : "" }];
  segs.forEach((s, i) => {
    const next = segs[i + 1];
    let label;
    let sub = "";
    if (i === segs.length - 1) {
      label = shortName(view.query.destination);
      sub = t.arriveAt ? timeOf(t.arriveAt) : "";
    } else if (s.type === "flight") {
      label = s.leg.toCode;
      sub = s.leg.arrives ? timeOf(s.leg.arrives) : "";
      if (next?.type === "flight" && connect) sub = `<span class="gap">${dur(connect)}</span>`;
    } else if (next?.type === "flight") {
      label = next.leg.fromCode;
      sub = next.leg.departs ? timeOf(next.leg.departs) : "";
    } else {
      label = nodes[nodes.length - 1].label;
    }
    nodes.push({ label, sub });
  });
  const weights = segs.map((s) => (s.type === "flight" ? Math.min(4, Math.max(1.2, s.minutes / 100)) : s.type === "hotel" ? 1 : 1.1));
  const cols = ["64px", ...weights.flatMap((w) => [`minmax(0, ${w}fr)`, "64px"])].join(" ");
  const nodeCell = (i) => `<div class="rh-node"><span class="rh-dot${i === nodes.length - 1 ? " end" : ""}"></span></div>`;
  let row1 = nodeCell(0);
  segs.forEach((s, i) => {
    row1 += `<div class="rh-seg${s.type === "flight" ? " fly" : ""}"><div class="rh-seglabel">${segIcon(s)}${s.type === "hotel" ? "1 night" : dur(s.minutes)}</div><div class="rh-line"></div></div>${nodeCell(i + 1)}`;
  });
  const nodeText = (n) => `<div class="rh-nodetext"><b>${esc(n.label)}</b>${n.sub || "&nbsp;"}</div>`;
  let row2 = nodeText(nodes[0]);
  segs.forEach((s, i) => {
    const price = s.cost > 0 ? (s.live || s.type === "flight" && s.leg.source === "live" ? money(s.cost) : `~${money(s.cost)}`) : "";
    row2 += `<div class="rh-segtext"><b>${price || "&nbsp;"}</b>${s.type === "flight" ? esc(s.leg.flightNumber || s.leg.airline || "") : "&nbsp;"}</div>${nodeText(nodes[i + 1])}`;
  });
  const compact = segs.length > 6;
  const list = segs.map((s) => {
    const price = s.cost > 0 ? (s.type === "flight" ? amt(s.leg) : `~${money(s.cost)}`) : "";
    const text = s.type === "flight" ? `${esc(segName(s))} · ${esc(s.leg.fromCode)} → ${esc(s.leg.toCode)}` : s.type === "hotel" ? `Hotel night · ${esc(placeLabel(s.leg.from))}` : `${esc(segName(s))} · ${dur(s.minutes)}`;
    return `<li><span class="rvi${s.type === "flight" ? " fly" : ""}">${segIcon(s)}</span><span class="rvt${s.type === "flight" ? " fly" : ""}">${text}</span><span class="rvp">${price}</span></li>`;
  }).join("");
  return { graph: `<div class="route-h" style="grid-template-columns: ${cols}" role="img" aria-label="Route: ${esc(nodes.map((n) => n.label).join(" to "))}">${row1}${row2}</div><ul class="route-v">${list}</ul>`, compact };
}

function waitBetweenFlights(it) {
  const idx = it.legs.map((l, i) => (l.kind === "flight" ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 2) return 0;
  const between = it.legs.slice(idx[0] + 1, idx[1]);
  if (between.some((l) => l.kind === "hotel")) return 0;
  return between.filter((l) => l.kind === "wait").reduce((s, l) => s + l.minutes, 0);
}

// ---------- results: best card ----------
function tagsHtml(it) {
  const out = [];
  if (it.separateTickets) out.push(`<span class="tag warn">${it.flightCount} tickets</span>`);
  if (it.hotelNights) out.push(`<span class="tag">${I.bed}${it.hotelNights} night${it.hotelNights > 1 ? "s" : ""}</span>`);
  if (flightsOf(it).length && allLive(it)) out.push(`<span class="tag live">Live fares</span>`);
  return out.join("");
}

function bestHtml(res) {
  const it = res.best;
  const cmp = compareParts(it, res);
  const compareLine = !res.baseline ? "" : sameAs(it, res.baseline)
    ? `<div class="compare"><b>This is the direct option</b> <span>and the cheapest we found.</span></div>`
    : `<div class="compare">${cmp.diff >= 0.5 ? `<b>Saves ${money(cmp.diff)}</b>` : cmp.diff <= -0.5 ? `<b>Costs ${money(-cmp.diff)} more</b>` : "<b>Same price</b>"} <span>vs going direct${Math.abs(cmp.dt) >= 5 ? ` · ${dur(Math.abs(cmp.dt))} ${cmp.dt > 0 ? "longer" : "faster"}` : ""}${cmp.perHour ? ` · ${money(cmp.perHour)} saved per extra hour` : ""}</span></div>`;
  const t = it.times || {};
  const w = waitMinutes(it);
  const { graph, compact } = routeGraphHtml(it);
  return `<article class="best${compact ? " compact" : ""}">
    <div class="best-top"><span class="eyebrow">Cheapest</span><div class="tags">${tagsHtml(it)}</div></div>
    <div class="best-head">
      <div class="bigprice">${money(it.totalCost)}</div>
      <div><div class="routecodes">${esc(routeTitle(it))}</div><div class="routenames">${esc(routeNames(it))}</div></div>
    </div>
    ${compareLine}
    ${graph}
    <div class="best-foot">
      <div class="facts3">
        <div><span>Door to door</span><b>${dur(it.travelMinutes)}</b></div>
        ${w >= 30 ? `<div><span>Waiting</span><b>${dur(w)}</b></div>` : ""}
        ${t.leaveBy ? `<div><span>Set off by</span><b>${esc(timeOf(t.leaveBy))}</b></div>` : ""}
      </div>
      <button type="button" class="cta" data-trip="${view.items.indexOf(it)}">View trip ${I.chev}</button>
    </div>
  </article>`;
}

function directHtml(res) {
  const b = res.baseline;
  if (!b || sameAs(res.best, b)) return "";
  return `<button type="button" class="direct" data-trip="${view.items.indexOf(b)}" style="text-align:left;cursor:pointer;width:100%">
    <div class="l"><span class="k">Going direct</span><span class="r">${esc(routeTitle(b))}</span><span class="m">${esc(flightsLine(b))} · ${dur(b.travelMinutes)}</span></div>
    <div class="p">${money(b.totalCost)}</div></button>`;
}

// ---------- results: list ----------
const FILTERS = [
  ["all", "All", () => true],
  ["one", "One ticket", (it) => !it.separateTickets],
  ["two", "Two tickets", (it) => it.separateTickets],
  ["hotel", "Hotel", (it) => it.hotelNights > 0],
  ["nonstop", "Nonstop", (it) => flightsOf(it).length > 0 && flightsOf(it).every((l) => l.stops === 0)],
];

function sortedItems() {
  const f = FILTERS.find((x) => x[0] === view.filter)[2];
  const list = view.items.filter(f);
  const key = view.sort === "time" ? (a, b) => a.travelMinutes - b.travelMinutes || a.totalCost - b.totalCost
    : view.sort === "score" ? (a, b) => a.score - b.score || a.totalCost - b.totalCost
      : (a, b) => a.totalCost - b.totalCost || a.travelMinutes - b.travelMinutes;
  return list.sort(key);
}

function rowHtml(it) {
  const i = view.items.indexOf(it);
  const best = it === view.res.best;
  const isDirect = view.res.baseline && sameAs(it, view.res.baseline);
  const diff = it.totalCost - view.res.best.totalCost;
  const tt = transitTag(it);
  const tags = [
    it.separateTickets ? `<span class="tag warn">${it.flightCount} tickets</span>` : "",
    it.hotelNights ? `<span class="tag">${I.bed}${it.hotelNights} night${it.hotelNights > 1 ? "s" : ""}</span>` : "",
    isDirect ? `<span class="tag">Direct</span>` : "",
    tt ? `<span class="tag">${esc(tt)}</span>` : "",
  ].join("");
  return `<button type="button" class="row" data-trip="${i}">
    <div class="p">${money(it.totalCost)}</div>
    <div><div class="t"><span>${esc(routeTitle(it))}</span>${tags}</div><div class="s">${esc(flightsLine(it))}</div></div>
    <div class="r"><b>${dur(it.travelMinutes)}</b><span class="${best ? "good" : ""}">${best ? "Cheapest" : diff > 0 ? `+${money(diff)}` : diff < 0 ? `−${money(-diff)}` : "Same"}</span></div>
    ${I.chev}</button>`;
}

function listHtml() {
  const list = sortedItems();
  const SHOW = 8;
  const shown = view.showAll ? list : list.slice(0, SHOW);
  const valued = +view.query.valuePerHour > 0;
  const sortOpts = [[valued ? "score" : "price", valued ? "Best value first" : "Cheapest first"], ["time", "Fastest first"]];
  const filterBtns = FILTERS.map(([k, label]) => `<button type="button" data-filter="${k}" aria-pressed="${view.filter === k}">${label}</button>`).join("");
  return `<div class="listhead">
      <h2>All options <span>${view.items.length}</span></h2>
      <div class="filters">${filterBtns}<select data-sort aria-label="Sort">${sortOpts.map(([k, l]) => `<option value="${k}"${view.sort === k ? " selected" : ""}>${l}</option>`).join("")}</select></div>
    </div>
    ${list.length ? `<div class="rows">${shown.map(rowHtml).join("")}</div>` : `<div class="empty">Nothing matches that filter.</div>`}
    ${!view.showAll && list.length > SHOW ? `<button type="button" class="morebtn" data-more>Show ${list.length - SHOW} more</button>` : ""}`;
}

// ---------- results: side panels ----------
function niceStep(range, maxTicks) {
  const raw = range / maxTicks;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) || 10 * p;
}

function chartHtml() {
  const pts = view.items.filter((it) => Number.isFinite(it.travelMinutes) && Number.isFinite(it.totalCost));
  if (pts.length < 3) return "";
  const W = 320, H = 232, L = 40, R = 12, T = 14, B = 36;
  const xs = pts.map((p) => p.travelMinutes / 60);
  const ys = pts.map((p) => p.totalCost);
  const xStep = niceStep(Math.max(...xs) - Math.min(...xs) || 1, 4);
  const yStep = niceStep(Math.max(...ys) - Math.min(...ys) || 1, 3);
  const x0 = Math.floor(Math.min(...xs) / xStep) * xStep, x1 = Math.ceil(Math.max(...xs) / xStep) * xStep || xStep;
  const y0 = Math.floor(Math.min(...ys) / yStep) * yStep, y1 = Math.ceil(Math.max(...ys) / yStep) * yStep || yStep;
  const X = (h) => L + ((h - x0) / (x1 - x0 || 1)) * (W - L - R);
  const Y = (p) => H - B - ((p - y0) / (y1 - y0 || 1)) * (H - B - T);
  let g = "";
  for (let y = y0; y <= y1 + 1e-6; y += yStep) g += `<line x1="${L}" y1="${Y(y).toFixed(1)}" x2="${W - R}" y2="${Y(y).toFixed(1)}" stroke="var(--line-soft)"/><text x="${L - 6}" y="${(Y(y) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--muted)">$${num(y)}</text>`;
  for (let x = x0; x <= x1 + 1e-6; x += xStep) g += `<text x="${X(x).toFixed(1)}" y="${H - B + 18}" text-anchor="middle" font-size="11" fill="var(--muted)">${+x.toFixed(1)} h</text>`;
  const best = view.res.best;
  const direct = view.res.baseline;
  const dots = pts.filter((p) => p !== best && p !== direct).map((p) => `<circle cx="${X(p.travelMinutes / 60).toFixed(1)}" cy="${Y(p.totalCost).toFixed(1)}" r="5" fill="var(--off)"><title>${esc(routeTitle(p))} · ${money(p.totalCost)} · ${dur(p.travelMinutes)}</title></circle>`).join("");
  const dx = direct && !sameAs(best, direct) ? `<circle cx="${X(direct.travelMinutes / 60).toFixed(1)}" cy="${Y(direct.totalCost).toFixed(1)}" r="6.5" fill="var(--surface)" stroke="var(--ink)" stroke-width="2.5"><title>Direct · ${money(direct.totalCost)} · ${dur(direct.travelMinutes)}</title></circle>` : "";
  const bx = `<circle cx="${X(best.travelMinutes / 60).toFixed(1)}" cy="${Y(best.totalCost).toFixed(1)}" r="14" fill="none" stroke="var(--brand)" stroke-opacity="0.3" stroke-width="2"/><circle cx="${X(best.travelMinutes / 60).toFixed(1)}" cy="${Y(best.totalCost).toFixed(1)}" r="9" fill="var(--brand)"><title>Cheapest · ${money(best.totalCost)} · ${dur(best.travelMinutes)}</title></circle>`;
  return `<section class="panel"><h3>Price and time</h3>
    <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Price against total travel time for ${pts.length} options. The cheapest is ${money(best.totalCost)} in ${dur(best.travelMinutes)}.">${g}${dots}${dx}${bx}</svg>
    <div class="chartlegend"><span><i class="c1"></i>Cheapest</span><span><i class="c2"></i>Direct</span></div></section>`;
}

function leavingHtml() {
  const byAirport = new Map();
  for (const it of view.items) {
    const fl = flightsOf(it);
    const first = fl[0];
    const key = first ? first.fromCode : it.jumpOff.code || it.jumpOff.id;
    const name = first ? first.from.replace(/\s*\([A-Z]{3}\)\s*$/, "") : it.jumpOff.name;
    const via = it.separateTickets ? `via ${fl[1].fromCity || fl[1].from.replace(/\s*\([A-Z]{3}\)\s*$/, "")}` : awayFromHome(it) && it.legs.some((l) => ["rail", "bus", "ferry"].includes(l.kind)) ? "by train" : "";
    const cur = byAirport.get(key);
    if (!cur || it.totalCost < cur.cost) byAirport.set(key, { name, cost: it.totalCost, via });
  }
  const rows = [...byAirport.values()].sort((a, b) => a.cost - b.cost).slice(0, 6);
  if (rows.length < 2) return "";
  const max = Math.max(...rows.map((r) => r.cost));
  return `<section class="panel"><h3>Leaving from</h3><div class="bars">${rows.map((r, i) => `<div class="bar${i === 0 ? " top" : ""}"><div class="bt"><span>${esc(r.name)}${r.via ? ` <em>${esc(r.via)}</em>` : ""}</span><span>${money(r.cost)}</span></div><div class="bb"><i style="width:${Math.round((r.cost / max) * 100)}%"></i></div></div>`).join("")}</div></section>`;
}

function renderResults() {
  const res = view.res;
  els.results.innerHTML = `<div class="layout">
    <div class="maincol">${bestHtml(res)}${directHtml(res)}<div id="list">${listHtml()}</div>
      <div class="fineprint">${res.live?.active ? `${num(res.live.priced)} airport pairs checked in ${res.live.calls} live request${res.live.calls > 1 ? "s" : ""}.${res.stats.unverified ? ` ${num(res.stats.unverified)} routes had no real price and aren’t shown.` : ""}` : ""}${res.warnings.length ? ` ${res.warnings.map(esc).join(" ")}` : ""}</div>
    </div>
    <aside class="sidecol">${chartHtml()}${leavingHtml()}</aside></div>`;
}

function render(res, query, { summary = true } = {}) {
  if (summary) els.summary.innerHTML = summaryHtml(query);
  view = { res, query, items: [], filter: "all", sort: +query.valuePerHour > 0 ? "score" : "price", showAll: false, trip: null };
  // Real data only: with flights selected, nothing is shown unless live prices came back.
  if (res.input.modes.has("air") && !res.live?.active) {
    els.notice.innerHTML = noticeHtml(res);
    els.results.innerHTML = "";
    return;
  }
  els.notice.innerHTML = res.best || res.baseline ? noticeHtml(res) : "";
  if (!res.best) {
    els.results.innerHTML = `<div class="notice"><b>No routes found.</b> ${res.warnings.map(esc).join(" ") || "Try more hours, more travel modes, or allow an overnight stay."}</div>`;
    return;
  }
  const items = [res.best];
  if (res.baseline && !sameAs(res.best, res.baseline) && !items.includes(res.baseline)) items.push(res.baseline);
  for (const a of res.alternatives) if (!items.includes(a)) items.push(a);
  view.items = items;
  renderResults();
}

// ---------- trip detail ----------
function railHtml({ dot = "", line = "ground" }) {
  return `<div class="rail">${dot ? `<span class="nd ${dot}"></span>` : ""}${line === "none" ? "" : `<span class="ln ${line === "fly" ? "fly" : ""}"></span>`}</div>`;
}

function tripBlocks(it) {
  const legs = it.legs;
  const fi = legs.map((l, i) => (l.kind === "flight" ? i : -1)).filter((i) => i >= 0);
  const skip = new Set();
  const bands = new Map(); // index of first flight -> minutes between flights
  if (it.separateTickets && fi.length > 1) {
    const between = legs.slice(fi[0] + 1, fi[1]);
    if (!between.some((l) => l.kind === "hotel")) {
      let mins = 0;
      legs.forEach((l, i) => { if (i > fi[0] && i < fi[1] && l.kind === "wait") { skip.add(i); mins += l.minutes; } });
      bands.set(fi[0], mins);
    }
  }
  const blocks = [];
  let ticket = 0;
  legs.forEach((l, i) => {
    if (skip.has(i)) return;
    if (l.kind === "flight") {
      ticket++;
      blocks.push({ t: "flight", leg: l, ticket: it.separateTickets ? ticket : 0 });
      if (bands.has(i)) blocks.push({ t: "band", minutes: bands.get(i) });
    } else if (l.kind === "wait") blocks.push({ t: "wait", leg: l });
    else if (l.kind === "tax") blocks.push({ t: "tax", leg: l });
    else if (l.kind === "hotel") blocks.push({ t: "move", leg: l });
    else blocks.push({ t: "move", leg: l });
  });
  return blocks;
}

function tripHtml(it, res, query) {
  const blocks = tripBlocks(it);
  const t = it.times || {};
  const last = blocks.length - 1;
  const firstMove = blocks.findIndex((b) => b.t === "move");
  const items = blocks.map((b, i) => {
    if (b.t === "move") {
      const l = b.leg;
      const first = i === firstMove && i === 0;
      const isEnd = i === last;
      const sub = l.kind === "hotel"
        ? `Night of ${esc(l.checkIn ? dayLabel(l.checkIn) : "your trip")}`
        : `${esc(l.from === l.to ? l.from : `${l.from} → ${l.to}`)}${l.minutes ? ` · ${dur(l.minutes)}` : ""}${isEnd && t.arriveAt ? ` · arrive about <b>${esc(timeOf(t.arriveAt))}</b>` : ""}`;
      const link = legLink(l, query.date);
      return `<div class="tli">${railHtml({ dot: first || isEnd ? "ground" : "", line: isEnd ? "none" : "ground" })}<div class="tlbody"><div class="tcard">
        <div class="l"><span class="ic">${kindIcon(l.kind)}</span><div><div class="tt">${esc(l.kind === "ground" ? l.label : l.label)}</div><div class="ts">${sub}${link ? ` · <a href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">${esc(link.text)}</a>` : ""}</div></div></div>
        <div class="pr"><b>${l.cost > 0 ? amt(l) : ""}</b>${l.cost > 0 ? badge(l.source) : ""}</div></div>
        ${first && t.leaveBy ? `<div class="setoff">Set off by <b>${esc(clock(t.leaveBy))}</b>.${it.legs.some((x) => ["rail", "bus", "ferry"].includes(x.kind)) ? " Includes 20 minutes’ wait per train, bus or ferry." : ""}</div>` : ""}</div></div>`;
    }
    if (b.t === "wait") return `<div class="tli">${railHtml({})}<div class="tlbody"><div class="slim" style="padding-bottom:0">${I.clock}${esc(b.leg.label)} · ${dur(b.leg.minutes)}</div></div></div>`;
    if (b.t === "tax") return `<div class="tli">${railHtml({})}<div class="tlbody"><div class="slim" style="padding-bottom:0">${esc(b.leg.label)} · ${money(b.leg.cost)} ${badge("estimate")}</div></div></div>`;
    if (b.t === "band") {
      return `<div class="tli">${railHtml({})}<div class="tlbody"><div class="band">${I.clock}<div><b>${dur(b.minutes)} between flights</b><p>Collect your bags and check in again. These are separate tickets, so if the first flight is late, the second won’t be rebooked.</p></div></div></div></div>`;
    }
    // flight
    const l = b.leg;
    const link = legLink(l, query.date);
    const stops = l.stops === 0 ? "nonstop" : Number.isFinite(l.stops) ? `${l.stops} stop${l.stops > 1 ? "s" : ""}` : "";
    const who = [l.airline, l.flightNumber, stops].filter(Boolean).join(" · ") || l.label;
    const depart = l.departs ? timeOf(l.departs) : "";
    const arrive = l.arrives ? timeOf(l.arrives) : "";
    const place = (code, city) => `${esc(city || "")} <b>${esc(code)}</b>`;
    const bag = l.bagNotes?.length ? l.bagNotes.join("; ") : "";
    return `<div class="tli">${railHtml({ dot: "fly", line: i === last ? "none" : "fly" })}<div class="tlbody"><article class="fcard">
      <div class="fh"><div class="who">${b.ticket ? `<span class="tk">Ticket ${b.ticket}</span>` : ""}<span class="fn">${esc(who)}</span></div><div class="fp"><b>${amt(l)}</b>${badge(l.source)}</div></div>
      <div class="ft"><div><div class="tm">${esc(depart || "—")}</div><div class="pl">${place(l.fromCode, l.fromCity)}</div></div>
        <div class="mid"><span>${dur(l.minutes)}</span><i></i></div>
        <div class="right"><div class="tm">${esc(arrive || "—")}</div><div class="pl">${place(l.toCode, l.toCity)}</div></div></div>
      <div class="ff"><span class="bag">${bag ? `${I.bag}${esc(bag)}` : l.date ? esc(dayLabel(l.date)) : ""}</span>${link ? `<a href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">${esc(link.text)} ${I.ext}</a>` : ""}</div>
    </article></div></div>`;
  }).join("");

  // side summary
  const costLegs = it.legs.filter((l) => l.cost > 0 && l.kind !== "wait");
  const nFlights = flightsOf(it).length;
  const lineLabel = (l) => (l.kind === "flight" ? (nFlights > 1 ? (l.role === "main" ? "Long flight" : "Short flight") : "Flight") : l.label);
  const lines = costLegs.map((l) => `<div><span>${esc(lineLabel(l))}</span><span class="v">${amt(l)}</span></div>`).join("");
  const w = waitMinutes(it);
  const facts = [
    ["Door to door", dur(it.travelMinutes)],
    w >= 30 ? ["Waiting", dur(w)] : null,
    ["Bags", BAG_LABEL[query.bags]],
    ["Tickets", nFlights > 1 ? `${nFlights} separate` : nFlights === 1 ? "1" : ""],
  ].filter((x) => x && x[1]).map(([k, v]) => `<div><span>${k}</span><span>${esc(v)}</span></div>`).join("");
  const pts = it.points ? `<div><span>On points</span><span>${num(it.points.points)} pts + ${money(it.points.fees)} ≈ ${money(it.pointsEffectiveCost)}</span></div>` : "";
  const bagWarn = it.checkedBags ? `<div class="notice" style="margin:14px 0 0"><b>Checked-bag fees are not in this total.</b> You asked for ${it.checkedBags} per traveller${nFlights > 1 ? `, and the fee applies on each of the ${nFlights} tickets` : ""}.</div>` : "";
  const flightLinks = flightsOf(it).map((l, i) => ({ l, link: legLink(l, query.date), i })).filter((x) => x.link);
  const btns = flightLinks.map(({ link, i }) => `<a class="${i === 0 ? "p1" : "p2"}" href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">${nFlights > 1 ? `Find ticket ${i + 1}` : "Find this flight"} ${I.ext}</a>`).join("");
  const cmp = compareParts(it, res);
  const cmpHtml = !res.baseline ? "" : sameAs(it, res.baseline)
    ? `<section class="tcmp"><div><span>Compared with going direct</span><b>This is the direct option</b></div></section>`
    : `<section class="tcmp"><div><span>Compared with going direct</span><b class="${cmp.diff >= 0.5 ? "good" : ""}">${cmp.diff >= 0.5 ? `Saves ${money(cmp.diff)}` : cmp.diff <= -0.5 ? `Costs ${money(-cmp.diff)} more` : "Same price"}</b></div><div><span>${cmp.dt >= 0 ? "Extra time" : "Time saved"}</span><b>${dur(Math.abs(cmp.dt))}</b></div></section>`;

  return `<button type="button" class="backlink" data-back>${I.back}All options</button>
    <div class="triphead"><h1>${esc(routeTitle(it))}</h1><span>${esc(dayLabel(query.date))} · ${esc(shortName(query.origin))} to ${esc(shortName(query.destination))}</span></div>
    <div class="layout" style="margin-top:0">
      <div class="maincol tl" style="gap:0">${items}</div>
      <aside class="tripside">
        <section class="tsum"><div class="tot"><span>Total</span><b>${money(it.totalCost)}</b></div>
          <div class="lines">${lines}</div><hr /><div class="lines b">${facts}${pts}</div>${bagWarn}
          ${btns ? `<div class="btns">${btns}</div>` : ""}</section>
        ${cmpHtml}
      </aside></div>`;
}

function openTrip(i) {
  const it = view.items[i];
  if (!it) return;
  view.trip = it;
  els.vTrip.innerHTML = tripHtml(it, view.res, view.query);
  showView("trip");
}

// ---------- clicks inside results / trip ----------
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-trip]");
  if (t) return openTrip(Number(t.dataset.trip));
  if (e.target.closest("[data-back]")) return showView("results");
  if (e.target.closest("[data-edit]")) return showView("search");
  const f = e.target.closest("[data-filter]");
  if (f && view) { view.filter = f.dataset.filter; view.showAll = false; $("list").innerHTML = listHtml(); return; }
  if (e.target.closest("[data-more]") && view) { view.showAll = true; $("list").innerHTML = listHtml(); }
});
document.addEventListener("change", (e) => {
  if (e.target.matches("[data-sort]") && view) { view.sort = e.target.value; $("list").innerHTML = listHtml(); }
});
$("home").addEventListener("click", (e) => { e.preventDefault(); showView("search"); });

// ---------- live lookups ----------
// One request prices many airport pairs (the proxy forwards a single batched search, so cost stays low).
async function livePrices(pairs, date, info = {}) {
  const qs = new URLSearchParams({
    from: [...new Set(pairs.map((p) => p.from))].join(","),
    to: [...new Set(pairs.map((p) => p.to))].join(","),
    date,
    // the main long-haul grid may spend a gap-fill lookup; everything else never does
    fill: info.group === "main" && info.round !== 2 && !info.batch ? "1" : "0",
    bags: String(info.bags ? 1 : 0),
    pairs: pairs.map((p) => `${p.from}-${p.to}${p.expected ? `:${Math.round(p.expected)}` : ""}`).join(","),
  });
  return cached(`/flight?${qs}`, async () => {
    let res = await fetch(`${LIVE_PROVIDER_URL}/flight?${qs}`);
    // A bare 500 ("internal error") is the proxy tripping over its own daily counter when several
    // lookups arrive in the same second; it happens before any paid search, so retrying once is free.
    if (res.status === 500) {
      await new Promise((r) => setTimeout(r, 1500));
      res = await fetch(`${LIVE_PROVIDER_URL}/flight?${qs}`);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body.results || [];
  });
}

async function liveHotel(hub, checkIn, checkOut) {
  const q = hub.type === "air" ? `hotels near ${hub.name}` : `hotels near ${hub.name}, ${hub.city}`;
  const params = new URLSearchParams({ q, checkin: checkIn, checkout: checkOut });
  return cached(`/hotel?${params}`, async () => {
    const res = await fetch(`${LIVE_PROVIDER_URL}/hotel?${params}`);
    return res.ok ? res.json() : null;
  });
}

// Every live lookup costs a paid search. Identical lookups made within 30 minutes (for example
// when you only change "time is worth $/hour" or "rank by") reuse the answer instead. Failures
// are never cached, so a retry really retries.
const LOOKUPS = new Map();
const LOOKUP_TTL_MS = 30 * 60 * 1000;
async function cached(key, fetcher) {
  const hit = LOOKUPS.get(key);
  if (hit && Date.now() - hit.at < LOOKUP_TTL_MS) return hit.value;
  const value = await fetcher();
  if (value !== null && value !== undefined) LOOKUPS.set(key, { at: Date.now(), value });
  return value;
}

function queryFromForm() {
  const p = prefState();
  return {
    origin: places.origin, destination: places.destination, date: els.date.value, returnDate: p.round ? els.rdate.value : "",
    beforeHours: els.before.value, afterHours: els.after.value, modes: modes(),
    overnight: p.overnight, positioning: p.positioning, stopover: p.positioningEnd, stopoverHours: p.stopoverHours, ownCar: p.owncar,
    valuePerHour: p.value, pointsCents: p.cents, rankBy: p.rank, bags: p.bags,
  };
}

// ---------- round trips: out and back as two tabs under one total ----------
let round = null; // { rt, query, active: "out" | "back" }

function roundBarHtml() {
  const { rt, query } = round;
  const o = rt.out.best, b = rt.back?.best;
  const name = (p) => shortName(p);
  const leg = (key, title, date, from, to, it) => `<button type="button" role="tab" data-leg="${key}" aria-selected="${round.active === key}">
      <b>${title} · ${esc(dayLabel(date))}</b><span>${esc(name(from))} → ${esc(name(to))} · ${it ? money(it.totalCost) : "no route found"}</span></button>`;
  const total = rt.total === null ? "" : `<div class="roundtotal">
      <div><span class="lbl">Round trip total</span><span class="big">${money(rt.total)}</span></div>
      <div class="sum">Out ${money(o.totalCost)} + back ${money(b.totalCost)}${rt.savings > 0 ? ` · <span class="save">saves ${money(rt.savings)}</span> vs going direct both ways` : ""}</div>
    </div>
    <p class="note">Priced as two one-way tickets, each with its own real quote. Some airlines sell a round trip for less than two one-ways; Whistlestop can’t see those fares yet.</p>`;
  const tabs = rt.back ? `<div class="legtabs" role="tablist" aria-label="Outbound or return">
      ${leg("out", "Outbound", query.date, query.origin, query.destination, o)}${leg("back", "Return", rt.returnDate, query.destination, query.origin, b)}</div>` : "";
  return total + tabs;
}

function renderRound() {
  const { rt, query } = round;
  els.summary.innerHTML = summaryHtml(query, rt.returnDate);
  els.roundbar.innerHTML = `<div class="roundbar">${roundBarHtml()}</div>`;
  if (round.active === "back" && rt.back) render(rt.back, returnLeg(query), { summary: false });
  else render(rt.out, query, { summary: false });
  if (!rt.back) els.notice.insertAdjacentHTML("beforeend", `<div class="notice"><b>The return trip wasn’t searched.</b> There were no real prices for the way out, so searching the way back would only spend more of the daily limit.</div>`);
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-leg]");
  if (!t || !round) return;
  round.active = t.dataset.leg;
  renderRound();
});

async function runSearch() {
  const query = queryFromForm();
  const deps = LIVE_PROVIDER_URL ? { livePrices, liveHotel } : {};
  if (query.returnDate) {
    const rt = await searchRoundTrip(query, DATA, deps);
    round = { rt, query, active: round?.active === "back" && rt.back ? "back" : "out" };
    renderRound();
    return;
  }
  round = null;
  els.roundbar.innerHTML = "";
  render(await search(query, DATA, deps), query);
}

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!els.from.value.trim() || !els.to.value.trim()) return setStatus("Enter both a starting point and a destination.", true);
  if (!els.date.value) return setStatus("Pick a travel date.", true);
  if (radio("triptype") === "round" && (!els.rdate.value || els.rdate.value < els.date.value)) return setStatus("Pick a return date on or after your outbound date.", true);
  if (!modes().length) return setStatus("Choose at least one way to travel.", true);

  els.go.disabled = true;
  saveForm();
  try {
    setStatus("Finding your places…");
    const origin = toPoint(await fromBox.resolve());
    const destination = toPoint(await toBox.resolve());
    places = { origin, destination };
    setStatus(radio("triptype") === "round" ? "Checking every reachable airport, both ways — this can take a moment…" : "Checking every reachable airport — this can take a moment…");
    await runSearch();
    setStatus("");
    saveRecent();
    showView("results");
  } catch (err) {
    setStatus(err.message || "Something went wrong.", true);
  } finally {
    els.go.disabled = false;
  }
});

// ---------- preferences ----------
$("open-prefs").addEventListener("click", () => els.prefs.showModal());
$("close-prefs").addEventListener("click", () => els.prefs.close());
$("apply-prefs").addEventListener("click", () => els.prefs.close());
els.prefs.addEventListener("click", (e) => { if (e.target === els.prefs) els.prefs.close(); });
$("reset-prefs").addEventListener("click", () => {
  setRadio("bags", "personal"); setRadio("rank", "cash");
  els.overnight.checked = false; els.positioning.checked = true; els.owncar.checked = false;
  els.value.value = 0; els.cents.value = 1.4;
  saveForm();
});
els.prefs.addEventListener("change", () => { saveForm(); });
// Ranking inputs re-sort instantly without re-geocoding (the live lookups are cached, so this costs nothing).
let timer;
for (const el of [els.value, els.cents, ...document.querySelectorAll('input[name="rank"]')]) {
  el.addEventListener("input", () => {
    if (!places || !view) return;
    clearTimeout(timer);
    timer = setTimeout(() => runSearch().catch((err) => setStatus(err.message, true)), 250);
  });
}
els.form.addEventListener("change", saveForm);

restoreForm();
renderRecent();
if (LIVE_PROVIDER_URL) els.livepill.hidden = false;
