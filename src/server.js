import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.js";
import { ApiFootballClient } from "./api-football.js";
import { LiveMonitor } from "./monitor.js";
import { SnapshotStore } from "./snapshot-store.js";
import { EmailAlerts } from "./email-alerts.js";

loadEnv();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDirectory = path.join(root, "public");
const port = Number(process.env.PORT ?? 3000);
const pollInterval = Math.max(15, Number(process.env.POLL_INTERVAL_SECONDS ?? 20));
const client = new ApiFootballClient({ apiKey: process.env.API_FOOTBALL_KEY });
const alerts = new EmailAlerts({
  apiKey: process.env.RESEND_API_KEY,
  to: process.env.ALERT_EMAIL_TO,
  from: process.env.ALERT_EMAIL_FROM,
  minimumLevel: process.env.ALERT_MIN_LEVEL,
  dashboardUrl: process.env.PUBLIC_URL,
  cooldownMinutes: process.env.ALERT_COOLDOWN_MINUTES
});
const monitor = new LiveMonitor({
  client,
  alerts,
  store: new SnapshotStore(path.join(root, "data")),
  configPath: path.join(root, "config.json")
});

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/health") {
    return json(response, monitor.state.error ? 503 : 200, {
      ok: !monitor.state.error,
      updatedAt: monitor.state.updatedAt
    });
  }
  if (!isAuthorized(request)) {
    response.writeHead(401, {
      "content-type": "text/plain; charset=utf-8",
      "www-authenticate": 'Basic realm="Live Goals Desk"'
    });
    return response.end("Authentication required");
  }
  if (url.pathname === "/api/state") {
    return json(response, 200, monitor.state);
  }
  if (url.pathname === "/api/refresh" && request.method === "POST") {
    return json(response, 200, await monitor.poll());
  }
  if (url.pathname === "/api/config") {
    return json(response, 200, monitor.getConfig());
  }

  const requestedPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const safePath = path.resolve(publicDirectory, requestedPath);
  if (!safePath.startsWith(publicDirectory) || !fs.existsSync(safePath)) {
    return text(response, 404, "Not found");
  }
  response.writeHead(200, { "content-type": mimeType(safePath) });
  fs.createReadStream(safePath).pipe(response);
});

server.listen(port, () => {
  console.log(`Live goals dashboard: http://localhost:${port}`);
  if (!process.env.API_FOOTBALL_KEY) {
    console.log("Add API_FOOTBALL_KEY to .env, then restart the app.");
  }
  monitor.poll();
  setInterval(() => monitor.poll(), pollInterval * 1000).unref();
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
  const extension = path.extname(filePath);
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8"
    }[extension] ?? "application/octet-stream"
  );
}

function isAuthorized(request) {
  const username = process.env.DASHBOARD_USERNAME;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!username || !password) return true;

  const header = request.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) return false;

  try {
    const supplied = Buffer.from(header.slice(6), "base64").toString("utf8");
    return supplied === `${username}:${password}`;
  } catch {
    return false;
  }
}
