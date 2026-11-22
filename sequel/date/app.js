// Sequel website: one page, hash routes, talks to the sequel-api Worker.

const LOCAL = ['127.0.0.1', 'localhost'].includes(location.hostname);
const API = LOCAL ? `http://${location.hostname}:8788` : 'https://sequel-api.mericpope.workers.dev';
const TOKEN_KEY = 'sequel:token';
const RESONANCE_URL = 'https://sharedresonance.app';

const app = document.getElementById('app');
let token = null;
let content = null;
let me = null;
const photoCache = new Map();

// ---------- utilities ----------

var store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: session only */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
token = store.get(TOKEN_KEY);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function when(iso, opts = {}) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', ...opts });
}
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3200);
}

class ApiError extends Error {}

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Could not reach Sequel. Check your connection and try again.');
  }
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && token) {
    signOutLocal();
    go('#/');
    throw new ApiError('Please sign in again.');
  }
  if (!res.ok) throw new ApiError(data.error || 'Something went wrong.');
  return data;
}

function signOutLocal() {
  token = null;
  me = null;
  store.del(TOKEN_KEY);
}

const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

async function getContent() {
  if (!content) content = await api('GET', '/api/content');
  return content;
}

async function getMe(force = false) {
  if (!token) return null;
  if (!me || force) me = await api('GET', '/api/me');
  return me;
}

/** Run an async action from a button or form, with the control disabled and errors shown. */
async function busy(el, fn, errEl) {
  if (el) el.disabled = true;
  if (errEl) errEl.textContent = '';
  try { return await fn(); } catch (e) {
    if (errEl) errEl.textContent = e.message; else toast(e.message);
  } finally { if (el && el.isConnected) el.disabled = false; }
}

const $ = (sel, root = app) => root.querySelector(sel);
const $$ = (sel, root = app) => [...root.querySelectorAll(sel)];

function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') {
      if (el.dataset.single) out[el.name] = el.checked;
      else { out[el.name] = out[el.name] || []; if (el.checked) out[el.name].push(el.value); }
    } else if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
    } else out[el.name] = el.value;
  }
  return out;
}

// ---------- icons (inline stroke SVG) ----------

const icon = {
  lock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  shield: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  cal: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
  star: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>',
  heart: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/></svg>',
  back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  person: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>',
};

// ---------- layout ----------

function shell(inner, { wide = false, active = '' } = {}) {
  const nav = token && me?.setup_done ? `
    <nav class="nav" aria-label="Main">
      <a href="#/home" class="${active === 'home' ? 'on' : ''}">This week</a>
      <a href="#/me" class="${active === 'me' ? 'on' : ''}">You</a>
      ${me?.is_admin ? `<a href="#/admin" class="${active === 'admin' ? 'on' : ''}">Admin</a>` : ''}
    </nav>` : token ? '' : `<nav class="nav" aria-label="Main"><a href="#/privacy">Privacy</a></nav>`;
  return `
  <div class="shell">
    <header class="topbar"><div class="topbar-in">
      <a class="brand" href="#/"><span class="brand-mark" aria-hidden="true">S</span><span>Sequel</span></a>
      ${nav}
    </div></header>
    <main class="page ${wide ? 'wide' : ''}" id="main">${inner}</main>
    <footer class="footer"><div class="footer-in">
      <span>Sequel is invite-only while we test it with friends.</span>
      <a href="#/privacy">Privacy and safety</a>
    </div></footer>
  </div>`;
}

function render(inner, opts) {
  app.innerHTML = shell(inner, opts);
  window.scrollTo(0, 0);
  hydratePhotos();
}

function photoTag(userId, name, cls = 'avatar') {
  return `<div class="${cls}" data-photo="${esc(userId)}" role="img" aria-label="${esc(name)}">${cls === 'photo-hero' ? icon.person : esc((name || '?').slice(0, 1))}</div>`;
}

/** The nth photo of a person (0 = main), cached for this page visit. */
function photoData(id, n = 0) {
  const key = `${id}:${n}`;
  if (!photoCache.has(key)) photoCache.set(key, api('GET', `/api/photos/${id}?n=${n}`).then((r) => r.data).catch(() => null));
  return photoCache.get(key);
}

async function hydratePhotos() {
  for (const el of $$('[data-photo]')) {
    const id = el.dataset.photo;
    if (!id) continue;
    const data = await photoData(id, Number(el.dataset.n) || 0);
    if (data && el.isConnected) el.innerHTML = `<img src="${data}" alt="">`;
  }
}

const opt = (type, name, value, label, checked) =>
  `<label class="opt"><input type="${type}" name="${esc(name)}" value="${esc(value)}" ${checked ? 'checked' : ''}><span>${esc(label)}</span></label>`;

function errorPage(msg) {
  render(`<div class="card"><h2>Something went wrong</h2><p class="muted">${esc(msg)}</p><a class="btn" href="#/">Go back</a></div>`);
}

// ---------- router ----------

async function route() {
  const hash = location.hash || '#/';
  try {
    if (hash.startsWith('#join=')) return joinView(hash.slice(6));
    if (hash.startsWith('#signin=')) return signinView(hash.slice(8));
    const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const [page, a, b, c] = parts;
    if (page === 'privacy') return privacyView();
    if (!token) return landingView();
    await getMe();
    if (page === 'me' && a === 'preview') return previewView();
    if (!me.setup_done && page !== 'setup') return go('#/setup');
    switch (page) {
      case 'setup': return setupView(Number(a) || 0, b === 'edit');
      case 'match':
        if (b === 'checkin') return checkinView(a, c);
        if (b === 'prompt') return promptView(a, c);
        if (b === 'report') return reportView(a);
        if (b === 'step-back') return stepBackView(a);
        return matchView(a);
      case 'me': return meView();
      case 'admin':
        if (!me.is_admin) return go('#/home');
        if (a === 'user') return adminUserView(b);
        return adminView(a || 'matches');
      case 'home': return homeView();
      default: return homeView();
    }
  } catch (e) {
    errorPage(e.message);
  }
}
window.addEventListener('hashchange', route);

// ---------- signed-out pages ----------

function landingView() {
  render(`
    <section class="hero">
      <p class="eyebrow">Invite only</p>
      <h1>A planned date earns a proper ending.</h1>
      <p class="lead">Sequel matches you on what you love, plans the first date for you, and makes sure every date ends kindly, whatever happens next.</p>
    </section>
    <section class="steps" aria-label="How it works">
      <div class="card"><span class="num">1</span><h3>Tell us what you love</h3><p class="muted">The films, shows and places you love, and the date you'd secretly like someone to plan.</p></div>
      <div class="card"><span class="num">2</span><h3>Every match comes with a date</h3><p class="muted">A few matches a week, each with a real plan. No swiping, no endless chat.</p></div>
      <div class="card"><span class="num">3</span><h3>A check-in after</h3><p class="muted">Private answers. If you both say yes, date two unlocks. If not, a kind ending, never silence.</p></div>
      <div class="card"><span class="num">4</span><h3>Plan the next one together</h3><p class="muted">Ideas made for you both, taking turns to plan, until you decide to make it official.</p></div>
    </section>
    <section class="card">
      <h2>Sequel is invite-only for now</h2>
      <p class="muted">We're testing it with friends first. Leave your email and we'll be in touch when there's room.</p>
      <form id="waitlist" class="stack" novalidate>
        <div class="field"><label for="wl-email">Email</label><input class="input" id="wl-email" name="email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="wl-city">City</label><input class="input" id="wl-city" name="city" autocomplete="address-level2"></div>
        <p class="error" id="wl-err"></p>
        <button class="btn primary" type="submit">Join the waitlist</button>
      </form>
      <p class="small muted">Got an invite? Open the link you were sent.</p>
    </section>
  `);
  $('#waitlist').addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    busy(btn, async () => {
      await api('POST', '/api/waitlist', formData(e.target));
      e.target.outerHTML = '<p class="tag good">You’re on the list. Thank you.</p>';
    }, $('#wl-err'));
  });
}

function privacyView() {
  render(`
    <h1>Privacy and safety</h1>
    <div class="card">
      <h3>What Sequel keeps</h3>
      <p class="muted">Your profile and photo, your questionnaire answers, your matches, dates, messages, check-in answers, notes and any reports.</p>
      <h3>Who sees what</h3>
      <p class="muted">Matches see your first name, age, city, photo, short bio, the things you love and your favourites. They never see your secret wishlist, budget or check-in answers. After a date they only learn whether you both said yes, plus any note you chose to send.</p>
      <p class="muted">The person running this test can see everything, so they can plan dates and handle reports. Check-in answers are never shown to other members.</p>
      <h3>Safety</h3>
      <p class="muted">You can report and leave a match at any time, without finishing a check-in. Reported people are never matched with you again. Meet in public places for early dates and tell a friend your plan.</p>
      <h3>Deleting your data</h3>
      <p class="muted">Ask the person who invited you and your account and data will be deleted.</p>
    </div>
    <a class="linkish" href="#/">${icon.back} Back</a>
  `);
}

