const GENRE_WEIGHT = 3; // genre tokens count more than free-text tag tokens
const MIN_CO_RATERS = 5; // minimum shared raters before we trust an item-item similarity
const SHRINKAGE = 15; // downweights similarities backed by few co-raters (Bell & Koren shrinkage)
const CF_WEIGHT = 0.65; // hybrid blend: CF vs content-based, when CF data is available
const POPULARITY_WEIGHT = 0.05; // small nudge toward well-known movies, breaks ties
const CF_EVIDENCE_SHRINK = 0.3; // pulls a candidate's CF score toward neutral when backed by weak/thin similarity
const CONTENT_EVIDENCE_SHRINK = 0.3; // same idea for the content-based score
const MIN_SUPPORT_RATING_COUNT = 20; // excludes movies almost nobody has rated: genre-only
  // content similarity ties easily at ~1.0 across many obscure titles sharing a rare genre
  // combo, and without real user validation there's no way to tell those apart from noise

function tokenizeTag(tag) {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Builds TF-IDF vectors for every movie from its genres + user tags. */
function buildContentIndex(movies) {
  const docFreq = new Map(); // term -> number of movies containing it
  const termLists = new Map(); // movieId -> [term, term, ...] (with repeats for weight)

  for (const movie of movies.values()) {
    const terms = [];
    for (const g of movie.genres) {
      const t = 'genre:' + g.toLowerCase();
      for (let i = 0; i < GENRE_WEIGHT; i++) terms.push(t);
    }
    for (const tag of movie.tags) {
      for (const t of tokenizeTag(tag)) terms.push(t);
    }
    termLists.set(movie.id, terms);

    const seen = new Set(terms);
    for (const t of seen) docFreq.set(t, (docFreq.get(t) || 0) + 1);
  }

  const numDocs = movies.size;
  const vectors = new Map(); // movieId -> Map(term -> tfidf weight)
  const norms = new Map(); // movieId -> vector norm

  for (const [movieId, terms] of termLists) {
    const tf = new Map();
    for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);

    const vec = new Map();
    let normSq = 0;
    for (const [t, count] of tf) {
      const idf = Math.log((numDocs + 1) / (docFreq.get(t) + 1)) + 1;
      const weight = count * idf;
      vec.set(t, weight);
      normSq += weight * weight;
    }
    vectors.set(movieId, vec);
    norms.set(movieId, Math.sqrt(normSq));
  }

  return { vectors, norms };
}

function contentSimilarity(movieIdA, movieIdB, contentIndex) {
  const vecA = contentIndex.vectors.get(movieIdA);
  const vecB = contentIndex.vectors.get(movieIdB);
  const normA = contentIndex.norms.get(movieIdA);
  const normB = contentIndex.norms.get(movieIdB);
  if (!vecA || !vecB || !normA || !normB) return 0;

  const [small, large] = vecA.size < vecB.size ? [vecA, vecB] : [vecB, vecA];
  let dot = 0;
  for (const [term, weight] of small) {
    const otherWeight = large.get(term);
    if (otherWeight) dot += weight * otherWeight;
  }
  return dot / (normA * normB);
}

