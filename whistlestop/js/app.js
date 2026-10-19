import { search } from "./engine.js";
import { HUBS, LINKS } from "./data/hubs.js";
import { suggest } from "./places.js";
import { attachCombobox } from "./combobox.js";
import { legLink } from "./links.js";
import { LIVE_PROVIDER_URL } from "./config.js";

const $ = (id) => document.getElementById(id);
const els = {
  form: $("form"), from: $("from"), to: $("to"), date: $("date"), before: $("before"), after: $("after"),
  overnight: $("overnight"), positioning: $("positioning"), owncar: $("owncar"), value: $("value"), cents: $("cents"), rank: $("rank"),
  go: $("go"), status: $("status"), notice: $("notice"), results: $("results"),
};
const STORE = "whistlestop:form:v1";
const DATA = { hubs: HUBS, links: LINKS };

const getSuggestions = (text, signal) => suggest(text, HUBS, { signal });
const fromBox = attachCombobox(els.from, { getSuggestions });
const toBox = attachCombobox(els.to, { getSuggestions });
const toPoint = (s) => ({ name: s.label, lat: s.lat, lon: s.lon, cc: s.cc });

let places = null; // { origin, destination } once resolved
let lastQuery = null;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
const num = (n) => Math.round(n).toLocaleString("en-US");
const dur = (min) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
};
const shortName = (p) => (p.name || "").split(",")[0].trim() || "your location";
const KIND_LABEL = { flight: "Flight", rail: "Train", bus: "Bus", ferry: "Ferry", ground: "Ground", hotel: "Hotel", tax: "Taxes", wait: "Wait" };

// ---------- form state ----------
function modes() {
  return [...document.querySelectorAll('input[name="mode"]:checked')].map((i) => i.value);
}

function saveForm() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      from: els.from.value, to: els.to.value, date: els.date.value, before: els.before.value, after: els.after.value,
      overnight: els.overnight.checked, positioning: els.positioning.checked, owncar: els.owncar.checked, value: els.value.value, cents: els.cents.value,
      rank: els.rank.value, modes: modes(), fromPlace: fromBox.place, toPlace: toBox.place,
    }));
  } catch { /* storage optional */ }
}

function restoreForm() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(STORE) || "null"); } catch { /* ignore */ }
  const soon = new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10);
  els.date.min = new Date().toISOString().slice(0, 10);
  els.date.value = soon;
  if (!s) return;
  els.from.value = s.from ?? ""; els.to.value = s.to ?? "";
  if (s.fromPlace) fromBox.setPlace(s.fromPlace);
  if (s.toPlace) toBox.setPlace(s.toPlace);
  if (s.date && s.date >= els.date.min) els.date.value = s.date;
  els.before.value = s.before ?? 3; els.after.value = s.after ?? 1.5;
  els.overnight.checked = !!s.overnight; els.positioning.checked = s.positioning !== false; els.owncar.checked = !!s.owncar;
  els.value.value = s.value ?? 0; els.cents.value = s.cents ?? 1.4; els.rank.value = s.rank ?? "cash";
  if (Array.isArray(s.modes)) document.querySelectorAll('input[name="mode"]').forEach((i) => { i.checked = s.modes.includes(i.value); });
}

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle("error", isError);
}

// ---------- rendering ----------
const badge = (src) => `<span class="badge ${src === "live" ? "live" : "est"}">${src === "live" ? "LIVE" : "EST"}</span>`;