async function joinView(inviteToken) {
  render('<p class="loading">Checking your invite…</p>');
  const check = await api('POST', '/api/invites/check', { token: inviteToken });
  if (!check.ok) {
    render(`<div class="card"><h2>This invite can’t be used</h2><p class="muted">It has already been used or has expired. Ask the person who invited you for a new link.</p>${token ? '<a class="btn" href="#/home">Go to Sequel</a>' : ''}</div>`);
    return;
  }
  render(`
    <section class="stack">
      <p class="eyebrow">You’re invited</p>
      <h1>Welcome to Sequel</h1>
      <p class="lead">A few details first. Then a short questionnaire so we can plan dates you’ll actually enjoy.</p>
    </section>
    <form id="join" class="card stack-lg" novalidate>
      <div class="field"><label for="j-name">First name</label><input class="input" id="j-name" name="name" autocomplete="given-name" maxlength="40" required></div>
      <div class="field"><label for="j-birth">Date of birth</label><input class="input" id="j-birth" name="birth_date" type="date" required><span class="hint">You must be 18 or over. Matches see your age, not your birthday.</span></div>
      <div class="field"><label for="j-city">City</label><input class="input" id="j-city" name="city" autocomplete="address-level2" maxlength="60" required></div>
      <fieldset><legend>I am</legend><div class="seg">${opt('radio', 'gender', 'woman', 'A woman')}${opt('radio', 'gender', 'man', 'A man')}${opt('radio', 'gender', 'nonbinary', 'Non-binary')}</div></fieldset>
      <fieldset><legend>I’d like to meet</legend><div class="seg">${opt('checkbox', 'seeking', 'woman', 'Women')}${opt('checkbox', 'seeking', 'man', 'Men')}${opt('checkbox', 'seeking', 'nonbinary', 'Non-binary people')}</div></fieldset>
      <div class="card sand">
        <h3>Our community rules</h3>
        <ul class="muted" style="margin:0;padding-left:20px">
          <li>Be kind, especially when saying no.</li>
          <li>Be honest about who you are. Use a real, recent photo.</li>
          <li>Show up, or say so in good time.</li>
          <li>Finish your check-in after every date.</li>
        </ul>
        <label class="toggle"><input type="checkbox" name="agree" data-single="1"> <span>I agree to these rules</span></label>
      </div>
      <p class="error" id="j-err"></p>
      <button class="btn primary block" type="submit">Create my account</button>
    </form>
  `);
  $('#join').addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    busy(btn, async () => {
      const data = formData(e.target);
      const res = await api('POST', '/api/join', { ...data, token: inviteToken });
      token = res.token;
      store.set(TOKEN_KEY, token);
      me = null;
      history.replaceState(null, '', location.pathname);
      go('#/setup');
    }, $('#j-err'));
  });
}

async function signinView(linkToken) {
  render('<p class="loading">Signing you in…</p>');
  try {
    const res = await api('POST', '/api/signin', { token: linkToken });
    token = res.token;
    store.set(TOKEN_KEY, token);
    me = null;
    history.replaceState(null, '', location.pathname);
    go('#/home');
  } catch (e) {
    render(`<div class="card"><h2>That link didn’t work</h2><p class="muted">${esc(e.message)}</p></div>`);
  }
}

// ---------- setup questionnaire ----------

// Section 0 is the overview; "The basics" were answered when joining.
const SECTIONS = [
  { title: 'What you’re looking for', sub: 'Relationship, timing, age range', mins: 1 },
  { title: 'Life and future', sub: 'Kids, where you’re heading', mins: 1 },
  { title: 'Lifestyle', sub: 'Drinking, weekends, pets', mins: 1 },
  { title: 'How you date', sub: 'A good date, free time, budget', mins: 2 },
  { title: 'In a relationship', sub: 'How you show care, texting', mins: 1 },
  { title: 'Your secret wishlist', sub: 'Never shown to anyone', mins: 1 },
  { title: 'What you love', sub: 'The things you’d talk about all night', mins: 2 },
  { title: 'Photos and prompts', sub: 'What your match sees first', mins: 2 },
];

/** Is a section answered enough to count as done? */
function sectionDone(i, a, m = me) {
  switch (i) {
    case 1: return !!(a.looking_for && a.age_min && a.age_max);
    case 2: return !!a.kids;
    case 3: return !!(a.drinking && a.smoking);
    case 4: return !!(a.values && a.energy && (a.free || []).length);
    case 5: return !!((a.care || []).length && a.texting);
    case 6: return (a.wishlist || []).length > 0 || !!a.wishlist_own;
    case 7: return (a.loves || []).length > 0;
    case 8: return (m.photo_slots || []).length >= 2;
    default: return true;
  }
}
const firstOpenSection = () => SECTIONS.findIndex((_, i) => !sectionDone(i + 1, me.answers || {})) + 1;

const lockIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

/** A single-choice question from PROFILE_Q, as a row of options. */
function choice(c, key, a, { list = false } = {}) {
  const q = c.PROFILE_Q[key];
  return `<fieldset><legend>${esc(q.q)}${q.private ? ` <span class="hint" style="display:inline-flex;gap:4px;align-items:center;font-weight:500;white-space:nowrap;margin-left:4px">${lockIcon} Private</span>` : ''}</legend>
    <div class="${list ? 'list-opts' : 'seg'}">${q.options.map((o) => opt('radio', key, o.id, o.label, a[key] === o.id)).join('')}</div></fieldset>`;
}

const ages = (sel) => Array.from({ length: 63 }, (_, i) => i + 18).map((n) => `<option value="${n}" ${n === sel ? 'selected' : ''}>${n}</option>`).join('');

async function setupOverview() {
  const a = me.answers || {};
  const next = firstOpenSection();
  render(`
    <div class="stack">
      <p class="eyebrow">Welcome, ${esc(me.name)}</p>
      <h1>Let’s get to know you properly</h1>
      <p class="lead">About 10 minutes, mostly taps. Stop any time and carry on later.</p>
    </div>
    <div class="card" style="gap:0;padding:6px 16px">
      ${[{ title: 'The basics', sub: 'Name, age, who you’d like to meet', done: true }, ...SECTIONS.map((s, i) => ({ ...s, done: sectionDone(i + 1, a), i: i + 1 }))].map((s, k) => `
        <a class="match-row card-link" href="${s.i ? `#/setup/${s.i}` : '#/me'}" style="padding:10px 0;${k ? 'border-top:1px solid var(--line);' : ''}">
          <span class="avatar" style="width:28px;height:28px;font:600 13px var(--body);${s.done ? 'background:var(--wine);color:#fff' : 'background:var(--sand)'}">${s.done ? '✓' : k + 1}</span>
          <span class="who"><strong style="font-size:15px">${esc(s.title)}</strong><span class="small muted" style="display:block">${esc(s.sub)}</span></span>
          <span class="small muted">${s.done ? 'Done' : `${s.mins} min`}</span>
        </a>`).join('')}
    </div>
    <div class="notice">${icon.lock}<span>Anything marked private is only used for matching and planning, never shown on your profile.</span></div>
    ${next > 0 ? `<a class="btn primary block" href="#/setup/${next}">${Object.keys(a).length ? 'Carry on' : 'Start'}</a>`
      : `<button class="btn primary block" id="finish">Finish and see your matches</button>`}
  `);
  $('#finish')?.addEventListener('click', (e) => busy(e.target, async () => {
    me = await api('PUT', '/api/me', { setup_done: true });
    toast('You’re all set.');
    go('#/home');
  }));
}

