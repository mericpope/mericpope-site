const searchInput = document.getElementById('search-input');
const searchResultsEl = document.getElementById('search-results');
const myRatingsEl = document.getElementById('my-ratings');
const ratingCountEl = document.getElementById('rating-count');
const recommendBtn = document.getElementById('recommend-btn');
const statusMsg = document.getElementById('status-msg');
const recommendationsEl = document.getElementById('recommendations');

const STORAGE_KEY = 'wavelength:ratings:v1';

// Everything runs in the browser: data.json is loaded once and indexed locally.
let data = null;
let contentIndex = null;

// movieId -> { movieId, title, year, genres, avgRating, ratingCount, rating }
const myRatings = new Map();
let lastSearchResults = [];

function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    for (const m of saved) myRatings.set(m.movieId, m);
  } catch (e) {
    /* storage unavailable or corrupt: start empty */
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...myRatings.values()]));
  } catch (e) {
    /* private mode etc: ratings just won't persist */
  }
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function starRow(currentRating, onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'stars';
  for (let i = 1; i <= 5; i++) {
    const s = document.createElement('span');
    s.className = 'star' + (i <= currentRating ? ' filled' : '');
    s.textContent = '★';
    s.addEventListener('click', () => onPick(i));
    wrap.appendChild(s);
  }
  return wrap;
}

function movieMetaText(m) {
  const parts = [];
  if (m.year) parts.push(m.year);
  if (m.genres && m.genres.length) parts.push(m.genres.join(', '));
  if (m.avgRating) parts.push(`★ ${m.avgRating} (${m.ratingCount})`);
  return parts.join(' · ');
}

function movieInfo(m, extra = '') {
  const info = document.createElement('div');
  info.className = 'movie-info';
  const title = document.createElement('div');
  title.className = 'movie-title';
  title.textContent = m.title;
  const meta = document.createElement('div');
  meta.className = 'movie-meta';
  meta.textContent = movieMetaText(m) + extra;
  info.append(title, meta);
  return info;
}

function renderSearchResults(results) {
  searchResultsEl.innerHTML = '';
  for (const m of results) {
    const li = document.createElement('li');
    li.className = 'movie-item';

    const actions = document.createElement('div');
    actions.className = 'movie-actions';
    const existing = myRatings.get(m.movieId);
    actions.appendChild(starRow(existing ? existing.rating : 0, (stars) => rateMovie(m, stars)));

    li.append(movieInfo(m), actions);
    searchResultsEl.appendChild(li);
  }
}

function rateMovie(movie, rating) {
  const { movieId, title, year, genres, avgRating, ratingCount } = movie;
  myRatings.set(movieId, { movieId, title, year, genres, avgRating, ratingCount, rating });
  save();
  renderMyRatings();
  renderSearchResults(lastSearchResults);
}

function removeRating(movieId) {
  myRatings.delete(movieId);
  save();
  renderMyRatings();
  renderSearchResults(lastSearchResults);
}

function renderMyRatings() {
  myRatingsEl.innerHTML = '';
  ratingCountEl.textContent = myRatings.size ? `(${myRatings.size})` : '';
  recommendBtn.disabled = myRatings.size === 0 || !data;

  for (const m of myRatings.values()) {
    const li = document.createElement('li');
    li.className = 'movie-item';

    const actions = document.createElement('div');
    actions.className = 'movie-actions';
    actions.appendChild(starRow(m.rating, (stars) => rateMovie(m, stars)));
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', `Remove ${m.title}`);
    removeBtn.addEventListener('click', () => removeRating(m.movieId));
    actions.appendChild(removeBtn);

    li.append(movieInfo(m), actions);
    myRatingsEl.appendChild(li);
  }
}

function renderRecommendations(results) {
  recommendationsEl.innerHTML = '';
  if (results.length === 0) {
    const li = document.createElement('li');
    li.className = 'movie-meta';
    li.textContent = 'No recommendations found — try rating a few more movies.';
    recommendationsEl.appendChild(li);
    return;
  }
  for (const m of results) {
    const li = document.createElement('li');
    li.className = 'movie-item';

    const predicted = m.predictedRating ? ` · predicted ${m.predictedRating}★` : '';
    const badge = document.createElement('span');
    badge.className = 'badge' + (m.basis === 'hybrid' ? ' hybrid' : '');
    badge.textContent = m.basis;

    li.append(movieInfo(m, predicted), badge);
    recommendationsEl.appendChild(li);
  }
}

const doSearch = debounce((query) => {
  if (!data || !query.trim()) {
    searchResultsEl.innerHTML = '';
    lastSearchResults = [];
    return;
  }
  lastSearchResults = Recommender.searchMovies(query, data);
  renderSearchResults(lastSearchResults);
}, 150);

searchInput.addEventListener('input', (e) => doSearch(e.target.value));

recommendBtn.addEventListener('click', () => {
  statusMsg.textContent = 'Finding movies you might like...';
  recommendBtn.disabled = true;
  // Yield once so the status text paints before the (synchronous) scoring runs.
  setTimeout(() => {
    try {
      const ratings = new Map([...myRatings.values()].map((m) => [m.movieId, m.rating]));
      const results = Recommender.recommend(ratings, data, contentIndex, { limit: 20 });
      renderRecommendations(results);
      statusMsg.textContent = `Found ${results.length} recommendations.`;
    } catch (err) {
      statusMsg.textContent = `Error: ${err.message}`;
    } finally {
      recommendBtn.disabled = myRatings.size === 0;
    }
  }, 30);
});

async function init() {
  loadSaved();
  renderMyRatings();
  statusMsg.textContent = 'Loading movie data...';
  searchInput.disabled = true;
  try {
    const res = await fetch('data.json');
    if (!res.ok) throw new Error(`data.json: ${res.status}`);
    const compact = await res.json();
    const [users, movieIds, scores] = compact.ratings;
    data = BuildData.buildData({
      movies: compact.movies.map(([id, title, genres]) => ({ id, title, genres })),
      tags: compact.tags,
      ratings: users.map((u, i) => [u, movieIds[i], scores[i]]),
    });
    contentIndex = Recommender.buildContentIndex(data.movies);
    // Saved ratings keep working only for movies still in the dataset.
    for (const id of [...myRatings.keys()]) if (!data.movies.has(id)) myRatings.delete(id);
    searchInput.disabled = false;
    statusMsg.textContent = '';
    renderMyRatings();
  } catch (err) {
    statusMsg.textContent = `Couldn't load movie data (${err.message}). Try refreshing.`;
  }
}

init();