/** Item-based adjusted-cosine similarity over users who rated both movies. */
function itemSimilarity(movieIdA, movieIdB, data, cache) {
  const key = movieIdA < movieIdB ? `${movieIdA}:${movieIdB}` : `${movieIdB}:${movieIdA}`;
  if (cache.has(key)) return cache.get(key);

  const ratersA = data.movieRaters.get(movieIdA);
  const ratersB = data.movieRaters.get(movieIdB);
  let result = 0;

  if (ratersA && ratersB) {
    const [small, large] = ratersA.size < ratersB.size ? [ratersA, ratersB] : [ratersB, ratersA];
    // Baseline = userMean + itemMean - globalMean. Centering on this (rather than just
    // userMean) strips out "everyone loves this movie" popularity effects, so similarity
    // reflects taste correlation instead of two blockbusters both being generally beloved.
    const globalMean = data.globalMeanRating;
    const baselineA = data.movies.get(movieIdA).avgRating - globalMean;
    const baselineB = data.movies.get(movieIdB).avgRating - globalMean;
    let numerator = 0;
    let sumSqA = 0;
    let sumSqB = 0;
    let coCount = 0;

    for (const [userId, ratingSmall] of small) {
      const ratingLarge = large.get(userId);
      if (ratingLarge === undefined) continue;
      const ratingA = small === ratersA ? ratingSmall : ratingLarge;
      const ratingB = small === ratersA ? ratingLarge : ratingSmall;
      const meanU = data.userMeans.get(userId) || 0;
      const devA = ratingA - meanU - baselineA;
      const devB = ratingB - meanU - baselineB;
      numerator += devA * devB;
      sumSqA += devA * devA;
      sumSqB += devB * devB;
      coCount++;
    }

    if (coCount >= MIN_CO_RATERS && sumSqA > 0 && sumSqB > 0) {
      const rawSim = numerator / (Math.sqrt(sumSqA) * Math.sqrt(sumSqB));
      result = rawSim * (coCount / (coCount + SHRINKAGE));
    }
  }

  cache.set(key, result);
  return result;
}

/**
 * Recommends movies given a user's ratings (Map or plain object: movieId -> 1..5).
 * Stateless: caller supplies the full rating set each call.
 */