async function setupView(step, editing) {
  const c = await getContent();
  me = await getMe(true);
  if (!step) return setupOverview();
  const a = me.answers || {};
  const total = SECTIONS.length;
  step = Math.min(Math.max(step, 1), total);
  let body = '';
  if (step === 1) {
    body = `
      <h1>First, the big picture</h1>
      ${choice(c, 'looking_for', a, { list: true })}
      ${choice(c, 'serious_when', a)}
      <fieldset><legend>Ages you’d like to meet</legend>
        <div class="row"><label class="row grow" style="gap:8px">From <select class="input" name="age_min" style="width:auto">${ages(a.age_min || Math.max(18, me.age - 5))}</select></label>
        <label class="row grow" style="gap:8px">to <select class="input" name="age_max" style="width:auto">${ages(a.age_max || me.age + 5)}</select></label></div></fieldset>
      <div class="field"><label for="travel">How far you’ll travel for a date</label>
        <select class="input" id="travel" name="travel_mins">${[15, 30, 45, 60, 90].map((m) => `<option value="${m}" ${Number(a.travel_mins || 45) === m ? 'selected' : ''}>Up to ${m} minutes</option>`).join('')}</select></div>
      <div class="notice">${icon.shield}<span>These are firm: you’ll only be matched with people who fit them, and who you fit too.</span></div>`;
  } else if (step === 2) {
    body = `<h1>Where is life heading?</h1>${['kids', 'date_with_kids', 'five_years', 'last_relationship'].map((k) => choice(c, k, a)).join('')}`;
  } else if (step === 3) {
    body = `<h1>A typical week</h1>${['drinking', 'smoking', 'cannabis', 'exercise', 'weekends', 'rhythm', 'pets'].map((k) => choice(c, k, a)).join('')}`;
  } else if (step === 4) {
    body = `
      <h1>How you date</h1>
      <fieldset><legend>A good date is…</legend><div class="list-opts">${c.VALUES.map((v) => opt('radio', 'values', v.id, v.label, a.values === v.id)).join('')}</div></fieldset>
      <fieldset><legend>Your pace</legend><div class="seg">${c.ENERGY.map((v) => opt('radio', 'energy', v.id, v.label, a.energy === v.id)).join('')}</div></fieldset>
      <fieldset><legend>When you’re usually free for dates</legend><div class="chips">${c.FREE.map((f) => opt('checkbox', 'free', f.id, f.label, (a.free || []).includes(f.id))).join('')}</div></fieldset>
      <fieldset><legend>Budget for a date</legend><div class="seg">${c.BUDGET.map((b) => opt('radio', 'budget', b.id, b.label, Number(a.budget || 2) === b.id)).join('')}</div></fieldset>
      <label class="toggle"><input type="checkbox" name="alcohol_free" data-single="1" ${a.alcohol_free ? 'checked' : ''}> <span>I’d rather avoid dates built around drinking</span></label>
      <div class="field"><label for="diet">Food needs <span class="muted" style="font-weight:400">Private</span></label><input class="input" id="diet" name="dietary" maxlength="120" value="${esc(a.dietary || '')}" placeholder="Vegetarian, allergies…"></div>`;
  } else if (step === 5) {
    body = `
      <h1>You, once it’s going well</h1>
      <fieldset><legend class="spread" style="width:100%">How you show you care<span class="hint">Pick 2</span></legend><div class="chips">${c.CARE.map((x) => opt('checkbox', 'care', x.id, x.label, (a.care || []).includes(x.id))).join('')}</div></fieldset>
      ${['together', 'disagree', 'texting'].map((k) => choice(c, k, a)).join('')}`;
  } else if (step === 6) {
    body = `
      <p class="eyebrow">Your secret wishlist</p>
      <h1>What date would you secretly love someone to plan for you?</h1>
      <p class="lead">Pick as many as you like. Matches never see this list. We turn it into ideas for them, one at a time, once you’re past a first date.</p>
      <fieldset><legend class="sr">Wishlist</legend><div class="list-opts">${c.WISHES.map((w) => opt('checkbox', 'wishlist', w.id, w.label, (a.wishlist || []).includes(w.id))).join('')}</div></fieldset>
      <div class="field"><label for="own">Or write your own</label><input class="input" id="own" name="wishlist_own" maxlength="200" value="${esc(a.wishlist_own || '')}" placeholder="A bookshop crawl ending in dumplings…"><span class="hint">Only used by the person planning matches, never shown to anyone.</span></div>`;
  } else if (step === 7) {
    const favs = [...(a.favourites || []), '', '', '', '', ''].slice(0, 5);
    body = `
      <h1>What do you love?</h1>
      <p class="lead">This is how we match you, and it’s the first thing a match sees you have in common.</p>
      <fieldset><legend>Pick up to 12</legend><div class="chips">${c.LOVES.map((l) => opt('checkbox', 'loves', l, l, (a.loves || []).includes(l))).join('')}</div></fieldset>
      <fieldset><legend>Up to five favourites</legend><span class="hint">Films, shows, books, albums or places.</span>
        ${favs.map((f, i) => `<input class="input" name="fav" aria-label="Favourite ${i + 1}" maxlength="80" value="${esc(f)}">`).join('')}</fieldset>`;
  } else {
    const prompts = [...(a.prompts || []), {}, {}, {}].slice(0, 3);
    body = `
      <h1>What your match sees first</h1>
      <p class="lead">2 to 4 recent photos of you, and up to three prompts to give them something to ask about.</p>
      <div id="photo-grid" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px"></div>
      <span class="hint" id="photo-msg">Tap a square to add or change a photo. The first one is your main photo.</span>
      <input id="photo-in" type="file" accept="image/*" hidden>
      <div class="field"><label for="job">What you do <span class="muted" style="font-weight:400">Optional</span></label><input class="input" id="job" name="job" maxlength="60" value="${esc(me.job || '')}" placeholder="Designer, nurse, studying law…"></div>
      ${prompts.map((p, i) => `<div class="card stack" style="gap:8px">
        <label class="small muted" for="pq${i}">Prompt ${i + 1}${i ? ' (optional)' : ''}</label>
        <select class="input" id="pq${i}" name="pq${i}"><option value="">Choose a prompt</option>${c.PROMPTS.map((q) => `<option ${p.q === q ? 'selected' : ''}>${esc(q)}</option>`).join('')}</select>
        <textarea class="input" name="pa${i}" maxlength="200" aria-label="Your answer to prompt ${i + 1}" style="min-height:70px" placeholder="Your answer">${esc(p.a || '')}</textarea></div>`).join('')}
      <div class="field"><label for="about">A line or two about you <span class="muted" style="font-weight:400">Optional</span></label>
        <textarea class="input" id="about" name="about" maxlength="500">${esc(me.about)}</textarea></div>
      <a class="btn" href="#/me/preview">Preview my profile</a>`;
  }
  const backTo = editing ? '#/me' : step > 1 ? `#/setup/${step - 1}` : '#/setup';
  render(`
    <div class="stack">
      <div class="spread"><a class="linkish quiet" href="${backTo}">${icon.back} ${editing ? 'Cancel' : 'Back'}</a>
        <span class="small muted">${editing ? 'Editing' : `${step} of ${total}`} · ${esc(SECTIONS[step - 1].title)}</span></div>
      ${editing ? '' : `<div class="progress"><div style="width:${Math.round((step / total) * 100)}%"></div></div>`}
    </div>
    <form id="step" class="stack-lg" novalidate>
      ${body}
      <p class="error" id="s-err"></p>
      <button class="btn primary block" type="submit">${editing ? 'Save' : step === total ? 'Finish' : 'Continue'}</button>
    </form>
  `);
  if (step === total) renderPhotoGrid();
  $('#step').addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    busy(btn, async () => {
      const f = formData(e.target);
      const payload = {};
      const pick = (...keys) => Object.fromEntries(keys.map((k) => [k, f[k] ?? null]));
      if (step === 1) {
        if (!f.looking_for) throw new ApiError('Please choose what you’re looking for.');
        payload.answers = { ...pick('looking_for', 'serious_when'), age_min: Number(f.age_min), age_max: Number(f.age_max), travel_mins: Number(f.travel_mins) };
      } else if (step === 2) {
        if (!f.kids) throw new ApiError('Please answer the question about kids.');
        payload.answers = pick('kids', 'date_with_kids', 'five_years', 'last_relationship');
      } else if (step === 3) {
        payload.answers = pick('drinking', 'smoking', 'cannabis', 'exercise', 'weekends', 'rhythm', 'pets');
      } else if (step === 4) {
        if (!f.values || !f.energy) throw new ApiError('Please choose what makes a good date and your pace.');
        if (!(f.free || []).length) throw new ApiError('Please choose when you’re usually free.');
        payload.answers = { values: f.values, energy: f.energy, free: f.free, budget: Number(f.budget || 2), alcohol_free: !!f.alcohol_free, dietary: f.dietary };
      } else if (step === 5) {
        if ((f.care || []).length > 2) throw new ApiError('Please pick up to 2.');
        payload.answers = { care: f.care || [], ...pick('together', 'disagree', 'texting') };
      } else if (step === 6) {
        payload.answers = { wishlist: f.wishlist || [], wishlist_own: f.wishlist_own };
      } else if (step === 7) {
        if ((f.loves || []).length > 12) throw new ApiError('Please pick up to 12.');
        payload.answers = { loves: f.loves || [], favourites: $$('input[name=fav]').map((i) => i.value).filter((x) => x.trim()) };
      } else {
        if ((me.photo_slots || []).length < 2 && !editing) throw new ApiError('Please add at least two photos.');
        payload.job = f.job;
        payload.about = f.about;
        payload.answers = { prompts: [0, 1, 2].map((i) => ({ q: f[`pq${i}`], a: f[`pa${i}`] })).filter((p) => p.q && p.a && p.a.trim()) };
      }
      me = await api('PUT', '/api/me', payload);
      if (editing) { toast('Saved.'); go('#/me'); return; }
      if (step === total) {
        if (firstOpenSection() > 0) { toast('Nearly there: a few sections still need answers.'); go('#/setup'); return; }
        me = await api('PUT', '/api/me', { setup_done: true });
        toast('You’re all set.');
        go('#/home');
      } else go(`#/setup/${step + 1}`);
    }, $('#s-err'));
  });
}

/** The four photo squares on the photos step. Slot 0 is the main photo. */
function renderPhotoGrid() {
  const grid = $('#photo-grid');
  if (!grid) return;
  const filled = new Set(me.photo_slots || []);
  grid.innerHTML = [0, 1, 2, 3].map((slot) => filled.has(slot)
    ? `<div><div style="position:relative"><button type="button" class="photo-hero" data-slot="${slot}" aria-label="Change photo ${slot + 1}" style="aspect-ratio:3/4;border:none;padding:0;cursor:pointer" data-own-slot="${slot}">${icon.person}</button>
        ${slot === Math.min(...filled) ? '<span class="tag" style="position:absolute;left:6px;bottom:6px;background:rgba(28,26,31,.75);color:#fff;font-size:10px;padding:3px 6px;pointer-events:none">MAIN</span>' : ''}</div>
        <button type="button" class="linkish quiet small" data-remove="${slot}" style="min-height:32px;font-size:12px">Remove</button></div>`
    : `<button type="button" class="photo-hero" data-slot="${slot}" aria-label="Add a photo" style="aspect-ratio:3/4;background:#fff;border:1.5px dashed #D6CBBF;cursor:pointer;color:var(--wine);font-size:24px">+</button>`).join('');
  for (const el of $$('[data-own-slot]')) {
    const slot = el.dataset.ownSlot;
    api('GET', `/api/photos/${me.id}?slot=${slot}`).then((r) => { if (r.data && el.isConnected) el.innerHTML = `<img src="${r.data}" alt="">`; }).catch(() => {});
  }
  let target = 0;
  const input = $('#photo-in');
  $$('[data-slot]').forEach((b) => b.addEventListener('click', () => { target = Number(b.dataset.slot); input.value = ''; input.click(); }));
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const msg = $('#photo-msg');
    msg.textContent = 'Uploading…';
    try {
      const data = await resizePhoto(file);
      const r = await api('PUT', `/api/me/photos/${target}`, { data });
      me.photo_slots = r.slots;
      me.has_photo = true;
      photoCache.clear();
      msg.textContent = 'Photo saved.';
      renderPhotoGrid();
    } catch (err) {
      msg.textContent = err.message || 'Could not use that photo.';
    }
  };
  $$('[data-remove]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
    const r = await api('POST', `/api/me/photos/${b.dataset.remove}/delete`);
    me.photo_slots = r.slots;
    photoCache.clear();
    renderPhotoGrid();
  })));
}

function resizePhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = 900;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      let q = 0.82;
      let data = canvas.toDataURL('image/jpeg', q);
      while (data.length > 600 * 1024 && q > 0.4) { q -= 0.12; data = canvas.toDataURL('image/jpeg', q); }
      URL.revokeObjectURL(img.src);
      resolve(data);
    };
    img.onerror = () => reject(new Error('That file isn’t an image we can read.'));
    img.src = URL.createObjectURL(file);
  });
}

// ---------- profile (what a match sees) ----------

const heart = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/></svg>';

function photoBlock(p, n) {
  if (n >= p.photo_count) return '';
  return `<div class="photo-hero" data-photo="${esc(p.id)}" data-n="${n}" role="img" aria-label="${esc(p.name)}, photo ${n + 1}" style="aspect-ratio:4/5">${icon.person}</div>`;
}

function promptBlock(p, i) {
  const x = p.prompts[i];
  if (!x) return '';
  return `<section class="card"><p class="small" style="color:var(--wine);font-weight:600">${esc(x.q)}</p><p style="font:500 22px/1.25 var(--display)">${esc(x.a)}</p></section>`;
}

