// Weekly Stage Door catalogue refresh (runs in the site repo's GitHub Action, or locally).
// Usage: node refresh.mjs <catalogue.json> <state.json>
// Live sources: Official London Theatre (current listing) and Wikipedia (Broadway theatres, Off-Broadway categories).
import fs from 'node:fs';
import { UA, NOW, sleep, decode, slug, sameShow, upsert, wikiPages, wikiCategory, offBroadwayFromArticle, nycVenue, oltRow, NOT_A_THEATRE, BROADWAY_VENUE, currentBroadway } from './lib.mjs';

const [catFile, stateFile] = process.argv.slice(2);
const cat = JSON.parse(fs.readFileSync(catFile, 'utf8'));
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
state.oltVenues ||= {}; state.obSeen ||= []; state.broadwayArticles ||= {};
const before = JSON.stringify(cat);
const log = [];

// rows <-> objects
const regions = Object.keys(cat.shows);
const shows = Object.fromEntries(regions.map(r => [r, cat.shows[r].map(([t, th, o, c, k, ref]) => ({ t, th, o, c: c || 0, k: k || 'x', ref }))]));
const theatreTier = id => (cat.theatres.find(t => t.id === id) || state.builtInTheatres?.[id] || {}).tier;

/* ---------- 1. Official London Theatre ---------- */
async function oltVenue(vid) {
  if (vid in state.oltVenues) return state.oltVenues[vid];
  const r = await fetch(`https://officiallondontheatre.com/wp-json/wp/v2/venue/${vid}?_fields=id,title`, UA);
  const name = r.ok ? decode((await r.json()).title.rendered) : '';
  let id = null;
  if (name && !NOT_A_THEATRE.test(name)) {
    id = 'olt-' + slug(name.replace(/^the /i, ''));
    if (!cat.theatres.some(t => t.id === id)) { cat.theatres.push({ id, n: name, city: 'lon', tier: 'offwestend' }); log.push('new London venue: ' + name); }
  }
  state.oltVenues[vid] = id;
  await sleep(500);
  return id;
}
const F = 'id,title,genre,acf.show_opening_night,acf.show_closing_night,acf.show_previews_from,acf.show_booking_until,acf.show_linked_venue';
const current = [];
for (let page = 1; page < 20; page++) {
  const r = await fetch(`https://officiallondontheatre.com/wp-json/wp/v2/show?per_page=100&page=${page}&_fields=${F}`, UA);
  if (!r.ok) break;
  const list = await r.json(); if (!list.length) break;
  current.push(...list); await sleep(1500);
  if (list.length < 100) break;
}
for (const j of current) {
  const s = { id: j.id, t: j.title && j.title.rendered, g: j.genre, ...(j.acf || {}) };
  const vid = (s.show_linked_venue || [])[0];
  const th = vid ? await oltVenue(vid) : null;
  const row = oltRow(s, () => th);
  if (!row) continue;
  const tier = theatreTier(row.th);
  const region = tier === 'westend' ? 'westend' : 'offwestend';
  const list = shows[region];
  const byRef = list.find(x => x.ref === row.ref);
  if (byRef) { if (byRef.c !== row.c) { byRef.c = row.c; log.push(`updated ${row.t}`); } continue; }
  const res = upsert(list, row);
  if (res === 'added') log.push(`added ${region}: ${row.t} (${row.o})`);
}

/* ---------- 2. Broadway (Wikipedia "Broadway theaters and current productions" table) ---------- */
const bt = (await wikiPages(['Broadway theatre']))['Broadway theatre'] || '';
const onNow = currentBroadway(bt).map(r => ({ ...r, th: BROADWAY_VENUE(r.theatre) })).filter(r => r.th);
if (onNow.length < 30) throw new Error('Broadway table looked wrong (' + onNow.length + ' theatres); stopping so nothing gets closed by mistake');
const soon = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
for (const r of onNow) {
  const playing = r.opening && (r.notYetOpen ? r.opening <= soon : r.opening <= today); // previews count as playing
  // whatever was running here before this production has closed
  for (const x of shows.broadway) if (x.th === r.th && x.c === 0 && !sameShow(x, r) && (playing || !r.notYetOpen)) { x.c = NOW; log.push(`closed broadway: ${x.t}`); }
  if (!playing) continue;
  const k = /musical/i.test(r.type) ? 'm' : /play/i.test(r.type) ? 'p' : /special|concert/i.test(r.type) ? 's' : 'x';
  const row = { t: r.t, th: r.th, o: +r.opening.slice(0, 4), c: r.closing && r.closing < today ? +r.closing.slice(0, 4) : 0, k, src: 'current' };
  const res = upsert(shows.broadway, row);
  if (res !== 'same') log.push(`${res} broadway: ${r.t} (${row.o})`);
}

/* ---------- 3. Off-Broadway (Wikipedia categories) ---------- */
const seen = new Set(state.obSeen);
const members = [];
for (const [catName, kind] of [['Off-Broadway plays', 'p'], ['Off-Broadway musicals', 'm']]) for (const t of await wikiCategory(catName)) if (!seen.has(t)) members.push([t, kind]);
if (members.length) {
  const texts = await wikiPages(members.map(m => m[0]));
  for (const [t, kind] of members) {
    seen.add(t);
    const r = offBroadwayFromArticle(t, texts[t] || '', kind);
    if (!r || r.o < 2009) continue;
    const row = { t: r.t, th: nycVenue(r.place) || '', o: r.o, c: r.o, k: r.k, src: 'wiki' };
    if (upsert(shows.offbroadway, row) === 'added') log.push(`added offbroadway: ${r.t} (${r.o})`);
  }
}
state.obSeen = [...seen];

/* ---------- write ---------- */
for (const r of regions) cat.shows[r] = shows[r].sort((a, b) => a.o - b.o || a.t.localeCompare(b.t)).map(s => { const a = [s.t, s.th, s.o, s.c || 0, s.k || 'x']; if (s.ref) a.push(s.ref); return a; });
if (JSON.stringify(cat) !== before) {
  cat.updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(catFile, JSON.stringify(cat));
}
fs.writeFileSync(stateFile, JSON.stringify(state));
console.log(log.length ? log.join('\n') : 'no changes');
