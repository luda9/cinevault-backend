require("dotenv").config();
const Router = require("koa-router");
const router = new Router();
const axios = require("axios");
const searchSchema = require("../validators/search");
const db = require("../db/connection");

const OMDB_API_KEY = process.env.OMDB_API_KEY;
const apiUrl = `https://www.omdbapi.com/`;
const imdbRegex = /^tt\d{7,8}$/;

const parseRuntime = (runtime) => {
  if (!runtime || runtime === "N/A") return null;
  return parseInt(runtime.replace(" min", ""));
};

const parseMoney = (value) => {
  if (!value || value === "N/A") return null;
  return parseInt(value.replace(/[$,]/g, ""));
};

router.get("/search", async (ctx) => {
  const { error, value } = searchSchema.validate(ctx.query);

  if (error) {
    const detail = error.details[0];

    ctx.status = 400;

    // If `s` is missing
    if (detail.path.includes("s") && detail.type === "any.required") {
      ctx.body = {
        Response: "False",
        Error: "Search parameter 's' is required",
      };
      return;
    }

    // Any other error => Joi error message
    ctx.body = {
      Response: "False",
      Error: detail.message,
    };
    return;
  }

  try {
    const response = await axios.get(apiUrl, {
      params: {
        apikey: OMDB_API_KEY,
        ...value,
      },
    });

    if (response.data.Response === "False") {
      ctx.status = 404;
      ctx.body = {
        Response: "False",
        Error: "Movie not found!",
      };
      return;
    }

    const omdbResults = response.data.Search;

    const imdbIds = omdbResults.map((movie) => movie.imdbID);

    const [rows] = await db.query(
      `SELECT imdb_id FROM watchlist WHERE imdb_id IN (?)`,
      [imdbIds],
    );

    const watchlistSet = new Set(rows.map((r) => r.imdb_id));

    const enrichedResults = omdbResults.map((movie) => ({
      imdbID: movie.imdbID,
      Title: movie.Title,
      Year: movie.Year,
      Type: movie.Type,
      Poster: movie.Poster,
      isInWatchlist: watchlistSet.has(movie.imdbID),
    }));

    ctx.status = 200;
    ctx.body = {
      Response: "True",
      Search: enrichedResults,
    };
  } catch (err) {
    ctx.status = 500;
    ctx.body = {
      Response: "False",
      Error: "External service error",
    };
  }
});

router.get("/movie/:imdbId", async (ctx) => {
  const { imdbId } = ctx.params;
  // Check Id format
  if (!imdbRegex.test(imdbId)) {
    ctx.status = 400;
    ctx.body = {
      Response: "False",
      Error: "Invalid IMDb ID format. Must be 'tt' followed by 7-8 digits",
    };
    return;
  }

  try {
    const response = await axios.get(apiUrl, {
      params: {
        apikey: OMDB_API_KEY,
        i: imdbId,
      },
    });

    if (response.data.Response === "False") {
      ctx.status = 404;
      ctx.body = {
        Response: "False",
        Error: "Movie not found!",
      };
      return;
    }

    ctx.status = 200;
    ctx.body = response.data;
  } catch (error) {
    ctx.status = 500;
    ctx.body = {
      Response: "False",
      Error: "External service error",
    };
  }
});