/** The full profile. `shared` is what you have in common (null on your own preview). */
function profileBlocks(p, shared) {
  const sharedLoves = new Set(shared?.loves || []);
  const sharedLines = [];
  if (shared) {
    if (shared.loves.length || shared.favourites.length) {
      sharedLines.push(`${shared.loves.length ? `You both love <strong>${shared.loves.map(esc).join(', ')}</strong>` : ''}${shared.loves.length && shared.favourites.length ? ', and you' : shared.favourites.length ? 'You' : ''}${shared.favourites.length ? ` both named <strong>${shared.favourites.map(esc).join(', ')}</strong>` : ''}.`);
    }
    if (shared.values) sharedLines.push(`You both said a good date is <strong>${esc(shared.values.toLowerCase())}</strong>.`);
    if (shared.free?.length) sharedLines.push(`You’re both usually free on <strong>${shared.free.map((f) => esc(f.toLowerCase())).join(' and ')}</strong>.`);
  }
  return `
    <section class="stack">
      <div class="photo-hero" data-photo="${esc(p.id)}" data-n="0" data-cycle="${p.photo_count}" role="img" aria-label="${esc(p.name)}" style="aspect-ratio:4/5;cursor:${p.photo_count > 1 ? 'pointer' : 'default'};position:relative">${icon.person}</div>
      ${p.photo_count > 1 ? `<p class="hint center">Tap the photo to see more (${p.photo_count})</p>` : ''}
      <div class="stack" style="gap:6px">
        <h1 style="font-size:32px">${esc(p.name)}, ${esc(p.age)}</h1>
        <p class="muted">${p.job ? `${esc(p.job)} · ` : ''}${esc(p.city)}</p>
        ${p.looking_for ? `<p><span class="tag wine">${esc(p.looking_for)}</span></p>` : ''}
      </div>
      ${p.facts.length ? `<div class="chips">${p.facts.map((f) => `<span class="tag">${esc(f)}</span>`).join('')}</div>` : ''}
    </section>
    ${sharedLines.length ? `<section class="card accent"><p class="eyebrow">What you share</p>${sharedLines.map((l) => `<p class="row" style="align-items:flex-start;flex-wrap:nowrap;color:var(--ink-2)"><span style="color:var(--wine);margin-top:3px">${heart}</span><span>${l}</span></p>`).join('')}</section>` : ''}
    ${promptBlock(p, 0)}
    ${photoBlock(p, 1)}
    ${p.loves.length || p.favourites.length ? `<section class="card">
      ${p.loves.length ? `<p class="eyebrow" style="color:var(--muted)">${esc(p.name)} loves</p><div class="chips">${p.loves.map((l) => `<span class="tag ${sharedLoves.has(l) ? 'wine' : ''}">${esc(l)}</span>`).join('')}</div>` : ''}
      ${p.favourites.length ? `<p class="eyebrow" style="color:var(--muted)">Favourites</p><p class="muted">${p.favourites.map(esc).join(' · ')}</p>` : ''}
    </section>` : ''}
    ${promptBlock(p, 1)}
    ${p.about ? `<section class="card"><p class="eyebrow" style="color:var(--muted)">About ${esc(p.name)}</p><p>${esc(p.about)}</p></section>` : ''}
    ${p.how_they_date.length ? `<section class="card"><p class="eyebrow" style="color:var(--muted)">How ${esc(p.name)} dates</p>${p.how_they_date.map((x) => `<p class="muted">${esc(x)}</p>`).join('')}</section>` : ''}
    ${photoBlock(p, 2)}
    ${promptBlock(p, 2)}
    ${photoBlock(p, 3)}`;
}

/** Tap the main photo to step through the others. */
function bindPhotoCycle() {
  for (const el of $$('[data-cycle]')) {
    const count = Number(el.dataset.cycle);
    if (count < 2) continue;
    el.addEventListener('click', async () => {
      const n = (Number(el.dataset.n) + 1) % count;
      el.dataset.n = n;
      const data = await photoData(el.dataset.photo, n);
      if (data && el.isConnected) el.innerHTML = `<img src="${data}" alt="">`;
    });
  }
}

async function previewView() {
  const p = await api('GET', '/api/me/profile');
  render(`
    <div class="spread"><a class="linkish quiet" href="#/setup/8">${icon.back} Back</a><span class="small muted">Preview</span></div>
    <div class="notice">${icon.lock}<span>This is exactly what a match sees. Your private answers and secret wishlist aren’t shown.</span></div>
    ${profileBlocks(p, null)}
  `, { active: 'me' });
  bindPhotoCycle();
}

// ---------- home ----------

const TODO_TEXT = {
  respond_plan: (n) => `Your match with ${n} comes with a first date plan. Are you in?`,
  review_plan: (n) => `${n} planned your next date. Take a look.`,
  checkin: (n) => `How was your date with ${n}? Check in.`,
  plan_next: (n) => `Plan your next date with ${n}.`,
  just_us: (n) => `A private question about you and ${n}.`,
  official: (n) => `A private question about you and ${n}.`,
  reflect: (n) => `A quiet word about you and ${n}.`,
  check_in: (n) => `How are things feeling with ${n}?`,
};

function todoLink(m, t) {
  if (t === 'just_us' || t === 'official') return `#/match/${m.id}/prompt/${t}`;
  return `#/match/${m.id}`;
}

function statusLine(m) {
  if (m.status === 'closed') return 'Closed';
  if (m.status === 'couple') return 'Official';
  if (m.status === 'dating') {
    const bits = [`${m.dates_done} date${m.dates_done === 1 ? '' : 's'}`];
    if (m.just_us) bits.push('Just us');
    if (m.next_date) bits.push(`next: ${when(m.next_date.starts_at)}`);
    return bits.join(' · ');
  }
  if (!m.next_date) return 'Finding another first date idea';
  return m.next_date.status === 'confirmed' ? `First date: ${when(m.next_date.starts_at)}` : 'First date plan waiting';
}

async function homeView() {
  render('<p class="loading">Loading…</p>', { active: 'home' });
  const data = await api('GET', '/api/home');
  me = data.me;
  const open = data.matches.filter((m) => m.status !== 'closed');
  const closed = data.matches.filter((m) => m.status === 'closed');
  const todos = open.flatMap((m) => m.todos.map((t) => ({ m, t })));
  const card = (m) => `
    <a class="card-link" href="#/match/${m.id}"><div class="card"><div class="match-row">
      ${photoTag(m.partner.id, m.partner.name)}
      <div class="who"><strong>${esc(m.partner.name)}, ${esc(m.partner.age)}</strong><p class="small muted">${esc(statusLine(m))}</p></div>
      ${m.status === 'couple' ? '<span class="tag wine">Official</span>' : m.todos.length ? '<span class="tag wine">Your move</span>' : ''}
    </div></div></a>`;
  render(`
    <div class="stack">
      <p class="eyebrow">Hi ${esc(me.name)}</p>
      <h1>This week</h1>
    </div>
    ${me.status === 'paused' ? '<div class="notice">You’re paused, so you won’t get new matches. Turn this off under You.</div>' : ''}
    ${firstOpenSection() > 0 ? `<a class="card-link" href="#/setup"><div class="card accent"><strong>We’ve added a few questions</strong><p class="small muted">About five minutes. Your answers help us pick better matches and plan better dates.</p></div></a>` : ''}
    ${todos.length ? `<section class="stack"><h2>To do</h2>${todos.map(({ m, t }) => `
      <a class="card-link" href="${todoLink(m, t)}"><div class="card accent"><div class="match-row">
        ${photoTag(m.partner.id, m.partner.name)}<p class="who">${esc(TODO_TEXT[t](m.partner.name))}</p></div></div></a>`).join('')}</section>` : ''}
    <section class="stack">
      <h2>Your matches</h2>
      ${open.length ? open.map(card).join('') : `<div class="card sand"><p>No matches right now. Matches are picked by hand, up to three a week, and each one comes with a planned first date. They’ll appear here.</p></div>`}
    </section>
    ${closed.length ? `<section class="stack"><h2 class="muted" style="font-size:18px">Recently closed</h2>${closed.map(card).join('')}</section>` : ''}
    <p class="small muted">Sequel doesn’t send notifications yet, so check back here.</p>
  `, { active: 'home' });
}

// ---------- match ----------

async function loadMatch(id) {
  return api('GET', `/api/matches/${id}`);
}

async function matchView(id) {
  render('<p class="loading">Loading…</p>', { active: 'home' });
  const d = await loadMatch(id);
  renderMatch(d);
}

function renderMatch(d) {
  const p = d.partner;
  const done = d.dates.filter((x) => x.status === 'done');
  // Deciding on a first date: the profile comes first, the plan after it.
  // Once you've met: what's happening now comes first, the profile further down.
  const deciding = d.status === 'proposed' && !d.dates.some((x) => x.status === 'confirmed' || x.status === 'done');
  const header = `<div class="match-row">${photoTag(p.id, p.name)}<div class="who"><h2>${esc(p.name)}, ${esc(p.age)}</h2><p class="small muted">${p.job ? `${esc(p.job)} · ` : ''}${esc(p.city)}</p></div></div>`;
  render(`
    <a class="linkish quiet" href="#/home">${icon.back} This week</a>
    ${deciding ? profileBlocks(p, d.shared) : header}
    ${stateBlock(d)}
    ${d.can_message || d.messages.length ? messagesBlock(d) : ''}
    ${done.length ? `<section class="card"><h3>Your dates</h3><div class="timeline">${done.map((x) => `
      <div class="t"><span class="dot"></span><div class="stack" style="gap:4px"><strong>${esc(x.title)}</strong><span class="small muted">${day(x.starts_at)}${x.place ? ` · ${esc(x.place)}` : ''}</span>
      ${x.note_from_them ? `<p class="small">${esc(p.name)} wrote: “${esc(x.note_from_them)}”</p>` : ''}</div></div>`).join('')}</div></section>` : ''}
    ${deciding ? '' : `<details class="card"><summary style="cursor:pointer;font-weight:600;min-height:28px">${esc(p.name)}’s profile</summary><div class="stack-lg" style="margin-top:12px">${profileBlocks(p, d.shared)}</div></details>`}
    <section class="stack">
      ${d.status === 'dating' && !d.i_asked_official && !d.prompts_due.includes('official') ? `<button class="linkish" id="start-official">Make it official with ${esc(p.name)}</button>` : ''}
      ${d.can_step_back ? `<a class="linkish quiet" href="#/match/${d.id}/step-back">Step back from this</a>` : ''}
      ${d.status !== 'closed' ? `<a class="linkish danger" href="#/match/${d.id}/report">${icon.shield} I felt unsafe: report and leave</a>` : `<a class="linkish quiet" href="#/match/${d.id}/report">Report ${esc(p.name)}</a>`}
    </section>
  `, { active: 'home' });
  bindMatch(d);
  bindPhotoCycle();
  // Photos inside a closed <details> load when it opens.
  $('details')?.addEventListener('toggle', hydratePhotos, { once: true });
}