function stepHtml(leg, date) {
  const link = legLink(leg, date);
  let title = esc(leg.label);
  let sub = leg.from === leg.to ? esc(leg.from) : `${esc(leg.from)} → ${esc(leg.to)}`;
  if (leg.kind === "hotel") sub = "One night • " + esc(leg.from);
  if (leg.kind === "tax") sub = "Added on top of the fare in the estimate model";
  if (leg.kind === "wait") sub = esc(leg.from);
  if (leg.departs && leg.arrives) sub += ` · departs ${esc(clock(leg.departs))}, arrives ${esc(clock(leg.arrives, leg.departs))}`;
  else if (leg.kind === "flight" && leg.date) sub += ` · ${esc(dayLabel(leg.date))}`;
  if (leg.kind === "hotel" && leg.checkIn) sub += ` · night of ${esc(dayLabel(leg.checkIn))}`;
  if (leg.note) sub += ` · ${esc(leg.note)}`;
  const cost = leg.cost > 0 ? `${money(leg.cost)} ${badge(leg.source)}` : "";
  const time = leg.minutes > 0 ? `<small>${dur(leg.minutes)}</small>` : "";
  return `<li>
    <span class="kind ${leg.kind}">${KIND_LABEL[leg.kind] || leg.kind}</span>
    <div class="step-main"><div class="step-title">${title}</div><div class="step-sub">${sub}${link ? ` · <a href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">${esc(link.text)} ↗</a>` : ""}</div></div>
    <div class="step-cost">${cost}${time}</div>
  </li>`;
}

// "2026-12-10 11:05" -> "Thu 10 Dec, 11:05"; with a reference, just the time when it's the same day.
const dayLabel = (iso) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
function clock(s, ref) {
  const time = s.slice(11, 16);
  return ref && ref.slice(0, 10) === s.slice(0, 10) ? time : `${dayLabel(s)}, ${time}`;
}

function timingHtml(it) {
  const t = it.times;
  if (!t) {
    return it.legs.some((l) => l.kind === "flight" && l.source === "live")
      ? `<div class="pts">Flight times weren’t available — check that the connections work before booking.</div>`
      : "";
  }
  const parts = [];
  if (t.leaveBy) parts.push(`<b>Set off by ${esc(clock(t.leaveBy))}</b>`);
  if (t.arriveAt) parts.push(`reach your destination about <b>${esc(clock(t.arriveAt))}</b>`);
  const rides = it.legs.some((l) => ["rail", "bus", "ferry"].includes(l.kind));
  const caveat = rides ? " Train, bus and ferry timetables aren’t checked — this allows 20 minutes’ wait per ride." : "";
  return `<div class="pts">${parts.join(" · ")}.${caveat}</div>`;
}

const stepsHtml = (it, date) => `<ol class="steps">${it.legs.map((l) => stepHtml(l, date)).join("")}</ol>`;

function totalsHtml(it, res) {
  const pts = it.points
    ? `<div class="pts">Fly on points: ${num(it.points.points)} pts + ${money(it.points.fees)} taxes/fees ≈ ${money(it.pointsEffectiveCost)} all-in at ${res.input.pointsCents}¢/pt ${badge(it.points.source)}</div>`
    : "";
  return `<div class="totals"><span>Total door to door</span><span class="big">${money(it.totalCost)}</span></div>
    <div class="pts">${dur(it.travelMinutes)} start to finish${waitNote(it)}${it.hotelNights ? ` + ${it.hotelNights} night${it.hotelNights > 1 ? "s" : ""} in a hotel` : ""}</div>${pts}${timingHtml(it)}${ticketNote(it)}`;
}

const waitMinutes = (it) => it.legs.filter((l) => l.kind === "wait").reduce((s, l) => s + l.minutes, 0);
const waitNote = (it) => { const w = waitMinutes(it); return w >= 30 ? ` (${dur(w)} of it waiting)` : ""; };

function ticketNote(it) {
  if (!it.separateTickets) return "";
  return `<div class="pts"><b>Two separate tickets.</b> If the first flight is late or cancelled, the airline won’t rebook the second one — check the connection time and allow for collecting and re-checking bags.</div>`;
}

// "STN → MXP → JFK" for flights; the station names for trains, buses and ferries.
function routeTitle(it) {
  return it.route?.length ? it.route.join(" → ") : `${it.jumpOff.name} → ${it.landing.name}`;
}
function routeNames(it) {
  if (!it.route?.length) return "";
  const names = [it.pre.pos?.from, it.jumpOff, it.landing, it.post.pos?.from].filter(Boolean).map((h) => h.city || h.name);
  return names.filter((n, i) => n !== names[i - 1]).join(" → ");
}

function chainSummary(it) {
  const parts = [];
  for (const l of it.legs) {
    if (l.kind === "wait" || l.kind === "tax") continue;
    const txt = l.kind === "ground" ? "taxi" : l.kind === "flight" ? "flight" : l.kind === "hotel" ? "hotel" : l.label;
    if (l.kind === "flight" || parts[parts.length - 1] !== txt) parts.push(txt);
  }
  return parts.join(" → ");
}

function directLabel(b) {
  const where = b.jumpOff.name;
  return b.mode === "air" ? `flying from ${where}` : `the ${b.mode === "rail" ? "train" : b.mode} from ${where}`;
}

function sameAs(a, b) {
  return a && b && a.mode === b.mode && a.jumpOff.id === b.jumpOff.id && a.landing.id === b.landing.id && (a.route || []).join(">") === (b.route || []).join(">") && a.totalCost === b.totalCost;
}

function comparison(it, res) {
  const b = res.baseline;
  if (!b) return "";
  if (sameAs(it, b)) return "This is also the direct option.";
  const diff = b.totalCost - it.totalCost;
  const dt = it.travelMinutes - b.travelMinutes;
  const verified = res.live?.active && it.legs.filter((l) => l.kind === "flight").every((l) => l.source === "live");
  const hedge = verified ? "" : " (estimate)";
  const cost = diff >= 0.5 ? `<b class="savings">Saves ${money(diff)}${hedge}</b>` : diff <= -0.5 ? `<b>Costs ${money(-diff)} more${hedge}</b>` : `<b>Same price${hedge}</b>`;
  const time = Math.abs(dt) < 5 ? "same travel time" : dt > 0 ? `${dur(dt)} longer` : `${dur(-dt)} faster`;
  const perHour = diff > 0.5 && dt > 30 ? ` · ${money(diff / (dt / 60))} saved per extra hour` : "";
  return `${cost} vs. going direct (${esc(directLabel(b))}) · ${time}${perHour}`;
}

function heroHtml(res, date) {
  const it = res.best;
  const status = sameAs(it, res.baseline)
    ? "Your direct option is already the best one we found."
    : comparison(it, res);
  return `<article class="hero">
    <div class="eyebrow">Best option</div>
    <div class="headline"><span class="price">${money(it.totalCost)}</span><span class="route">${esc(routeTitle(it))}</span></div>
    <div class="split">${esc(routeNames(it))}</div>
    <div class="vs">${status}</div>
    ${stepsHtml(it, date)}
    ${totalsHtml(it, res)}
  </article>`;
}

function cardHtml(it, res, date, { open = false, baseline = false, tag = "" } = {}) {
  const hotelTag = it.hotelNights ? `<span class="tagline hotel">+ ${it.hotelNights} hotel night${it.hotelNights > 1 ? "s" : ""}</span>` : "";
  const sepTag = it.separateTickets ? `<span class="tagline sep">2 tickets</span>` : "";
  const names = routeNames(it);
  return `<details class="card${baseline ? " baseline" : ""}"${open ? " open" : ""}>
    <summary>
      <div><div class="t">${esc(routeTitle(it))}${hotelTag}${sepTag}${tag}</div><div class="m">${names ? esc(names) + " · " : ""}${esc(chainSummary(it))}</div></div>
      <div class="p"><b>${money(it.totalCost)}</b><small>${dur(it.travelMinutes)}</small></div>
      <div class="m" style="grid-column:1/-1">${baseline ? "The comparison point: leaving from your local hub." : comparison(it, res)}</div>
    </summary>
    <div class="body">${stepsHtml(it, date)}${totalsHtml(it, res)}</div>
  </details>`;
}

function noticeHtml(res) {
  const lv = res.live;
  if (lv?.active) {
    const hotels = lv.hotelsPriced ? ` and ${lv.hotelsPriced} hotel rate${lv.hotelsPriced > 1 ? "s" : ""}` : "";
    const dropped = res.stats.unverified ? ` The most promising routes were priced live; the other ${num(res.stats.unverified)} can’t be ranked against real quotes, so only the best few are shown separately at the bottom, as estimates.` : "";
    return `<div class="notice ok"><b>Live prices.</b> Checked Google Flights for ${lv.priced} airport pair${lv.priced > 1 ? "s" : ""}${hotels}. Every ranked flight is a real quote.${dropped} Taxis, trains, buses and ferries are still estimates (marked EST).</div>`;
  }
  const why = lv?.error
    ? `Live flight prices couldn’t be fetched right now (${esc(lv.error)}). This is most often the site’s daily limit on live searches being used up — it resets at midnight UTC.`
    : "Live flight prices are switched off.";
  return `<div class="notice alert"><b>Estimates only — not real prices.</b> ${why} What you see below comes from a rough built-in model (distance-based fares, approximate departure taxes), which is biased toward certain airports — so treat it as a shortlist of ideas, not a quote. Try again later for live results.</div>`;
}

function render(res, date) {
  els.notice.innerHTML = res.best || res.baseline ? noticeHtml(res) : "";
  const o = shortName(places.origin);
  const d = shortName(places.destination);

  if (!res.best) {
    setStatus("", false);
    els.results.innerHTML = `<div class="notice"><b>No routes found.</b> ${res.warnings.map(esc).join(" ") || "Try more hours, more travel modes, or allow an overnight stay."}</div>`;
    return;
  }

  setStatus(`Compared ${res.stats.itineraries.toLocaleString()} routes using ${res.stats.hubsNearOrigin} departure points near ${o} and ${res.stats.hubsNearDestination} arrival points near ${d}.`);

  let html = heroHtml(res, date);
  if (res.baseline && !sameAs(res.best, res.baseline)) {
    html += `<h2>Going direct <small>— your comparison point${res.baseline.fallback ? " (no hub within 90 min, using the nearest)" : ""}</small></h2>${cardHtml(res.baseline, res, date, { baseline: true })}`;
  }
  if (res.overnightOptions?.length) {
    html += `<h2>With an overnight stay <small>— hotel cost included and shown</small></h2>${res.overnightOptions.map((i) => cardHtml(i, res, date)).join("")}`;
  }
  if (res.alternatives.length) {
    const SHOW = 10;
    const shown = res.alternatives.slice(0, SHOW).map((i) => cardHtml(i, res, date)).join("");
    const rest = res.alternatives.slice(SHOW);
    html += `<h2>All combinations <small>— ${res.alternatives.length} more, cheapest first</small></h2>${shown}`;
    if (rest.length) {
      html += `<div class="more" hidden>${rest.map((i) => cardHtml(i, res, date)).join("")}</div><button type="button" class="more-btn" data-more>Show ${rest.length} more combination${rest.length > 1 ? "s" : ""}</button>`;
    }
  }
  if (res.unverifiedOptions?.length) {
    html += `<h2>Estimated only <small>— no live price for at least one flight, so not ranked</small></h2>${res.unverifiedOptions.map((i) => cardHtml(i, res, date)).join("")}`;
  }
  if (res.warnings.length) html += `<div class="notice">${res.warnings.map(esc).join(" ")}</div>`;
  els.results.innerHTML = html;
}

// ---------- running a search ----------
// One request prices many airport pairs (the proxy forwards a single batched
// search, so cost stays low).
async function livePrices(pairs, date, info = {}) {
  const qs = new URLSearchParams({
    from: [...new Set(pairs.map((p) => p.from))].join(","),
    to: [...new Set(pairs.map((p) => p.to))].join(","),
    date,
    // the main long-haul grid may spend a couple of extra lookups filling gaps; positioning hops never do
    fill: info.group === "main" ? "2" : "0",
    pairs: pairs.map((p) => `${p.from}-${p.to}${p.expected ? `:${Math.round(p.expected)}` : ""}`).join(","),
  });
  const res = await fetch(`${LIVE_PROVIDER_URL}/flight?${qs}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body.results || [];
}

