// Controlled DEP-04 seed: uses the running application's authenticated Catalogue API so Movie writes
// pass through the owning service and its audit transaction (D-35). It is deliberately local/test only.
import { pathToFileURL } from "node:url";

const ALLOWED_APP_ENVS = new Set(["local", "test"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const REQUEST_TIMEOUT_MS = 5_000;

export const SYNTHETIC_MOVIES = Object.freeze([
  Object.freeze({
    title: "Synthetic Seed: Aurora Station",
    synopsis: "A synthetic crew repairs a research station before a simulated solar storm arrives.",
    releaseDate: "2024-02-15",
    genres: Object.freeze(["Science Fiction", "Drama"]),
    director: "Alex Example",
    cast: Object.freeze(["Jordan Sample", "Casey Test"]),
    runtimeMinutes: 104,
  }),
  Object.freeze({
    title: "Synthetic Seed: Harbour Lights",
    synopsis: "Synthetic neighbours organise a community festival beside a fictional harbour.",
    releaseDate: "2023-08-04",
    genres: Object.freeze(["Comedy"]),
    director: "Morgan Example",
    cast: Object.freeze(["Taylor Sample", "Riley Test"]),
    runtimeMinutes: 92,
  }),
  Object.freeze({
    title: "Synthetic Seed: The Last Notebook",
    synopsis: "A fictional archivist follows synthetic clues hidden in an abandoned notebook.",
    releaseDate: null,
    genres: Object.freeze(["Mystery", "Adventure"]),
    director: "Jamie Example",
    cast: Object.freeze(["Avery Sample"]),
    runtimeMinutes: 118,
  }),
]);

function targetFromEnv(env) {
  if (!ALLOWED_APP_ENVS.has(env.APP_ENV)) throw new Error("invalid seed configuration");
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD || !env.PUBLIC_APP_URL) {
    throw new Error("invalid seed configuration");
  }

  let origin;
  try {
    origin = new URL(env.PUBLIC_APP_URL);
  } catch {
    throw new Error("invalid seed configuration");
  }
  if (!["http:", "https:"].includes(origin.protocol)
      || origin.origin !== env.PUBLIC_APP_URL
      || !LOOPBACK_HOSTS.has(origin.hostname)) {
    throw new Error("invalid seed configuration");
  }
  return {
    origin: origin.origin,
    email: env.SEED_ADMIN_EMAIL,
    password: env.SEED_ADMIN_PASSWORD,
  };
}

function cookieValue(response, name) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  const marker = `${name}=`;
  for (const value of values) {
    const start = value.indexOf(marker);
    if (start < 0) continue;
    const cookie = value.slice(start + marker.length).split(";", 1)[0];
    if (cookie) return cookie;
  }
  throw new Error("invalid seed response");
}

async function json(response) {
  try {
    return await response.json();
  } catch {
    throw new Error("invalid seed response");
  }
}

async function csrfToken(fetchImpl, origin, cookie) {
  const response = await fetchImpl(`${origin}/api/v1/auth/csrf`, {
    headers: cookie === undefined ? undefined : { cookie },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status !== 200) throw new Error("seed request failed");
  const body = await json(response);
  if (typeof body?.csrfToken !== "string" || body.csrfToken === "") throw new Error("invalid seed response");
  return { token: body.csrfToken, response };
}

function sameList(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function isExactMovie(actual, expected) {
  return actual !== null
    && typeof actual === "object"
    && actual.title === expected.title
    && actual.synopsis === expected.synopsis
    && actual.releaseDate === expected.releaseDate
    && sameList(actual.genres, expected.genres)
    && actual.director === expected.director
    && sameList(actual.cast, expected.cast)
    && actual.runtimeMinutes === expected.runtimeMinutes
    && actual.archivedAt === null;
}

async function listMovies(fetchImpl, origin, session) {
  const movies = [];
  for (let page = 1; page <= 10_000; page += 1) {
    const response = await fetchImpl(`${origin}/api/v1/admin/movies?page=${page}&pageSize=100`, {
      headers: { cookie: `fa_session=${session}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status !== 200) throw new Error("seed request failed");
    const body = await json(response);
    if (!Array.isArray(body?.items) || !Number.isSafeInteger(body?.total) || body.total < 0) {
      throw new Error("invalid seed response");
    }
    movies.push(...body.items);
    if (movies.length >= body.total) return movies;
    if (body.items.length === 0) throw new Error("invalid seed response");
  }
  throw new Error("invalid seed response");
}

async function logout(fetchImpl, origin, session, csrf) {
  const response = await fetchImpl(`${origin}/api/v1/auth/logout`, {
    method: "POST",
    headers: { cookie: `fa_session=${session}`, origin, "x-csrf-token": csrf },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status !== 204) throw new Error("seed request failed");
}

/**
 * Seeds the fixed synthetic Movie set through the authenticated Admin API. Dependencies are injected so
 * tests can verify the operator contract without opening a network connection or handling real credentials.
 */
export async function runSyntheticSeed({ env, fetchImpl, writeOutput, writeError }) {
  let session;
  let boundCsrf;
  let origin;
  let loggedOut = false;
  try {
    const target = targetFromEnv(env);
    origin = target.origin;

    const anonymous = await csrfToken(fetchImpl, origin);
    const preSession = cookieValue(anonymous.response, "fa_presession");
    const login = await fetchImpl(`${origin}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `fa_presession=${preSession}`,
        origin,
        "x-csrf-token": anonymous.token,
      },
      body: JSON.stringify({ email: target.email, password: target.password }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (login.status !== 200) throw new Error("seed request failed");
    const principal = await json(login);
    if (principal?.role !== "ADMIN" || principal?.status !== "active") throw new Error("seed request failed");
    session = cookieValue(login, "fa_session");

    const bound = await csrfToken(fetchImpl, origin, `fa_session=${session}`);
    boundCsrf = bound.token;
    const existing = await listMovies(fetchImpl, origin, session);
    let created = 0;
    let skipped = 0;

    for (const movie of SYNTHETIC_MOVIES) {
      const matches = existing.filter((candidate) => candidate?.title === movie.title);
      if (matches.length > 1 || (matches.length === 1 && !isExactMovie(matches[0], movie))) {
        throw new Error("synthetic title collision");
      }
      if (matches.length === 1) {
        skipped += 1;
        continue;
      }
      const response = await fetchImpl(`${origin}/api/v1/admin/movies`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `fa_session=${session}`,
          origin,
          "x-csrf-token": boundCsrf,
        },
        body: JSON.stringify(movie),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status !== 201 || !isExactMovie(await json(response), movie)) {
        throw new Error("seed request failed");
      }
      created += 1;
    }

    await logout(fetchImpl, origin, session, boundCsrf);
    loggedOut = true;
    writeOutput(`movies_created=${created} movies_existing=${skipped}`);
    return 0;
  } catch {
    writeError("db:seed failed");
    return 1;
  } finally {
    if (!loggedOut && origin !== undefined && session !== undefined && boundCsrf !== undefined) {
      try {
        await logout(fetchImpl, origin, session, boundCsrf);
      } catch {
        // Best-effort cleanup only; the fixed failure above deliberately hides response and credential details.
      }
    }
  }
}

async function main() {
  if (process.argv.length !== 2) {
    console.error("db:seed failed");
    process.exitCode = 1;
    return;
  }
  process.exitCode = await runSyntheticSeed({
    env: process.env,
    fetchImpl: fetch,
    writeOutput: (line) => console.log(line),
    writeError: (line) => console.error(line),
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