function dateCard(d, x, label) {
  return `
    <div class="card dark">
      <div class="row">${icon.cal}<span class="eyebrow">${esc(label)}</span></div>
      <h3 style="font-size:21px">${esc(x.title)}</h3>
      <p class="muted">${esc(when(x.starts_at))}${x.place ? ` · ${esc(x.place)}` : ''}</p>
      ${x.details ? `<p class="muted small">${esc(x.details)}</p>` : ''}
      ${x.hint ? `<p class="badge" style="color:var(--blush)">${icon.star} We think ${esc(d.partner.name)} would love this</p>` : ''}
      <div id="date-actions" class="row"></div>
    </div>`;
}

function stateBlock(d) {
  const name = esc(d.partner.name);
  const out = [];
  if (d.status === 'closed') {
    out.push(`<section class="card sand"><p>${esc(d.closed_message)}</p>
      ${d.closing_note ? `<p>${name} left you a note:</p><p><em>“${esc(d.closing_note)}”</em></p>` : ''}</section>`);
    return out.join('');
  }
  if (d.status === 'couple') {
    out.push(`<section class="card wine"><div class="row">${icon.heart}<h2>It’s official</h2></div>
      <p class="muted">You and ${name} both said yes. Your story so far moves into Resonance, the app for couples.</p>
      <a class="btn light" href="${RESONANCE_URL}" target="_blank" rel="noopener">Open Resonance</a></section>`);
  }
  if (d.must_check_in) {
    out.push(`<section class="card accent"><h3>How was your date with ${name}?</h3>
      <p class="muted small">Your answers are private. Results arrive once you’ve both checked in.</p>
      <a class="btn wine" href="#/match/${d.id}/checkin/${d.must_check_in}">Check in</a></section>`);
  }
  for (const kind of d.prompts_due) {
    out.push(`<section class="card accent"><h3>${kind === 'just_us' ? 'A private question about you two' : `Want to make it official with ${name}?`}</h3>
      <a class="btn wine" href="#/match/${d.id}/prompt/${kind}">Answer privately</a></section>`);
  }
  if (d.reflection === 'reflect') {
    out.push(`<section class="card sand"><p>No rush. Is something holding you back with ${name}? It’s fine to keep dating, and fine to step back if this isn’t right.</p></section>`);
  } else if (d.reflection === 'check_in') {
    out.push(`<section class="card sand"><p>How are things feeling with ${name}? Are you getting what you want from this? Only you can answer that, and either answer is okay.</p></section>`);
  }
  const open = d.dates.find((x) => x.status === 'proposed' || x.status === 'confirmed');
  if (open && !(open.checkin_open && !open.i_checked_in)) {
    if (open.status === 'proposed' && open.n === 1) {
      out.push(dateCard(d, open, 'Suggested first date'));
    } else if (open.status === 'proposed') {
      out.push(dateCard(d, open, open.planned_by === 'me' ? `You suggested date ${open.n}` : `${d.partner.name} planned date ${open.n}`));
    } else if (open.status === 'confirmed') {
      out.push(dateCard(d, open, `Date ${open.n} is on`));
      if (open.checkin_open && open.i_checked_in && !open.they_checked_in) {
        out.push(`<p class="small muted">Thanks for checking in. You’ll see the result once ${name} has too, or within three days.</p>`);
      } else {
        out.push(`<section class="card"><p class="eyebrow">A question for this date</p><p style="font:500 18px var(--display)">${esc(open.question)}</p></section>`);
      }
    }
  }
  if (!open && d.status === 'proposed' && d.asked_for_another_idea) {
    out.push(`<section class="card sand"><p>We’re finding another first date idea for you and ${name}. It’ll appear here.</p></section>`);
  }
  if (d.declined) {
    out.push(`<section class="card sand"><p>${d.declined.by_me ? 'You asked for something else instead of' : `${name} would like something else instead of`} “${esc(d.declined.title)}”.</p>
      ${d.declined.note ? `<p class="small muted">“${esc(d.declined.note)}”</p>` : ''}</section>`);
  }
  const doneCount = d.dates.filter((x) => x.status === 'done').length;
  if (d.status === 'dating' && doneCount === 1 && !open) {
    out.push(`<section class="card wine"><div class="row">${icon.heart}<h2>You both said yes</h2></div>
      <p class="muted">Second date unlocked. ${d.my_turn ? 'Pick an idea below and send it over.' : `It’s ${name}’s turn to plan this one.`}</p></section>`);
  }
  if (d.status === 'dating' && !open) {
    if (d.my_turn) {
      out.push(`<section class="stack"><div class="spread"><h2>Ideas for your next date</h2></div>
        ${d.ideas.map((i) => `<div class="card ${i.hint ? 'accent' : ''}">
          ${i.hint ? `<span class="badge">${icon.star} We think ${name} would love this</span>` : ''}
          <strong>${esc(i.title)}</strong><div><button class="btn small" data-plan="${esc(i.id)}">Plan this</button></div>
          <div data-plan-form="${esc(i.id)}"></div></div>`).join('')}
        <div class="card"><strong>Something else</strong><div><button class="btn small" data-plan="custom">Plan it</button></div><div data-plan-form="custom"></div></div>
      </section>`);
    } else {
      out.push(`<section class="card sand"><p>It’s ${name}’s turn to plan your next date. You planned the last one.</p></section>`);
    }
  }
  return out.join('');
}

function messagesBlock(d) {
  return `<section class="card"><div class="spread"><h3>Messages</h3><button class="linkish quiet" id="refresh">Refresh</button></div>
    <div class="messages" id="msgs">${d.messages.length ? d.messages.map((m) => `<div class="msg ${m.mine ? 'mine' : ''}">${esc(m.body)}</div>`).join('') : '<p class="small muted">Sort out the details here: where exactly, how you’ll find each other.</p>'}</div>
    ${d.can_message ? `<form id="msg-form" class="row"><label class="grow"><span class="sr" style="position:absolute;left:-9999px">Message</span><input class="input" name="body" maxlength="1000" placeholder="Write a message" autocomplete="off"></label><button class="btn primary small" type="submit">Send</button></form>` : ''}
  </section>`;
}

function bindMatch(d) {
  const open = d.dates.find((x) => x.status === 'proposed' || x.status === 'confirmed');
  const actions = $('#date-actions');
  if (actions && open && open.status === 'proposed') {
    if (open.n === 1) {
      actions.innerHTML = open.i_accepted
        ? `<p class="muted">You’re in. Waiting for ${esc(d.partner.name)} to say yes${d.expires_at ? ` (by ${esc(when(d.expires_at))})` : ''}.</p>`
        : `<button class="btn light small" data-respond="accept">I’m in</button><button class="btn ghost-dark small" data-respond="another">Another idea</button><button class="btn ghost-dark small" data-respond="pass">Pass</button>
           ${d.expires_at ? `<p class="small muted" style="flex-basis:100%">Reply by ${esc(when(d.expires_at))}, or this match closes kindly.</p>` : ''}`;
    } else if (open.planned_by === 'me') {
      actions.innerHTML = `<p class="muted">Waiting for ${esc(d.partner.name)} to say yes.</p>`;
    } else {
      actions.innerHTML = `<button class="btn light" data-respond="accept">Sounds good</button><button class="btn ghost-dark" data-respond="decline">Suggest something else</button>`;
    }
  }
  $$('[data-respond]').forEach((btn) => btn.addEventListener('click', () => {
    const action = btn.dataset.respond;
    let note = '';
    if (action === 'pass' && !confirm(`Pass on ${d.partner.name}? The match will close kindly.`)) return;
    if (action === 'decline' || action === 'another') {
      note = prompt(action === 'decline' ? 'Anything you’d rather do instead? (optional)' : 'Anything that would suit you better? (optional)') ?? null;
      if (note === null) return;
    }
    busy(btn, async () => {
      const fresh = await api('POST', `/api/matches/${d.id}/respond`, { date_id: open.id, action, note });
      toast(action === 'accept' ? 'Saved.' : action === 'pass' ? 'Match closed.' : 'We’ve passed that on.');
      renderMatch(fresh);
    });
  }));
  $$('[data-plan]').forEach((btn) => btn.addEventListener('click', () => {
    $$('[data-plan-form]').forEach((el) => { el.innerHTML = ''; });
    const id = btn.dataset.plan;
    const holder = $(`[data-plan-form="${CSS.escape(id)}"]`);
    holder.innerHTML = `<form class="stack" data-plan-submit="${esc(id)}" novalidate>
      ${id === 'custom' ? '<div class="field"><label>What’s the plan?</label><input class="input" name="title" maxlength="120" required></div>' : ''}
      <div class="field"><label>When</label><input class="input" name="starts_at" type="datetime-local" required></div>
      <div class="field"><label>Where</label><input class="input" name="place" maxlength="160" placeholder="Venue, area or address"></div>
      <div class="field"><label>Anything else</label><input class="input" name="details" maxlength="500" placeholder="Tickets booked, meet at the entrance…"></div>
      <p class="error"></p>
      <button class="btn wine" type="submit">Send to ${esc(d.partner.name)}</button></form>`;
    holder.querySelector('input').focus();
    holder.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = formData(e.target);
      busy(e.target.querySelector('button'), async () => {
        if (!f.starts_at) throw new ApiError('Please choose a date and time.');
        const fresh = await api('POST', `/api/matches/${d.id}/dates`, {
          idea_id: id === 'custom' ? null : id, title: f.title, place: f.place, details: f.details,
          starts_at: new Date(f.starts_at).toISOString(),
        });
        toast('Sent.');
        renderMatch(fresh);
      }, e.target.querySelector('.error'));
    });
  }));
  $('#start-official')?.addEventListener('click', (e) => {
    if (!confirm(`Ask privately to make it official with ${d.partner.name}? They’ll only find out you said yes if they say yes too.`)) return;
    busy(e.target, async () => {
      const fresh = await api('POST', `/api/matches/${d.id}/prompt`, { kind: 'official', answer: 'yes' });
      toast('Saved privately.');
      renderMatch(fresh);
    });
  });
  $('#refresh')?.addEventListener('click', () => matchView(d.id));
  $('#msg-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.target.body;
    if (!input.value.trim()) return;
    busy(e.target.querySelector('button'), async () => {
      const fresh = await api('POST', `/api/matches/${d.id}/messages`, { body: input.value });
      renderMatch(fresh);
      const box = $('#msgs');
      if (box) box.scrollTop = box.scrollHeight;
      $('#msg-form input')?.focus();
    });
  });
  const box = $('#msgs');
  if (box) box.scrollTop = box.scrollHeight;
}