router.post("/watchlist", async (ctx) => {
  const body = ctx.request.body;

  // Array validation
  if (!Array.isArray(body)) {
    ctx.status = 400;
    ctx.body = { error: "Request body must be an array" };
    return;
  }

  const validationErrors = [];
  const moviesToInsert = [];

  // Validate each element
  body.forEach((movie, index) => {
    const { imdbId, myRating, watched } = movie;

    if (!imdbId) {
      validationErrors.push({
        field: "imdbId",
        message: "imdbId is required",
        index,
      });
      return;
    }

    if (!imdbRegex.test(imdbId)) {
      validationErrors.push({
        field: "imdbId",
        message: "Invalid IMDb ID format",
        index,
      });
      return;
    }

    if (
      myRating !== undefined &&
      myRating !== null &&
      (typeof myRating !== "number" || myRating < 1 || myRating > 10)
    ) {
      validationErrors.push({
        field: "myRating",
        message: "myRating must be between 1 and 10",
        index,
      });
      return;
    }

    moviesToInsert.push({
      imdbId,
      myRating: myRating ?? null,
      watched: watched ?? false,
    });
  });

  // Errors found
  if (validationErrors.length) {
    ctx.status = 400;
    ctx.body = {
      error: "Validation failed",
      details: validationErrors,
    };
    return;
  }

  try {
    // Duplicates
    const imdbIds = moviesToInsert.map((m) => m.imdbId);
    const [existing] = await db.query(
      `SELECT imdb_id FROM watchlist WHERE imdb_id IN (?)`,
      [imdbIds],
    );

    if (existing.length) {
      ctx.status = 409;
      ctx.body = {
        error: "Conflict",
        details: existing.map((row) => ({
          imdbId: row.imdb_id,
          message: "Movie already in watchlist",
        })),
      };
      return;
    }

    // Save
    const inserted = [];

    for (const movie of moviesToInsert) {
      const [result] = await db.query(
        `INSERT INTO watchlist (imdb_id, my_rating, watched)
         VALUES (?, ?, ?)`,
        [movie.imdbId, movie.myRating, movie.watched],
      );

      inserted.push({
        id: result.insertId,
        imdbId: movie.imdbId,
        myRating: movie.myRating,
        watched: movie.watched,
        dateAdded: new Date().toISOString(),
      });
    }

    ctx.status = 201;
    ctx.body = inserted;
  } catch (err) {
  console.error("Database error details:", err);
    ctx.status = 500;
    ctx.body = {
      error: "Database error",
      details: err.message,
      code: err.code
    };
  }
});

router.get("/watchlist", async (ctx) => {
  const { sort = "dateAdded", order = "desc", filter, watched } = ctx.query;

  try {
    let sql = "SELECT * FROM watchlist";
    const params = [];

    // DB level
    if (watched === "true" || watched === "false") {
      sql += " WHERE watched = ?";
      params.push(watched === "true");
    }

    const [rows] = await db.query(sql, params);

    // OMDb
    const enriched = await Promise.all(
      rows.map(async (row) => {
        const response = await axios.get(apiUrl, {
          params: {
            apikey: OMDB_API_KEY,
            i: row.imdb_id,
          },
        });

        const data = response.data;

        return {
          id: row.id,
          imdbId: row.imdb_id,
          myRating: row.my_rating,
          watched: !!row.watched,
          dateAdded: row.created_at,
          title: data.Title,
          year: data.Year,
          poster: data.Poster,
          type: data.Type,
          plot: data.Plot,
          director: data.Director,
          imdbRating: data.imdbRating,
          genre: data.Genre,
          runtime: data.Runtime,
        };
      }),
    );

    let results = enriched;

    // Filter by type
    if (filter) {
      results = results.filter((item) => item.type === filter);
    }

    // Sorting
    const sortMap = {
      dateAdded: "dateAdded",
      title: "title",
      year: "year",
      imdbRating: "imdbRating",
      myRating: "myRating",
    };

    const sortField = sortMap[sort] || "dateAdded";
    const direction = order === "asc" ? 1 : -1;

    results.sort((a, b) => {
      if (a[sortField] == null) return 1;
      if (b[sortField] == null) return -1;
      if (a[sortField] > b[sortField]) return direction;
      if (a[sortField] < b[sortField]) return -direction;
      return 0;
    });

    // Response
    ctx.status = 200;
    ctx.body = results;
  } catch (error) {
    ctx.status = 500;
    ctx.body = {
      Response: "False",
      Error: "Internal server error",
    };
  }
});

router.get("/watchlist/:imdbId", async (ctx) => {
  const { imdbId } = ctx.params;

  // Validate IMDb ID
  if (!imdbRegex.test(imdbId)) {
    ctx.status = 400;
    ctx.body = { error: "Invalid IMDb ID format" };
    return;
  }

  try {
    // Check DB
    const [rows] = await db.query("SELECT * FROM watchlist WHERE imdb_id = ?", [
      imdbId,
    ]);

    if (!rows.length) {
      ctx.status = 404;
      ctx.body = { error: "Movie not found in watchlist" };
      return;
    }

    const row = rows[0];

    // OMDb fetch
    const response = await axios.get(apiUrl, {
      params: {
        apikey: OMDB_API_KEY,
        i: imdbId,
      },
    });

    const data = response.data;

    ctx.status = 200;
    ctx.body = {
      id: row.id,
      imdbId: row.imdb_id,
      myRating: row.my_rating,
      watched: !!row.watched,
      dateAdded: row.created_at,
      title: data.Title,
      year: data.Year,
      rated: data.Rated,
      runtime: data.Runtime,
      genre: data.Genre,
      director: data.Director,
      actors: data.Actors,
      plot: data.Plot,
      imdbRating: data.imdbRating,
      type: data.Type,
    };
  } catch (err) {
    ctx.status = 500;
    ctx.body = { error: "Internal server error" };
  }
});

