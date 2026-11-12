// Shared catalogue logic for Stage Door: used by the one-off build here and by the weekly
// GitHub Action in the site repo (.github/stagedoor/refresh.mjs), so both give the same result.
// Sources it fetches live are only ones whose robots.txt allow it: Wikipedia API and Official London Theatre.

export const UA = { headers: { 'User-Agent': 'StageDoorCatalogue/1.0 (mericpope.com/stagedoor personal theatre diary)' } };
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const NOW = new Date().getUTCFullYear();

export const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&#0?39;|’|'/g, '').replace(/&amp;|&/g, ' and ').replace(/^disneys\s+/, '').replace(/^the\s+|^a\s+/, '')
  .replace(/\s*[:–—-]\s*(the musical|a new musical|the broadway musical)$/, '').replace(/\b(the musical|musical)\b$/, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const base = t => norm(String(t).split(/\s*[:–—]\s*|\s+-\s+/)[0]);
export const sameShow = (a, b) => a.th === b.th && (norm(a.t) === norm(b.t) || base(a.t) === base(b.t)
  || norm(a.t).startsWith(norm(b.t) + ' ') || norm(b.t).startsWith(norm(a.t) + ' '));
const ENT = { rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', eacute: 'é', egrave: 'è', aacute: 'á', ouml: 'ö', uuml: 'ü', ndash: '–', mdash: '—', amp: '&', quot: '"', hellip: '…' };
export const decode = s => String(s || '').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&(\w+);/g, (m, e) => ENT[e] || m).replace(/\s+/g, ' ').trim();
export const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ---------- catalogue file: {updated, theatres:[...extra], shows:{region:[{t,th,o,c,k,src,ref}]}} ---------- */
export function upsert(list, s) {
  // the same run: close start years, overlapping years, or both sources say it is running now (start years differ for long runs)
  const hit = list.find(x => sameShow(x, s) && (Math.abs(x.o - s.o) <= 1 || (s.o >= x.o && (x.c === 0 || s.o <= x.c + 1)) || (x.c === 0 && s.c === 0)));
  if (!hit) { list.push(s); return 'added'; }
  let changed = false;
  const authority = s.src === 'olt' || s.src === 'current'; // sources that say what is on right now
  if (s.k && s.k !== 'x' && (hit.k === 'x' || (authority && hit.k !== s.k))) { hit.k = s.k; changed = true; }
  if (s.c !== undefined && s.c !== hit.c && (authority || s.src === hit.src)) { hit.c = s.c; changed = true; }
  if (s.ref && !hit.ref) { hit.ref = s.ref; changed = true; }
  return changed ? 'updated' : 'same';
}

/* ---------- Wikipedia ---------- */
export async function wikiPages(titles) {
  const out = {};
  for (let i = 0; i < titles.length; i += 40) {
    const batch = titles.slice(i, i + 40);
    const u = 'https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&redirects=1&format=json&formatversion=2&maxlag=5&titles=' + encodeURIComponent(batch.join('|'));
    let j;
    for (let a = 0; a < 4 && !j; a++) { try { j = JSON.parse(await (await fetch(u, UA)).text()); } catch { await sleep(15000); } }
    if (!j) throw new Error('Wikipedia did not answer');
    const map = {}; for (const n of [...(j.query.normalized || []), ...(j.query.redirects || [])]) map[n.from] = n.to;
    for (const t of batch) { let r = t; while (map[r]) r = map[r]; const p = j.query.pages.find(p => p.title === r); out[t] = p && !p.missing ? p.revisions[0].slots.main.content : ''; }
    await sleep(3000);
  }
  return out;
}
export async function wikiCategory(cat) {
  const out = []; let cont = '';
  do {
    const j = await (await fetch('https://en.wikipedia.org/w/api.php?action=query&list=categorymembers&cmlimit=500&cmnamespace=0&format=json&cmtitle=Category:' + encodeURIComponent(cat) + cont, UA)).json();
    out.push(...j.query.categorymembers.map(m => m.title));
    cont = j.continue ? '&cmcontinue=' + encodeURIComponent(j.continue.cmcontinue) : '';
    await sleep(1500);
  } while (cont);
  return out;
}
const wclean = s => s.replace(/<ref[^>]*\/>/g, '').replace(/<ref[\s\S]*?<\/ref>/g, '').replace(/\{\{(?:nowrap|nobr)\|([^{}]*)\}\}/gi, '$1')
  .replace(/\{\{[^{}]*\}\}/g, '').replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').replace(/'''/g, '').replace(/&ndash;|&#8211;/g, '–');

// Broadway theatre article: production table rows "| 2024 || ''Title'' || <ref>... – Broadway Play – ...</ref>"
export function broadwayRows(wikitext) {
  const rows = [];
  for (const line of wikitext.split('\n')) {
    const m = line.match(/^\s*\|\s*((?:19|20)\d\d)\s*\|\|\s*''(?:\[\[(?:[^|\]]*\|)?)?([^'\]]{2,90}?)(?:\]\])?''/);
    if (!m) continue;
    const kind = (line.match(/Broadway (Musical|Play|Special)/) || [])[1];
    rows.push({ t: decode(m[2]), o: +m[1], k: kind === 'Musical' ? 'm' : kind === 'Play' ? 'p' : kind === 'Special' ? 's' : 'x' });
  }
  return rows;
}

// Wikipedia "Broadway theatre" -> "Broadway theaters and current productions" table:
// one row per house with the current production, its type, opening and closing ("*" = not open yet / next show booked).
export function currentBroadway(wikitext) {
  const start = wikitext.indexOf('==Broadway theaters and current productions==');
  if (start < 0) return [];
  const table = wikitext.slice(start, wikitext.indexOf('\n|}', start));
  const out = [];
  for (const chunk of table.split('\n|-').slice(1)) {
    const head = chunk.match(/^\s*!\s*\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/);
    if (!head) continue;
    const body = chunk.slice(chunk.indexOf('\n|') + 2).replace(/<ref[^>]*\/>/g, '').replace(/<ref[\s\S]*?<\/ref>/g, '');
    const cells = body.split('||').map(c => c.trim());
    if (cells.length < 7) continue;
    const title = (cells[3].match(/''(?:\[\[(?:[^|\]]*\|)?)?([^'\]]+?)(?:\]\])?''/) || [])[1];
    if (!title) continue;
    const dateOf = c => (c.match(/display:none">(\d{4}-\d{2}-\d{2})/) || [])[1] || ((c.match(/\b(19|20)\d\d\b/) || [])[0] ? (c.match(/\b(19|20)\d\d\b/)[0] + '-01-01') : '');
    out.push({ theatre: decode(head[1]), t: decode(title), type: cells[4].replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1'),
      opening: dateOf(cells[5]), notYetOpen: /\*/.test(cells[5].replace(/<[^>]*>/g, '')), closing: /open-ended/i.test(cells[6]) ? '' : dateOf(cells[6]) });
  }
  return out;
}

export function infoboxField(ib, names) {
  for (const n of names) {
    const m = ib.match(new RegExp('\\|\\s*' + n + '\\s*=([^\\n]*(?:\\n(?!\\s*\\|)[^\\n]*)*)', 'i'));
    if (m && m[1].trim()) return m[1].trim();
  }
  return '';
}
// Off-Broadway show article -> {t, o, place} when the infobox shows a New York (Off-Broadway) year
export function offBroadwayFromArticle(title, wikitext, kind) {
  const ib = (wikitext.match(/\{\{\s*Infobox (?:play|musical)[\s\S]*?\n\}\}/i) || [''])[0];
  const premiere = infoboxField(ib, ['premiere', 'premiere_date', 'date_premiered']);
  const place = wclean(infoboxField(ib, ['premiere_place', 'place_premiered', 'premiere_location', 'premiere_venue', 'place', 'venue']));
  const productions = wclean(infoboxField(ib, ['productions']));
  const t = decode(title.replace(/ \((?:\d{4} )?(?:play|musical)\)$/, ''));
  const py = (premiere.match(/\b(19|20)\d\d\b/) || [])[0];
  if (py && /new york|manhattan|brooklyn|off-broadway/i.test(place)) return { t, o: +py, place, k: kind };
  const ob = productions.match(/\b((?:19|20)\d\d)\b[^\n<]{0,30}Off-Broadway/i);
  if (ob) return { t, o: +ob[1], place: '', k: kind };
  if (py && place && NYC_VENUE.some(([re]) => re.test(place))) return { t, o: +py, place, k: kind };
  return null;
}
// Off-Broadway venue keywords -> theatre ids in the page (anything else becomes a new NYC theatre)
export const NYC_VENUE = [
  [/public theater|newman|anspacher|martinson|luesther|shiva/i, 'public'], [/new york theatre workshop|nytw/i, 'nytw'],
  [/playwrights horizons/i, 'playwrights'], [/second stage|tony kiser|mcginn|cazale/i, 'secondstage'],
  [/atlantic theater|linda gross|stage 2/i, 'atlantic'], [/signature|pershing square|irene diamond|alice griffin|romulus linney/i, 'signature'],
  [/mcc|robert w\. wilson|lucille lortel/i, 'mcc'], [/lortel/i, 'lortel'], [/minetta lane/i, 'minetta'], [/daryl roth/i, 'darylroth'],
  [/new world stages/i, 'nws'], [/westside theat/i, 'westside'], [/orpheum/i, 'orpheumny'], [/stage 42/i, 'stage42'],
  [/laura pels|harold and miriam steinberg|roundabout underground/i, 'laurapels'], [/mitzi|newhouse/i, 'newhouse'],
  [/claire tow/i, 'clairetow'], [/city center|manhattan theatre club/i, 'citycenter'], [/delacorte|shakespeare in the park/i, 'delacorte'],
  [/classic stage/i, 'csc'], [/irish rep/i, 'irishrep'], [/vineyard/i, 'vineyard'], [/the shed/i, 'shed'], [/park avenue armory/i, 'armory'],
  [/st\.? ann'?s/i, 'stanns'], [/bam|brooklyn academy/i, 'bamharvey'], [/polonsky|theatre for a new audience/i, 'polonsky'],
  [/astor place/i, 'astor'], [/cherry lane/i, 'cherrylane'], [/theatre row/i, 'theatrerow'], [/59e59/i, 'e5959'],
  [/new victory/i, 'newvictory'], [/ars nova/i, 'arsnova'], [/la mama/i, 'lamama'], [/soho rep/i, 'sohorep'], [/the flea/i, 'flea'],
  [/here arts/i, 'here'], [/the kitchen/i, 'kitchen'],
];
export const nycVenue = place => { for (const [re, id] of NYC_VENUE) if (re.test(place)) return id; return null; };
// the 41 Broadway houses (current and former names)
const BROADWAY = [
  [/hirschfeld/i, 'hirschfeld'], [/ambassador/i, 'ambassador'], [/august wilson/i, 'augustwilson'], [/belasco/i, 'belasco'], [/jacobs/i, 'jacobs'],
  [/booth/i, 'booth'], [/broadhurst/i, 'broadhurst'], [/^(the )?broadway theat/i, 'broadwayth'], [/circle in the square/i, 'circle'],
  [/barrymore/i, 'barrymore'], [/o'?neill/i, 'oneill'], [/schoenfeld/i, 'schoenfeld'], [/gershwin/i, 'gershwin'], [/hayes/i, 'hayes'],
  [/hudson/i, 'hudson'], [/imperial/i, 'imperial'], [/james earl jones|cort theat/i, 'jej'], [/golden theat/i, 'golden'],
  [/lena horne|brooks atkinson/i, 'lenahorne'], [/longacre/i, 'longacre'], [/lunt/i, 'luntfontanne'], [/lyceum/i, 'lyceumny'],
  [/^(the )?lyric theat/i, 'lyricny'], [/majestic/i, 'majestic'], [/marquis/i, 'marquis'], [/minskoff/i, 'minskoff'], [/music box/i, 'musicbox'],
  [/nederlander/i, 'nederlander'], [/neil simon/i, 'neilsimon'], [/new amsterdam/i, 'newamsterdam'], [/^(the )?palace theat/i, 'palace'],
  [/richard rodgers/i, 'rodgers'], [/friedman/i, 'friedman'], [/^(the )?shubert/i, 'shubert'], [/stephen sondheim/i, 'sondheimny'],
  [/st\.? james/i, 'stjames'], [/studio 54/i, 'studio54'], [/todd haimes|american airlines/i, 'haimes'], [/vivian beaumont/i, 'beaumont'],
  [/walter kerr/i, 'kerr'], [/winter garden/i, 'wintergarden'],
];
export const BROADWAY_VENUE = place => { if (!place) return null; for (const [re, id] of BROADWAY) if (re.test(place)) return id; return null; };

/* ---------- Official London Theatre ---------- */
export const OLT_KIND = { 54: 'm', 59827: 'p', 1771: 'p', 1770: 'p', 38: 'd', 61: 'o', 42: 'x', 29927: 'x', 58354: 'x', 59314: 'x' };
export const OLT_SKIP_GENRE = new Set([59315]); // concerts
export const NOT_A_THEATRE = /arena|casino|taverna|museum|monopoly|leadenhall|tower hill|coram|spiegeltent|wonderground|underbelly|eventim|royal albert hall|festival hall|southbank centre|cadogan|one cartridge|neon194|ninetyfour|immersiveldn|county hall|outernet|camden garrison|the crown|house of sisters|windsor|o2/i;
const ymd = s => s ? [+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8)] : null;
// one OLT show record -> catalogue row (or null when it is not a real run)
export function oltRow(s, venueTheatre) {
  if (!s || s.missing || !s.t) return null;
  if ((s.g || []).some(g => OLT_SKIP_GENRE.has(g))) return null;
  const vid = (s.show_linked_venue || [])[0]; const th = venueTheatre(vid); if (!th) return null;
  const open = ymd(s.show_previews_from) || ymd(s.show_opening_night);
  const close = ymd(s.show_closing_night); const until = ymd(s.show_booking_until);
  if (!open) return null;
  if (close) { const days = (Date.UTC(close[0], close[1] - 1, close[2]) - Date.UTC(open[0], open[1] - 1, open[2])) / 864e5; if (days < 5) return null; }
  const today = new Date(); const past = d => d && Date.UTC(d[0], d[1] - 1, d[2]) < today.getTime();
  let c;
  if (close) c = past(close) ? close[0] : 0;
  else if (until) c = past(until) ? until[0] : 0;
  else c = open[0] < NOW ? open[0] : 0;
  if (open[0] > NOW) return null; // announced for next year: picked up when it opens
  const k = (s.g || []).map(g => OLT_KIND[g]).find(k => k && k !== 'x') || 'x';
  return { t: decode(s.t), th, o: open[0], c, k, src: 'olt', ref: 'olt:' + s.id };
}