// ---------- check-in ----------

const Q = {
  happened: { q: 'Did the date happen?', o: [['yes', 'Yes'], ['no_show', 'They didn’t show']] },
  matched_profile: { q: 'Did they match their profile?', o: [['yes', 'Yes'], ['mostly', 'Mostly'], ['no', 'No']] },
  felt: { q: (n) => `How did you feel around ${n}?`, o: [['at_ease', 'At ease'], ['unsure', 'A bit unsure'], ['uneasy', 'Uneasy']] },
  conversation: { q: 'How was the conversation?', o: [['flowed', 'It flowed'], ['pauses', 'Some pauses'], ['hard', 'Hard work']] },
  plan_fit: { q: 'Did the plan suit you?', o: [['loved', 'Loved it'], ['fine', 'It was fine'], ['not_for_me', 'Not for me']] },
  again: { q: (n) => `Would you see ${n} again?`, o: [['yes', 'Yes'], ['not_sure', 'Not sure'], ['no', 'No']] },
};

async function checkinView(matchId, dateId) {
  render('<p class="loading">Loading…</p>', { active: 'home' });
  const d = await loadMatch(matchId);
  const date = d.dates.find((x) => x.id === dateId);
  if (!date || !date.checkin_open || date.i_checked_in) return go(`#/match/${matchId}`);
  const name = d.partner.name;
  const first = date.n === 1;
  const keys = first ? ['happened', 'matched_profile', 'felt', 'conversation', 'plan_fit', 'again'] : ['happened', 'felt', 'conversation', 'plan_fit'];
  const qBlock = (k) => {
    const q = typeof Q[k].q === 'function' ? Q[k].q(name) : Q[k].q;
    return `<fieldset data-q="${k}"><legend>${esc(q)}</legend><div class="seg">${Q[k].o.map(([v, l]) => opt('radio', k, v, l)).join('')}</div></fieldset>`;
  };
  const starters = ['Thanks for a lovely evening.', 'Loved your pick.', 'Good luck out there.'];
  render(`
    <a class="linkish quiet" href="#/match/${matchId}">${icon.back} Back</a>
    <div class="stack">
      <p class="eyebrow">Check-in · ${first ? '3 minutes' : '1 minute'}</p>
      <h1>How was your date with ${esc(name)}?</h1>
      <p class="muted">${esc(when(date.starts_at, { hour: undefined, minute: undefined }))} · ${esc(date.title)}</p>
    </div>
    <div class="notice">${icon.lock}<span>Your answers stay private. ${esc(name)} only learns ${first ? 'whether you <strong>both</strong> said yes' : 'that you checked in'}, plus any note you choose to send.</span></div>
    <form id="ci" class="stack-lg" novalidate>
      ${qBlock('happened')}
      <div id="rest" class="stack-lg">
        ${first ? '<p class="eyebrow" style="color:var(--muted)">The date</p>' : ''}
        ${keys.slice(1).filter((k) => k !== 'again').map(qBlock).join('')}
        <div id="uneasy" hidden class="notice">${icon.shield}<span>Thank you for telling us. Someone will look at this. If you felt unsafe, you can <a href="#/match/${matchId}/report">report and leave now</a>.</span></div>
        ${first ? `<p class="eyebrow" style="color:var(--muted)">What’s next</p>${qBlock('again')}` : ''}
        <div class="field"><label for="pn">Anything we should learn? <span class="muted" style="font-weight:400">Optional</span></label>
          <textarea class="input" id="pn" name="private_note" maxlength="1000" placeholder="Only used to improve your matches. ${esc(name)} never sees it."></textarea></div>
      </div>
      <div class="card accent">
        <label for="note" style="font-weight:600">Leave ${esc(name)} a note <span class="muted" style="font-weight:400">Optional</span></label>
        <p class="small muted">${esc(name)} sees it with the result, whatever you both chose. Keep it kind.</p>
        <div class="chips">${starters.map((s) => `<button type="button" class="tag" data-starter="${esc(s)}" style="border:none;cursor:pointer;min-height:36px">${esc(s)}</button>`).join('')}</div>
        <textarea class="input" id="note" name="note_to_them" maxlength="500"></textarea>
      </div>
      <p class="error" id="ci-err"></p>
      <button class="btn primary block" type="submit">Send check-in</button>
      <a class="linkish danger" href="#/match/${matchId}/report" style="justify-content:center">${icon.shield} I felt unsafe: leave and report</a>
    </form>
  `, { active: 'home' });
  const form = $('#ci');
  form.addEventListener('change', () => {
    const f = formData(form);
    $('#rest').hidden = f.happened === 'no_show';
    $('#uneasy').hidden = f.felt !== 'uneasy';
  });
  $$('[data-starter]').forEach((b) => b.addEventListener('click', () => {
    const t = $('#note');
    t.value = t.value ? `${t.value} ${b.dataset.starter}` : b.dataset.starter;
    t.focus();
  }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = formData(form);
    busy(form.querySelector('button[type=submit]'), async () => {
      const need = f.happened === 'no_show' ? ['happened'] : keys;
      if (need.some((k) => !f[k])) throw new ApiError('Please answer every question.');
      const body = { private_note: f.private_note, note_to_them: f.note_to_them };
      for (const k of need) body[k] = f[k];
      const fresh = await api('POST', `/api/dates/${dateId}/checkin`, body);
      toast('Check-in sent.');
      location.hash = `#/match/${matchId}`;
      renderMatch(fresh);
    }, $('#ci-err'));
  });
}

// ---------- Just us / make it official ----------

async function promptView(matchId, kind) {
  render('<p class="loading">Loading…</p>', { active: 'home' });
  const d = await loadMatch(matchId);
  const name = esc(d.partner.name);
  const done = d.dates.filter((x) => x.status === 'done');
  if (!d.prompts_due.includes(kind)) return go(`#/match/${matchId}`);
  const since = done.length ? day(done[0].starts_at) : '';
  const yesLabel = kind === 'just_us' ? 'Just us' : 'Yes, make it official';
  const body = kind === 'just_us' ? `
    <p class="eyebrow">Just between you and us</p>
    <h1>Are you still seeing other people?</h1>
    <p class="lead">You and ${name} have been on ${done.length} dates since ${esc(since)}.</p>
    <div class="card stack">
      <div class="row" style="align-items:flex-start">${icon.lock}<div class="grow"><strong>Your answer is private</strong><p class="small muted">${name} only finds out if you both say “Just us”.</p></div></div>
      <div class="row" style="align-items:flex-start">${icon.heart}<div class="grow"><strong>If you both do, matching pauses</strong><p class="small muted">No new matches for either of you.</p></div></div>
      <div class="row" style="align-items:flex-start">${icon.cal}<div class="grow"><strong>“Not yet” changes nothing</strong><p class="small muted">Dates and ideas carry on. We’ll ask again in a few weeks.</p></div></div>
    </div>` : `
    <p class="eyebrow">Just between you and us</p>
    <h1>Want to make it official with ${name}?</h1>
    <p class="lead">${done.length} dates so far. Your story:</p>
    <div class="card"><div class="timeline">${done.map((x) => `<div class="t"><span class="dot"></span><div class="spread grow"><span>${esc(x.title)}</span><span class="small muted">${day(x.starts_at)}</span></div></div>`).join('')}</div></div>
    <div class="notice">${icon.lock}<span>Private, like always. If you both say yes, it’s official and your story moves into Resonance. “Not yet” changes nothing.</span></div>`;
  render(`
    <a class="linkish quiet" href="#/match/${matchId}">${icon.back} Back</a>
    ${body}
    <div class="stack">
      <button class="btn wine block" data-answer="yes">${yesLabel}</button>
      <div class="row"><button class="btn grow" data-answer="not_yet">Not yet</button><button class="btn grow" data-answer="later">Ask me later</button></div>
      ${kind === 'just_us' ? `<button class="linkish" data-skip style="justify-content:center">Skip ahead: make it official</button>` : ''}
    </div>
  `, { active: 'home' });
  const answer = (k, a, el) => busy(el, async () => {
    const fresh = await api('POST', `/api/matches/${matchId}/prompt`, { kind: k, answer: a });
    toast(a === 'yes' ? 'Saved privately.' : a === 'later' ? 'We’ll ask again soon.' : 'Noted. Nothing changes.');
    location.hash = `#/match/${matchId}`;
    renderMatch(fresh);
  });
  $$('[data-answer]').forEach((b) => b.addEventListener('click', () => answer(kind, b.dataset.answer, b)));
  $('[data-skip]')?.addEventListener('click', (e) => answer('official', 'yes', e.target));
}

// ---------- report, step back ----------

