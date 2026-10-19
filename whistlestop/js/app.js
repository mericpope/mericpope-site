import { search } from "./engine.js";
import { HUBS, LINKS } from "./data/hubs.js";
import { suggest } from "./places.js";
import { attachCombobox } from "./combobox.js";
import { legLink } from "./links.js";
import { LIVE_PROVIDER_URL } from "./config.js";

const $ = (id) => document.getElementById(id);
const els = {
  form: $("form"), from: $("from"), to: $("to"), date: $("date"), before: $("before"), after: $("after"),
  overnight: $("overnight"), owncar: $("owncar"), value: $("value"), cents: $("cents"), rank: $("rank"),
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
      overnight: els.overnight.checked, owncar: els.owncar.checked, value: els.value.value, cents: els.cents.value,
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
  els.overnight.checked = !!s.overnight; els.owncar.checked = !!s.owncar;
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
  if (leg.note) sub += ` · ${esc(leg.note)}`;
  const cost = leg.cost > 0 ? `${money(leg.cost)} ${badge(leg.source)}` : "";
  const time = leg.minutes > 0 ? `<small>${dur(leg.minutes)}</small>` : "";
  return `<li>
    <span class="kind ${leg.kind}">${KIND_LABEL[leg.kind] || leg.kind}</span>
    <div class="step-main"><div class="step-title">${title}</div><div class="step-sub">${sub}${link ? ` · <a href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">${esc(link.text)} ↗</a>` : ""}</div></div>
    <div class="step-cost">${cost}${time}</div>
  </li>`;
}

const stepsHtml = (it, date) => `<ol class="steps">${it.legs.map((l) => stepHtml(l, date)).join("")}</ol>`;

function totalsHtml(it, res) {
  const pts = it.points
    ? `<div class="pts">Fly on points: ${num(it.points.points)} pts + ${money(it.points.fees)} taxes/fees ≈ ${money(it.pointsEffectiveCost)} all-in at ${res.input.pointsCents}¢/pt ${badge(it.points.source)}</div>`
    : "";
  return `<div class="totals"><span>Total door to door</span><span class="big">${money(it.totalCost)}</span></div>
    <div class="pts">${dur(it.travelMinutes)} of travel${it.hotelNights ? ` + ${it.hotelNights} night${it.hotelNights > 1 ? "s" : ""} in a hotel` : ""}</div>${pts}`;
}

function chainSummary(it) {
  const parts = [];
  for (const l of it.legs) {
    if (l.kind === "wait" || l.kind === "tax") continue;
    const txt = l.kind === "ground" ? "taxi" : l.kind === "flight" ? "flight" : l.kind === "hotel" ? "hotel" : l.label;
    if (parts[parts.length - 1] !== txt) parts.push(txt);
  }
  return parts.join(" → ");
}

function directLabel(b) {
  const where = b.jumpOff.name;
  return b.mode === "air" ? `flying from ${where}` : `the ${b.mode === "rail" ? "train" : b.mode} from ${where}`;
}

function sameAs(a, b) {
  return a && b && a.mode === b.mode && a.jumpOff.id === b.jumpOff.id && a.landing.id === b.landing.id && a.pre.kind === b.pre.kind && a.post.kind === b.post.kind && a.totalCost === b.totalCost;
}

function comparison(it, res) {
  const b = res.baseline;
  if (!b) return "";
  if (sameAs(it, b)) return "This is also the direct option.";
  const diff = b.totalCost - it.totalCost;
  const dt = it.travelMinutes - b.travelMinutes;
  const cost = diff >= 0.5 ? `<b class="savings">Saves ${money(diff)}</b>` : diff <= -0.5 ? `<b>Costs ${money(-diff)} more</b>` : "<b>Same price</b>";
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
    <div class="headline"><span class="price">${money(it.totalCost)}</span><span class="route">${esc(it.jumpOff.name)} → ${esc(it.landing.name)}</span></div>
    <div class="vs">${status}</div>
    ${stepsHtml(it, date)}
    ${totalsHtml(it, res)}
  </article>`;
}

function cardHtml(it, res, date, { open = false, baseline = false, tag = "" } = {}) {
  const hotelTag = it.hotelNights ? `<span class="tagline hotel">+ ${it.hotelNights} hotel night${it.hotelNights > 1 ? "s" : ""}</span>` : "";
  return `<details class="card${baseline ? " baseline" : ""}"${open ? " open" : ""}>
    <summary>
      <div><div class="t">${esc(it.jumpOff.name)} → ${esc(it.landing.name)}${hotelTag}${tag}</div><div class="m">${esc(chainSummary(it))}</div></div>
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
    const dropped = res.stats.unverified ? ` ${res.stats.unverified} flight option${res.stats.unverified > 1 ? "s" : ""} without a live price ${res.stats.unverified > 1 ? "were" : "was"} left out, so every flight shown is a real quote.` : "";
    return `<div class="notice ok"><b>Live prices.</b> Checked Google Flights for ${lv.priced} airport pair${lv.priced > 1 ? "s" : ""}${hotels}.${dropped} Taxis, trains, buses and ferries are still estimates (marked EST).</div>`;
  }
  return `<div class="notice"><b>Estimates only.</b> These prices come from a built-in model (distance-based fares, approximate departure taxes, typical hotel rates) — not live quotes — so use them to find <i>which</i> options deserve a look, then confirm with the “Check live” links.</div>`;
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
    html += `<h2>Other options</h2>${res.alternatives.map((i) => cardHtml(i, res, date)).join("")}`;
  }
  if (res.warnings.length) html += `<div class="notice">${res.warnings.map(esc).join(" ")}</div>`;
  els.results.innerHTML = html;
}

// ---------- running a search ----------
// One request prices many airport pairs (the proxy forwards a single batched
// search, so cost stays low).
async function livePrices(pairs, date) {
  const qs = new URLSearchParams({
    from: [...new Set(pairs.map((p) => p.from))].join(","),
    to: [...new Set(pairs.map((p) => p.to))].join(","),
    date,
    pairs: pairs.map((p) => `${p.from}-${p.to}`).join(","),
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
    overnight: els.overnight.checked, ownCar: els.owncar.checked,
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