async function liveHotel(hub, checkIn, checkOut) {
  const q = hub.type === "air" ? `hotels near ${hub.name}` : `hotels near ${hub.name}, ${hub.city}`;
  const res = await fetch(`${LIVE_PROVIDER_URL}/hotel?${new URLSearchParams({ q, checkin: checkIn, checkout: checkOut })}`);
  return res.ok ? res.json() : null;
}

function queryFromForm() {
  return {
    origin: places.origin, destination: places.destination, date: els.date.value,
    beforeHours: els.before.value, afterHours: els.after.value, modes: modes(),
    overnight: els.overnight.checked, positioning: els.positioning.checked, ownCar: els.owncar.checked,
    valuePerHour: els.value.value, pointsCents: els.cents.value, rankBy: els.rank.value,
  };
}

async function runSearch() {
  lastQuery = queryFromForm();
  const res = await search(lastQuery, DATA, LIVE_PROVIDER_URL ? { livePrices, liveHotel } : {});
  render(res, lastQuery.date);
}

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!els.from.value.trim() || !els.to.value.trim()) return setStatus("Enter both a starting point and a destination.", true);
  if (!els.date.value) return setStatus("Pick a travel date.", true);
  if (!modes().length) return setStatus("Choose at least one way to travel.", true);

  els.go.disabled = true;
  els.results.innerHTML = "";
  els.notice.innerHTML = "";
  saveForm();
  try {
    setStatus("Finding your places…");
    const origin = toPoint(await fromBox.resolve());
    const destination = toPoint(await toBox.resolve());
    places = { origin, destination };
    setStatus("Comparing routes…");
    await runSearch();
  } catch (err) {
    setStatus(err.message || "Something went wrong.", true);
  } finally {
    els.go.disabled = false;
  }
});

els.results.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-more]");
  if (!btn) return;
  btn.previousElementSibling.hidden = false;
  btn.remove();
});

// Ranking inputs re-sort instantly without re-geocoding.
let timer;
for (const el of [els.value, els.cents, els.rank]) {
  el.addEventListener("input", () => {
    saveForm();
    if (!places) return;
    clearTimeout(timer);
    timer = setTimeout(() => runSearch().catch((e) => setStatus(e.message, true)), 150);
  });
}

restoreForm();