async function reportView(matchId) {
  const c = await getContent();
  const d = await loadMatch(matchId);
  const name = esc(d.partner.name);
  render(`
    <a class="linkish quiet" href="#/match/${matchId}">${icon.back} Back</a>
    <h1>Report ${name}</h1>
    <p class="lead">You don’t need to finish a check-in. The match closes for both of you, you won’t be matched again, and ${name} isn’t told you reported them.</p>
    <form id="rep" class="card stack-lg" novalidate>
      <fieldset><legend>What happened?</legend><div class="list-opts">${c.REPORT_REASONS.map((r) => opt('radio', 'reason', r.id, r.label)).join('')}</div></fieldset>
      <div class="field"><label for="rd">Tell us more <span class="muted" style="font-weight:400">Optional</span></label><textarea class="input" id="rd" name="details" maxlength="2000"></textarea></div>
      <p class="small muted">If you’re in danger right now, call the emergency services.</p>
      <p class="error" id="r-err"></p>
      <button class="btn primary block" type="submit">Report and leave</button>
    </form>
  `, { active: 'home' });
  $('#rep').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = formData(e.target);
    busy(e.target.querySelector('button'), async () => {
      if (!f.reason) throw new ApiError('Please choose what happened.');
      await api('POST', '/api/report', { reported_id: d.partner.id, match_id: matchId, reason: f.reason, details: f.details });
      toast('Thank you. We’ll look at this.');
      go('#/home');
    }, $('#r-err'));
  });
}

async function stepBackView(matchId) {
  const d = await loadMatch(matchId);
  if (!d.can_step_back) return go(`#/match/${matchId}`);
  const name = esc(d.partner.name);
  render(`
    <a class="linkish quiet" href="#/match/${matchId}">${icon.back} Back</a>
    <h1>Step back from ${name}?</h1>
    <p class="lead">${name} gets a gentle message that this has come to an end. Neither of you will be shown to the other again.</p>
    <form id="sb" class="card stack-lg">
      <div class="field"><label for="sbn">Leave ${name} a note <span class="muted" style="font-weight:400">Optional</span></label>
        <textarea class="input" id="sbn" name="note" maxlength="500" placeholder="Thank you for the time we spent together…"></textarea><span class="hint">Keep it kind.</span></div>
      <p class="error" id="sb-err"></p>
      <button class="btn primary block" type="submit">Step back</button>
    </form>
  `, { active: 'home' });
  $('#sb').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.target.querySelector('button'), async () => {
      const fresh = await api('POST', `/api/matches/${matchId}/step-back`, formData(e.target));
      location.hash = `#/match/${matchId}`;
      renderMatch(fresh);
    }, $('#sb-err'));
  });
}

// ---------- you ----------

async function meView() {
  me = await getMe(true);
  const c = await getContent();
  render(`
    <h1>You</h1>
    <form id="prof" class="card stack-lg" novalidate>
      <div class="row">${photoTag(me.id, me.name, 'avatar lg')}<div class="stack grow">
        <a class="btn small" href="#/setup/8/edit">Photos and prompts</a><a class="linkish" href="#/me/preview">Preview my profile</a></div></div>
      <div class="field"><label for="m-name">First name</label><input class="input" id="m-name" name="name" value="${esc(me.name)}" maxlength="40"></div>
      <div class="field"><label for="m-city">City</label><input class="input" id="m-city" name="city" value="${esc(me.city)}" maxlength="60"></div>
      <fieldset><legend>I’d like to meet</legend><div class="seg">${[['woman', 'Women'], ['man', 'Men'], ['nonbinary', 'Non-binary people']].map(([v, l]) => opt('checkbox', 'seeking', v, l, me.seeking.includes(v))).join('')}</div></fieldset>
      <p class="error" id="m-err"></p>
      <button class="btn primary" type="submit">Save</button>
    </form>
    <section class="card">
      <h3>Your answers</h3>
      ${SECTIONS.slice(0, 7).map((s, i) => `<a class="linkish" href="#/setup/${i + 1}/edit">${esc(s.title)}${sectionDone(i + 1, me.answers || {}) ? '' : ' <span class="tag wine">to do</span>'}</a>`).join('')}
      <p class="small muted">Your wishlist: ${(me.answers.wishlist || []).map((id) => esc(c.WISHES.find((w) => w.id === id)?.label)).filter(Boolean).join(', ') || 'nothing yet'}. Only used for ideas, never shown.</p>
    </section>
    <section class="card">
      <h3>Pause matching</h3>
      <label class="toggle"><input type="checkbox" id="pause" ${me.status === 'paused' ? 'checked' : ''}> <span>Don’t send me new matches for now</span></label>
    </section>
    <section class="card">
      <h3>Use Sequel on another device</h3>
      <p class="small muted">Get a one-time sign-in link, valid for 7 days. Open it on your other phone or computer.</p>
      <div id="link-out"></div>
      <button class="btn small" id="mklink">Get a sign-in link</button>
    </section>
    <button class="linkish quiet" id="signout">Sign out</button>
  `, { active: 'me' });
  $('#prof').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = formData(e.target);
    busy(e.target.querySelector('button[type=submit]'), async () => {
      me = await api('PUT', '/api/me', { name: f.name, city: f.city, seeking: f.seeking });
      toast('Saved.');
    }, $('#m-err'));
  });
  $('#pause').addEventListener('change', (e) => busy(e.target, async () => {
    await api('POST', '/api/me/pause', { paused: e.target.checked });
    me.status = e.target.checked ? 'paused' : 'active';
    toast(e.target.checked ? 'Paused.' : 'Matching is on.');
  }));
  $('#mklink').addEventListener('click', (e) => busy(e.target, async () => {
    const { url } = await api('POST', '/api/me/signin-link');
    $('#link-out').innerHTML = copyBox(url);
    bindCopy();
  }));
  $('#signout').addEventListener('click', async () => {
    try { await api('POST', '/api/signout'); } catch { /* signing out anyway */ }
    signOutLocal();
    go('#/');
  });
}

function copyBox(url) {
  return `<div class="copy-box"><input class="input" readonly value="${esc(url)}" aria-label="Link"><button type="button" class="btn small" data-copy="${esc(url)}">Copy</button></div>`;
}

function bindCopy() {
  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copied.'); } catch { b.previousElementSibling.select(); }
  }));
}

// ---------- admin ----------

const statusTag = (s) => `<span class="tag ${s === 'couple' || s === 'dating' ? 'wine' : ''}">${esc(s)}</span>`;

async function adminView(tab) {
  render('<p class="loading">Loading…</p>', { wide: true, active: 'admin' });
  const data = await api('GET', '/api/admin');
  const openReports = data.reports.filter((r) => r.status === 'open').length;
  const needs = data.matches.filter((m) => m.status === 'proposed' && m.needs_idea && !m.open_date);
  const tabs = [['matches', `Matches${needs.length ? ` (${needs.length})` : ''}`], ['members', `Members (${data.users.length})`], ['invites', 'Invites'], ['reports', `Reports${openReports ? ` (${openReports})` : ''}`], ['waitlist', `Waitlist (${data.waitlist.length})`]];
  let body = '';
  if (tab === 'matches') {
    body = `
      ${needs.length ? `<section class="stack"><h2>Needs a new first date idea</h2>${needs.map((m) => `
        <div class="card accent"><strong>${esc(m.a_name)} and ${esc(m.b_name)}</strong><p class="small muted">Someone asked for another idea.</p>
          ${planForm(`plan-${m.id}`, 'Send new plan')}</div>`).join('')}</section>` : ''}
      <p class="muted">To make a match, open a member and pick someone from their suggestions.</p>
      <div class="table-wrap"><table><thead><tr><th>People</th><th>Status</th><th>Next date</th><th>Dates</th><th>Made</th></tr></thead><tbody>
      ${data.matches.map((m) => `<tr><td><a href="#/admin/user/${m.a_id}">${esc(m.a_name)}</a> &amp; <a href="#/admin/user/${m.b_id}">${esc(m.b_name)}</a></td>
        <td>${statusTag(m.status)}${m.just_us ? ' <span class="tag">Just us</span>' : ''}${m.closed_reason ? `<br><span class="small muted">${esc(m.closed_reason)}</span>` : ''}</td>
        <td>${m.open_date ? `${esc(m.open_date.title)}<br><span class="small muted">${esc(when(m.open_date.starts_at))} · ${esc(m.open_date.status)}</span>` : '—'}</td>
        <td>${m.dates_done}</td><td class="small muted">${day(m.created_at)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No matches yet.</td></tr>'}
      </tbody></table></div>`;
  } else if (tab === 'members') {
    body = `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Age</th><th>City</th><th>Meets</th><th>Setup</th><th>Reliability</th><th>Status</th><th>Open</th><th></th></tr></thead><tbody>
      ${data.users.map((u) => `<tr><td><a href="#/admin/user/${u.id}">${esc(u.name)}</a>${u.is_admin ? ' <span class="tag">admin</span>' : ''}${u.unavailable ? ' <span class="tag wine">taken</span>' : ''}</td>
        <td>${u.age}</td><td>${esc(u.city)}</td><td class="small">${esc(u.gender)} → ${esc(u.seeking.replace(/,/g, ', '))}</td>
        <td>${u.setup_done ? 'Done' : 'Not yet'}${u.has_photo ? '' : '<br><span class="small muted">no photo</span>'}</td><td>${u.reliability}</td><td>${esc(u.status)}</td><td>${u.open_matches}</td>
        <td><button class="linkish" data-signin="${u.id}">Sign-in link</button></td></tr>`).join('')}
      </tbody></table></div><div id="signin-out"></div>`;
  } else if (tab === 'invites') {
    body = `
      <form id="inv" class="card stack" novalidate>
        <h3>New invite link</h3>
        <div class="field"><label for="inv-note">Who it’s for (only you see this)</label><input class="input" id="inv-note" name="note" maxlength="120"></div>
        <label class="toggle"><input type="checkbox" name="admin" data-single="1"> <span>Make them an admin too</span></label>
        <button class="btn primary" type="submit">Create link</button>
        <div id="inv-out"></div>
        <p class="small muted">Each link works once and lasts 30 days. Send it to them yourself.</p>
      </form>
      <div class="table-wrap"><table><thead><tr><th>For</th><th>Created</th><th>Used by</th><th>Expires</th></tr></thead><tbody>
      ${data.invites.map((i) => `<tr><td>${esc(i.note || '—')}${i.make_admin ? ' <span class="tag">admin</span>' : ''}</td><td>${day(i.created_at)}</td><td>${esc(i.used_by_name || (i.used_at ? 'used' : '—'))}</td><td>${day(i.expires_at)}</td></tr>`).join('')}
      </tbody></table></div>`;
  } else if (tab === 'reports') {
    body = data.reports.length ? data.reports.map((r) => `
      <div class="card ${r.status === 'open' ? 'accent' : ''}">
        <div class="spread"><strong>${esc(r.reporter_name)} reported ${esc(r.reported_name)}</strong><span class="small muted">${esc(when(r.created_at))}</span></div>
        <p><span class="tag">${esc(r.reason)}</span></p>${r.details ? `<p>${esc(r.details)}</p>` : ''}
        ${r.status === 'open' ? `<form class="row" data-resolve="${r.id}"><input class="input grow" name="note" placeholder="What you did" maxlength="1000"><button class="btn small" type="submit">Resolve</button></form>
          <div class="row"><a class="linkish" href="#/admin/user/${r.reported_id}">Open ${esc(r.reported_name)}</a></div>` : `<p class="small muted">Resolved: ${esc(r.admin_note || '—')}</p>`}
      </div>`).join('') : '<p class="muted">No reports.</p>';
  } else {
    body = `<div class="table-wrap"><table><thead><tr><th>Email</th><th>City</th><th>Joined</th></tr></thead><tbody>
      ${data.waitlist.map((w) => `<tr><td>${esc(w.email)}</td><td>${esc(w.city)}</td><td>${day(w.created_at)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nobody yet.</td></tr>'}</tbody></table></div>`;
  }
  render(`
    <h1>Admin</h1>
    <div class="tabs" role="tablist">${tabs.map(([id, label]) => `<button role="tab" aria-selected="${id === tab}" class="${id === tab ? 'on' : ''}" data-tab="${id}">${esc(label)}</button>`).join('')}</div>
    ${body}
  `, { wide: true, active: 'admin' });
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => go(`#/admin/${b.dataset.tab}`)));
  $('#inv')?.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.target.querySelector('button[type=submit]'), async () => {
      const { url } = await api('POST', '/api/admin/invites', formData(e.target));
      $('#inv-out').innerHTML = copyBox(url);
      bindCopy();
    });
  });
  $$('[data-signin]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
    const { url } = await api('POST', `/api/admin/users/${b.dataset.signin}/signin-link`);
    $('#signin-out').innerHTML = `<div class="card"><p class="small muted">One-time sign-in link, valid 7 days:</p>${copyBox(url)}</div>`;
    bindCopy();
  })));
  $$('[data-resolve]').forEach((f) => f.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(f.querySelector('button'), async () => {
      await api('POST', `/api/admin/reports/${f.dataset.resolve}/resolve`, formData(f));
      adminView('reports');
    });
  }));
  for (const m of needs) bindPlanForm(`plan-${m.id}`, (plan) => api('POST', `/api/admin/matches/${m.id}/plan`, plan), () => adminView('matches'));
}

