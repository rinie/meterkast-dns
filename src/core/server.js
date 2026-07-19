// The local HTTP API: routing plus every handler. GET /devices,
// GET /devices/:name, GET /events (SSE), POST /devices/:name (generic
// write path), and the two static pages (/ and /web-scan).
import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { listRecords, getRecord, upsertRecord, subscribe } from "./registry.js";

export function handleList(registry, req, res) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(listRecords(registry)));
}

export function handleGet(registry, name, req, res) {
  const record = getRecord(registry, name);
  if (!record) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(record));
}

export function handleSubscribe(registry, req, res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(": connected\n\n"); // force headers onto the wire now, not on first event
  const unsubscribe = subscribe(registry, (event) => {
    res.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
  });
  req.on("close", unsubscribe);
}

// POST /devices/:name -- a generic, transport-agnostic write path. The body
// is a record (transport, address, meta?, ...) stored verbatim via
// upsertRecord. Deliberately knows nothing about any specific transport's
// ceremony (BLE bytes, USB endpoints, whatever comes next) -- that's the
// adapter's job, same as everywhere else in this design. This exists
// because a browser-based adapter (WebBLE/WebUSB) runs in a separate
// process/origin from the daemon and has no other way to reach the
// registry; a same-process adapter just calls upsertRecord directly and
// never needs this endpoint at all.
export function handleReport(registry, name, req, res) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON body" }));
      return;
    }
    const record = upsertRecord(registry, name, payload);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(record));
  });
}

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

export async function serveStaticPage(filename, req, res) {
  const html = await readFile(join(PUBLIC_DIR, filename), "utf8");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

export function createServer(registry) {
  return createHttpServer((req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && url.pathname === "/") {
      return serveStaticPage("index.html", req, res);
    }

    if (req.method === "GET" && url.pathname === "/devices") {
      return handleList(registry, req, res);
    }

    if (req.method === "GET" && url.pathname === "/events") {
      return handleSubscribe(registry, req, res);
    }

    if (req.method === "GET" && url.pathname === "/web-scan") {
      return serveStaticPage("web-scan.html", req, res);
    }

    const deviceMatch = url.pathname.match(/^\/devices\/([^/]+)$/);
    if (req.method === "GET" && deviceMatch) {
      return handleGet(registry, decodeURIComponent(deviceMatch[1]), req, res);
    }
    if (req.method === "POST" && deviceMatch) {
      return handleReport(registry, decodeURIComponent(deviceMatch[1]), req, res);
    }

    res.writeHead(404).end();
  });
}