router.patch("/watchlist/:imdbId", async (ctx) => {
  const { imdbId } = ctx.params;
  const { myRating, watched, imdbId: bodyImdbId } = ctx.request.body;

  // Validate IMDb ID
  if (!imdbRegex.test(imdbId)) {
    ctx.status = 400;
    ctx.body = { error: "Invalid IMDb ID format" };
    return;
  }

  // Prevent imdbId change
  if (bodyImdbId !== undefined) {
    ctx.status = 400;
    ctx.body = { error: "imdbId cannot be modified" };
    return;
  }

  // Empty body
  if (myRating === undefined && watched === undefined) {
    ctx.status = 400;
    ctx.body = { error: "Request must contain myRating or watched" };
    return;
  }

  // Validate myRating
  if (
    myRating !== undefined &&
    myRating !== null &&
    (typeof myRating !== "number" || myRating < 1 || myRating > 10)
  ) {
    ctx.status = 400;
    ctx.body = { error: "myRating must be between 1 and 10" };
    return;
  }

  // Check existence
  const [rows] = await db.query("SELECT * FROM watchlist WHERE imdb_id = ?", [
    imdbId,
  ]);

  if (!rows.length) {
    ctx.status = 404;
    ctx.body = { error: "Movie not found in watchlist" };
    return;
  }

  try {
    // Update
    await db.query(
      `UPDATE watchlist
       SET my_rating = COALESCE(?, my_rating),
           watched = COALESCE(?, watched)
       WHERE imdb_id = ?`,
      [myRating, watched, imdbId],
    );

    // Return updated row
    const [updated] = await db.query(
      "SELECT * FROM watchlist WHERE imdb_id = ?",
      [imdbId],
    );

    ctx.status = 200;
    ctx.body = {
      id: updated[0].id,
      imdbId: updated[0].imdb_id,
      myRating: updated[0].my_rating,
      watched: !!updated[0].watched,
      dateAdded: updated[0].created_at,
      lastUpdated: new Date().toISOString(),
    };
  } catch (err) {
  console.error("Database error details:", err);
  ctx.status = 500;
  ctx.body = {
    error: "Database error",
    details: err.message,
    code: err.code
  };
}
});

router.delete("/watchlist/:imdbId", async (ctx) => {
  const { imdbId } = ctx.params;

  // 1️⃣ Validate IMDb ID
  if (!imdbRegex.test(imdbId)) {
    ctx.status = 400;
    ctx.body = { error: "Invalid IMDb ID format" };
    return;
  }

  try {
    const [rows] = await db.query(
      "SELECT id FROM watchlist WHERE imdb_id = ?",
      [imdbId],
    );

    if (!rows.length) {
      ctx.status = 404;
      ctx.body = { error: "Movie not found in watchlist" };
      return;
    }

    await db.query("DELETE FROM watchlist WHERE imdb_id = ?", [imdbId]);

    ctx.status = 204;
  } catch (err) {
  console.error("Database error details:", err);
  ctx.status = 500;
  ctx.body = {
    error: "Database error",
    details: err.message,
    code: err.code
  };
}
});