function planForm(id, label) {
  return `<form id="${id}" class="stack" novalidate>
    <div class="field"><label>First date plan</label><input class="input" name="title" maxlength="120" placeholder="A play you both have on your list"></div>
    <div class="row"><div class="field grow"><label>When</label><input class="input" name="starts_at" type="datetime-local"></div>
      <div class="field grow"><label>Where</label><input class="input" name="place" maxlength="160" placeholder="Venue, area"></div></div>
    <div class="field"><label>Details</label><input class="input" name="details" maxlength="500" placeholder="Tickets, where to meet"></div>
    <p class="error"></p><button class="btn wine" type="submit">${esc(label)}</button></form>`;
}

function bindPlanForm(id, send, done) {
  const form = document.getElementById(id);
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = formData(form);
    busy(form.querySelector('button'), async () => {
      if (!f.title || !f.starts_at) throw new ApiError('Add a plan and a time.');
      await send({ title: f.title, place: f.place, details: f.details, starts_at: new Date(f.starts_at).toISOString() });
      toast('Sent.');
      done();
    }, form.querySelector('.error'));
  });
}

async function adminUserView(id) {
  render('<p class="loading">Loading…</p>', { wide: true, active: 'admin' });
  const c = await getContent();
  const { user: u, candidates, filtered_out: filteredOut = [] } = await api('GET', `/api/admin/users/${id}`);
  const a = u.answers || {};
  const label = (list, v) => list.find((x) => String(x.id) === String(v))?.label || '—';
  const pq = (key) => label(c.PROFILE_Q[key].options, a[key]);
  const many = (list, ids) => (ids || []).map((x) => label(list, x)).join(', ') || '—';
  const qRows = [
    ['Looking for', `${pq('looking_for')} · serious: ${pq('serious_when')}`],
    ['Ages, travel', `${a.age_min || '?'}–${a.age_max || '?'} · up to ${a.travel_mins || '?'} min`],
    ['Kids', `${pq('kids')} · dates parents: ${pq('date_with_kids')}`],
    ['Five years · last relationship', `${pq('five_years')} · ${pq('last_relationship')} (private)`],
    ['Lifestyle', ['drinking', 'smoking', 'cannabis', 'exercise', 'weekends', 'rhythm', 'pets'].map((k) => `${c.PROFILE_Q[k].q.toLowerCase()}: ${pq(k)}`).join(' · ')],
    ['Free', many(c.FREE, a.free)],
    ['Relationship', `care: ${many(c.CARE, a.care)} · together: ${pq('together')} · disagree: ${pq('disagree')} · texting: ${pq('texting')}`],
    ['Job', u.job || '—'],
    ['Prompts', (a.prompts || []).map((p) => `<strong>${esc(p.q)}</strong>: ${esc(p.a)}`).join('<br>') || '—'],
  ];
  render(`
    <a class="linkish quiet" href="#/admin/members">${icon.back} Members</a>
    <section class="card">
      <div class="row">${photoTag(u.id, u.name, 'avatar lg')}<div class="grow stack" style="gap:4px">
        <h2>${esc(u.name)}, ${u.age}</h2><p class="muted">${esc(u.city)} · ${esc(u.gender)} → ${esc(u.seeking.join(', '))} · reliability ${u.reliability} · ${esc(u.status)}</p></div></div>
      ${u.about ? `<p>${esc(u.about)}</p>` : ''}
      <div class="table-wrap"><table><tbody>
        <tr><th>Good date</th><td>${esc(label(c.VALUES, a.values))}</td></tr>
        <tr><th>Pace</th><td>${esc(label(c.ENERGY, a.energy))}</td></tr>
        <tr><th>Budget</th><td>${esc(label(c.BUDGET, a.budget))}${a.alcohol_free ? ' · alcohol-free' : ''}${a.dietary ? ` · ${esc(a.dietary)}` : ''}</td></tr>
        <tr><th>Secret wishes</th><td>${u.wishes.map(esc).join(', ') || '—'}${a.wishlist_own ? `<br><em>${esc(a.wishlist_own)}</em>` : ''}</td></tr>
        <tr><th>Loves</th><td>${(a.loves || []).map(esc).join(', ') || '—'}</td></tr>
        <tr><th>Favourites</th><td>${(a.favourites || []).map(esc).join(', ') || '—'}</td></tr>
        ${qRows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${k === 'Prompts' ? v : esc(v)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="row">
        ${u.status !== 'paused' ? `<button class="btn small" data-status="paused">Pause</button>` : `<button class="btn small" data-status="active">Reactivate</button>`}
        ${u.status !== 'removed' ? `<button class="btn small" data-status="removed">Remove from Sequel</button>` : ''}
      </div>
    </section>
    <section class="stack">
      <h2>Suggested matches</h2>
      <p class="muted small">People who pass every firm filter both ways (who they want to meet, age ranges, what they’re looking for, kids), not blocked and never matched before, ranked by shared taste and free times.</p>
      ${candidates.length ? candidates.map((x) => `
        <div class="card"><div class="spread"><strong>${esc(x.name)}, ${x.age} · ${esc(x.city)}</strong><span class="tag ${x.score >= 5 ? 'wine' : ''}">score ${x.score}</span></div>
          <p class="small muted">${x.loves.length ? `Both love ${x.loves.map(esc).join(', ')}. ` : ''}${x.favourites.length ? `Both named ${x.favourites.map(esc).join(', ')}. ` : ''}${x.sameValues ? 'Same idea of a good date. ' : ''}${x.free.length ? `Both free ${x.free.map((f) => esc(f.toLowerCase())).join(', ')}. ` : ''}Reliability ${x.reliability}.</p>
          <div class="row"><a class="linkish" href="#/admin/user/${x.id}">Open ${esc(x.name)}</a><button class="btn small" data-match="${x.id}">Match with a first date</button></div>
          <div data-match-form="${x.id}"></div></div>`).join('') : '<p class="muted">Nobody suitable yet.</p>'}
      ${filteredOut.length ? `<details class="card"><summary style="cursor:pointer">Left out by firm filters (${filteredOut.length})</summary>
        <p class="small muted">${filteredOut.map((x) => `${esc(x.name)}: ${esc(x.reason.toLowerCase())}`).join(' · ')}</p></details>` : ''}
    </section>
  `, { wide: true, active: 'admin' });
  $$('[data-status]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.status === 'removed' && !confirm(`Remove ${u.name}? They’re signed out and their open matches close.`)) return;
    busy(b, async () => { await api('POST', `/api/admin/users/${u.id}/status`, { status: b.dataset.status }); adminUserView(u.id); });
  }));
  $$('[data-match]').forEach((b) => b.addEventListener('click', () => {
    const holder = $(`[data-match-form="${b.dataset.match}"]`);
    holder.innerHTML = planForm(`m-${b.dataset.match}`, 'Create match');
    bindPlanForm(`m-${b.dataset.match}`, (plan) => api('POST', '/api/admin/matches', { a_id: u.id, b_id: b.dataset.match, ...plan }), () => go('#/admin/matches'));
  }));
}

route();
