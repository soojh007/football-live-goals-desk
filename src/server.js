import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.js";
import { ApiFootballClient } from "./api-football.js";
import { ShortlistService } from "./shortlist-service.js";

loadEnv();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDirectory = path.join(root, "public");
const port = Number(process.env.PORT ?? 3000);
const client = new ApiFootballClient({ apiKey: process.env.API_FOOTBALL_KEY });
const shortlist = new ShortlistService({
  client,
  timezone: process.env.DIGEST_TIMEZONE ?? "Asia/Singapore",
  windowHours: clampNumber(process.env.SHORTLIST_WINDOW_HOURS, 3, 2, 3),
  maxAnalyses: clampNumber(process.env.SHORTLIST_MAX_ANALYSES, 15, 1, 25),
  maxPicks: clampNumber(process.env.SHORTLIST_MAX_PICKS, 10, 1, 20),
  concurrency: clampNumber(process.env.DIGEST_CONCURRENCY, 4, 1, 8),
  cooldownMinutes: clampNumber(process.env.SHORTLIST_COOLDOWN_MINUTES, 15, 5, 120)
});

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/health") {
    return json(response, 200, { ok: true });
  }
  if (!isAuthorized(request)) {
    response.writeHead(401, {
      "content-type": "text/plain; charset=utf-8",
      "www-authenticate": 'Basic realm="Football Match Finder"'
    });
    return response.end("Authentication required");
  }
  if (url.pathname === "/api/shortlist" && request.method === "GET") {
    return json(response, 200, shortlist.getState());
  }
  if (url.pathname === "/api/shortlist" && request.method === "POST") {
    try {
      return json(response, 200, await shortlist.generate());
    } catch (error) {
      return json(response, error.statusCode ?? 500, {
        error: error.message,
        ...(error.state ?? shortlist.getState())
      });
    }
  }

  const requestedPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const safePath = path.resolve(publicDirectory, requestedPath);
  if (!safePath.startsWith(`${publicDirectory}${path.sep}`) || !fs.existsSync(safePath)) {
    return text(response, 404, "Not found");
  }
  response.writeHead(200, { "content-type": mimeType(safePath) });
  fs.createReadStream(safePath).pipe(response);
});

server.listen(port, () => {
  console.log(`Football match finder: http://localhost:${port}`);
});

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function text(response, status, body) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(body);
}

function mimeType(filePath) {
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8"
    }[path.extname(filePath)] ?? "application/octet-stream"
  );
}

function isAuthorized(request) {
  const username = process.env.DASHBOARD_USERNAME;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!username || !password) return true;
  const header = request.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) return false;
  try {
    return Buffer.from(header.slice(6), "base64").toString("utf8") === `${username}:${password}`;
  } catch {
    return false;
  }
}

function clampNumber(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : fallback));
}
