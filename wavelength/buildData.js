// Turns raw MovieLens rows into the in-memory indices the recommender uses.
// Isomorphic: runs in Node (via dataLoader.js) and in the browser (static site).
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.BuildData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /**
   * @param {{movies: {id:number,title:string,genres:string}[],
   *          tags: [number,string][], ratings: [number,number,number][]}} raw
   *   movies[].genres is the pipe-separated MovieLens string; titles still carry "(year)".
   *   ratings rows are [userId, movieId, rating].
   */
  function buildData(raw) {
    const movies = new Map(); // movieId -> { id, title, year, genres: [], tags: [] }
    for (const row of raw.movies) {
      const match = row.title.match(/^(.*)\s\((\d{4})\)\s*$/);
      const title = match ? match[1] : row.title;
      const year = match ? Number(match[2]) : null;
      const genres = row.genres === '(no genres listed)' || !row.genres ? [] : row.genres.split('|');
      movies.set(row.id, { id: row.id, title, year, genres, tags: [] });
    }

    for (const [movieId, tag] of raw.tags) {
      const movie = movies.get(movieId);
      if (movie) movie.tags.push(tag.toLowerCase());
    }

    // Sparse rating structures for collaborative filtering.
    const movieRaters = new Map(); // movieId -> Map(userId -> rating)
    const userRatings = new Map(); // userId -> Map(movieId -> rating)
    const userMeans = new Map(); // userId -> average rating
    const movieStats = new Map(); // movieId -> { count, sum }
    let ratingSum = 0;
    let ratingN = 0;

    for (const [userId, movieId, rating] of raw.ratings) {
      if (!movies.has(movieId)) continue;

      if (!movieRaters.has(movieId)) movieRaters.set(movieId, new Map());
      movieRaters.get(movieId).set(userId, rating);

      if (!userRatings.has(userId)) userRatings.set(userId, new Map());
      userRatings.get(userId).set(movieId, rating);

      if (!movieStats.has(movieId)) movieStats.set(movieId, { count: 0, sum: 0 });
      const stats = movieStats.get(movieId);
      stats.count += 1;
      stats.sum += rating;

      ratingSum += rating;
      ratingN += 1;
    }

    for (const [userId, ratingsMap] of userRatings) {
      let sum = 0;
      for (const r of ratingsMap.values()) sum += r;
      userMeans.set(userId, sum / ratingsMap.size);
    }

    // Bayesian-average popularity score, used as a tie-breaker.
    const globalMeanRating = ratingN ? ratingSum / ratingN : 0;
    const PRIOR_COUNT = 10;
    for (const [movieId, movie] of movies) {
      const stats = movieStats.get(movieId) || { count: 0, sum: 0 };
      movie.ratingCount = stats.count;
      movie.avgRating = stats.count ? stats.sum / stats.count : 0;
      movie.bayesianRating =
        (PRIOR_COUNT * globalMeanRating + stats.sum) / (PRIOR_COUNT + stats.count);
    }

    return { movies, movieRaters, userRatings, userMeans, globalMeanRating };
  }

  return { buildData };
});