function recommend(userRatingsInput, data, contentIndex, options = {}) {
  const limit = options.limit || 20;
  const ratedEntries =
    userRatingsInput instanceof Map
      ? [...userRatingsInput.entries()]
      : Object.entries(userRatingsInput).map(([id, r]) => [Number(id), r]);

  const ratedMap = new Map(ratedEntries);
  if (ratedMap.size === 0) return [];

  const userMeanRating =
    ratedEntries.reduce((acc, [, r]) => acc + r, 0) / ratedEntries.length;

  const simCache = new Map();
  const candidates = new Map(); // movieId -> { cfNum, cfDen, contentNum, contentDen }

  function touchCandidate(movieId) {
    if (ratedMap.has(movieId)) return null;
    if (!candidates.has(movieId)) {
      candidates.set(movieId, { cfNum: 0, cfDen: 0, contentNum: 0, contentDen: 0 });
    }
    return candidates.get(movieId);
  }

  // --- CF candidate discovery: movies liked by users who share tastes with us ---
  // This traversal only *discovers* which movieIds are reachable via co-raters (bounding
  // the search space); the actual similarity score is computed once per seed-candidate
  // pair below, so a movie doesn't get extra weight just because many co-raters happened
  // to like it (that would just reintroduce a popularity bias).
  const cfCandidateIds = new Set();
  for (const [ratedMovieId] of ratedEntries) {
    const raters = data.movieRaters.get(ratedMovieId);
    if (!raters) continue;

    for (const [userId, theirRatingOfSeed] of raters) {
      if (theirRatingOfSeed < 3.5) continue; // only trust their positive taste
      const theirMovies = data.userRatings.get(userId);
      if (!theirMovies) continue;

      for (const [candidateId, theirRating] of theirMovies) {
        if (ratedMap.has(candidateId)) continue;
        if (theirRating < 3.5) continue;
        cfCandidateIds.add(candidateId);
      }
    }
  }

  // --- CF scoring: once per (rated seed, candidate) pair ---
  for (const candidateId of cfCandidateIds) {
    const bucket = touchCandidate(candidateId);
    if (!bucket) continue;

    for (const [ratedMovieId, rating] of ratedEntries) {
      const sim = itemSimilarity(ratedMovieId, candidateId, data, simCache);
      if (sim > 0) {
        const dev = rating - userMeanRating;
        bucket.cfNum += sim * dev;
        bucket.cfDen += Math.abs(sim);
      }
    }
  }

  // --- Content-based candidates: genre/tag neighbors of movies the user liked ---
  const likedMovies = ratedEntries.filter(([, r]) => r >= 3.5);
  for (const [ratedMovieId, rating] of likedMovies) {
    const vecA = contentIndex.vectors.get(ratedMovieId);
    if (!vecA || vecA.size === 0) continue;

    for (const movieId of data.movies.keys()) {
      if (ratedMap.has(movieId)) continue;
      const sim = contentSimilarity(ratedMovieId, movieId, contentIndex);
      if (sim <= 0.05) continue;
      const bucket = touchCandidate(movieId);
      if (!bucket) continue;
      bucket.contentNum += sim * (rating / 5);
      bucket.contentDen += sim;
    }
  }

  const scored = [];
  for (const [movieId, bucket] of candidates) {
    const movie = data.movies.get(movieId);
    if (!movie) continue;
    if (movie.ratingCount < MIN_SUPPORT_RATING_COUNT) continue;

    const hasCf = bucket.cfDen > 0;
    const hasContent = bucket.contentDen > 0;
    if (!hasCf && !hasContent) continue;

    const cfScore = hasCf ? userMeanRating + bucket.cfNum / bucket.cfDen : null;

    // Shrink each score toward a neutral midpoint when the evidence behind it (total
    // similarity mass, bucket.*Den) is thin. Without this, a candidate barely related to
    // just one rated movie scores identically to one strongly related to it, because the
    // weighted-average formula only captures direction, not confidence.
    const cfConfidence = hasCf ? bucket.cfDen / (bucket.cfDen + CF_EVIDENCE_SHRINK) : 0;
    const cfMeanNorm = hasCf ? Math.max(0, Math.min(1, cfScore / 5)) : 0.5;
    const cfScoreNorm = hasCf ? 0.5 * (1 - cfConfidence) + cfMeanNorm * cfConfidence : 0;

    const contentConfidence = hasContent
      ? bucket.contentDen / (bucket.contentDen + CONTENT_EVIDENCE_SHRINK)
      : 0;
    const contentMeanNorm = hasContent ? bucket.contentNum / bucket.contentDen : 0.5;
    const contentScoreNorm = hasContent
      ? 0.5 * (1 - contentConfidence) + contentMeanNorm * contentConfidence
      : 0;

    let alpha;
    if (hasCf && hasContent) alpha = CF_WEIGHT;
    else if (hasCf) alpha = 1;
    else alpha = 0;

    const popularityNorm = Math.max(0, Math.min(1, movie.bayesianRating / 5));
    const hybridScore =
      (1 - POPULARITY_WEIGHT) * (alpha * cfScoreNorm + (1 - alpha) * contentScoreNorm) +
      POPULARITY_WEIGHT * popularityNorm;

    scored.push({
      movieId,
      title: movie.title,
      year: movie.year,
      genres: movie.genres,
      score: hybridScore,
      predictedRating: hasCf ? Math.round(cfScore * 10) / 10 : null,
      avgRating: Math.round(movie.avgRating * 10) / 10,
      ratingCount: movie.ratingCount,
      basis: hasCf && hasContent ? 'hybrid' : hasCf ? 'collaborative' : 'content',
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function searchMovies(query, data, limit = 20) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results = [];
  for (const movie of data.movies.values()) {
    if (movie.title.toLowerCase().includes(q)) results.push(movie);
  }
  results.sort((a, b) => b.ratingCount - a.ratingCount);
  return results.slice(0, limit).map((m) => ({
    movieId: m.id,
    title: m.title,
    year: m.year,
    genres: m.genres,
    avgRating: Math.round(m.avgRating * 10) / 10,
    ratingCount: m.ratingCount,
  }));
}

// Runs in Node (server.js) and in the browser (static site loads this as a plain script).
const exported = { buildContentIndex, recommend, searchMovies, contentSimilarity, itemSimilarity };
if (typeof module !== 'undefined' && module.exports) module.exports = exported;
else self.Recommender = exported;