router.post("/compare", async (ctx) => {
  const { imdbIds } = ctx.request.body;

  // Validations
  if (!imdbIds) {
    ctx.status = 400;
    ctx.body = { error: "imdbIds array is required" };
    return;
  }

  if (!Array.isArray(imdbIds)) {
    ctx.status = 400;
    ctx.body = { error: "imdbIds must be an array" };
    return;
  }

  if (imdbIds.length < 2) {
    ctx.status = 400;
    ctx.body = { error: "At least 2 movies required for comparison" };
    return;
  }

  if (imdbIds.length > 5) {
    ctx.status = 400;
    ctx.body = { error: "Maximum 5 movies can be compared at once" };
    return;
  }

  const unique = new Set(imdbIds);
  if (unique.size !== imdbIds.length) {
    ctx.status = 400;
    ctx.body = { error: "Duplicate IMDb IDs found. All movies must be unique" };
    return;
  }

  if (!imdbIds.every((id) => imdbRegex.test(id))) {
    ctx.status = 400;
    ctx.body = { error: "All IMDb IDs must be valid format" };
    return;
  }

  try {
    // --- Fetch OMDb data ---
    const movies = await Promise.all(
      imdbIds.map(async (id) => {
        const res = await axios.get(apiUrl, {
          params: { apikey: OMDB_API_KEY, i: id },
        });

        if (res.data.Response === "False") return null;
        return res.data;
      }),
    );

    const missing = imdbIds.filter((_, i) => movies[i] === null);
    if (missing.length) {
      ctx.status = 404;
      ctx.body = { error: "One or more movies not found", missing };
      return;
    }

    // --- Metrics ---
    const ratings = movies.map((m) => parseFloat(m.imdbRating));
    const years = movies.map((m) => parseInt(m.Year));
    const runtimes = movies.map((m) => parseRuntime(m.Runtime)).filter(Boolean);
    const boxOffice = movies
      .map((m) => parseMoney(m.BoxOffice))
      .filter(Boolean);

    const avg = (arr) =>
      (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2);

    await db.query(
      "INSERT INTO comparisons (imdb_ids) VALUES (?)",
      [JSON.stringify(imdbIds)],
    );

    ctx.status = 200;
    ctx.body = {
      movies: movies.map((m) => ({
        Title: m.Title,
        imdbID: m.imdbID,
        imdbRating: m.imdbRating,
        Year: m.Year,
        Runtime: m.Runtime,
        Genre: m.Genre,
        Metascore: m.Metascore,
        BoxOffice: m.BoxOffice,
      })),
      comparison: {
        ratings: {
          highest: movies.reduce((a, b) =>
            parseFloat(a.imdbRating) > parseFloat(b.imdbRating) ? a : b,
          ),
          lowest: movies.reduce((a, b) =>
            parseFloat(a.imdbRating) < parseFloat(b.imdbRating) ? a : b,
          ),
          average: avg(ratings),
          range: (Math.max(...ratings) - Math.min(...ratings)).toFixed(1),
        },
        releaseYears: {
          oldest: Math.min(...years),
          newest: Math.max(...years),
          span: `${Math.max(...years) - Math.min(...years)} years`,
        },
        runtime: {
          average: runtimes.length ? `${Math.round(avg(runtimes))} min` : null,
        },
      },
      comparedAt: new Date().toISOString(),
      movieCount: movies.length,
    };
  } catch (err) {
    console.error("Database error details:", err);
    ctx.status = 500;
    ctx.body = {
      error: "Database error",
      details: err.message,
      code: err.code
    };
  }
});

router.get("/comparisons/recent", async (ctx) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM comparisons ORDER BY created_at DESC, id DESC LIMIT 10;"
    );

    const results = [];

    for (const row of rows) {
      const imdbIds = Array.isArray(row.imdb_ids)
        ? row.imdb_ids
        : JSON.parse(row.imdb_ids);

      const movies = [];

      for (const id of imdbIds) {
        try {
          const res = await axios.get(apiUrl, {
            params: {
              apikey: OMDB_API_KEY,
              i: id,
            },
          });

          if (res.data?.Response === "False") continue;

          const m = res.data;
          movies.push({
            imdbID: m.imdbID,
            Title: m.Title,
            Poster: m.Poster,
            imdbRating: m.imdbRating,
          });
        } catch (err) {
          console.error("OMDb error for id:", id);
        }
      }

      if (movies.length < 2) continue;

      results.push({
        id: row.id,
        createdAt: row.created_at,
        movies,
        movieCount: movies.length,
      });
    }

    ctx.status = 200;
    ctx.body = { comparisons: results };
  } catch (err) {
    console.error("Recent comparisons error:", err);
    ctx.status = 500;
    ctx.body = { error: "Internal server error" };
  }
});

module.exports = router;
