// The local HTTP API: routing plus every handler. GET /devices,
// GET /devices/:name, GET /resolved (dns/mdns entries only, normalized to
// their live-resolved address), GET /logs (the backend's own recent
// activity), GET /events (SSE -- "change" events for registry updates,
// "log" events for new log entries, same connection), POST /devices/:name
// (generic write path), the static pages (/screens, /web-scan, /table --
// / redirects to /screens, the default landing experience), and a
// generic static-file path for the screens app's own JS/CSS/vendored
// plugin/handcoded markdown pages.
import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { listRecords, getRecord, upsertRecord, subscribe } from "./registry.js";
import { listLogs, subscribeLogs } from "./log.js";
import { flattenDisplayFields } from "./display-fields.js";

// `display` adds a few curated, formatted lines (display-fields.toml,
// keyed by transport) alongside a record's raw `meta` -- never replaces
// it, since not every transport has a mapping defined. Absent/empty
// `displayFields` (no display-fields.toml, or nothing configured for
// this transport) is exactly what flattenDisplayFields already treats
// as "no lines," so this never has to special-case that itself.
function withDisplay(record, displayFields) {
  return { ...record, display: flattenDisplayFields(displayFields[record.transport], record.meta) };
}

export function handleList(registry, displayFields, req, res) {
  const records = listRecords(registry).map((record) => withDisplay(record, displayFields));
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(records));
}

export function handleGet(registry, displayFields, name, req, res) {
  const record = getRecord(registry, name);
  if (!record) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(withDisplay(record, displayFields)));
}

// GET /resolved -- the subset of GET /devices that answers "what did the
// local resolver actually resolve", not "what's in the playlist". Scoped
// to transport = "dns"/"mdns" specifically, since those are the two
// adapters whose whole job is turning a human-typed name (raspi3.home,
// _mqtt._tcp.local) into a live address -- every other transport's
// `address` is already the Gutenberg value itself (a device id, a MAC), so
// "resolved" wouldn't mean anything extra for it. The two adapters' meta
// shapes differ (resolveHostname's flat `resolvedAddress`, resolveService's
// `host`/`port` pair for a broker), normalized here into one
// `resolvedAddress` field so a consumer never has to know which of the two
// produced a given row. Records that haven't resolved yet (or failed) are
// left out entirely rather than shown with a null/placeholder value.
export function summarizeResolution(record) {
  if (record.transport !== "dns" && record.transport !== "mdns") return null;
  if (record.meta?.resolvedAddress) return record.meta.resolvedAddress;
  if (record.meta?.host && record.meta?.port) return `${record.meta.host}:${record.meta.port}`;
  return null;
}

export function handleResolved(registry, req, res) {
  const resolved = listRecords(registry)
    .map((record) => ({ record, resolvedAddress: summarizeResolution(record) }))
    .filter(({ resolvedAddress }) => resolvedAddress !== null)
    .map(({ record, resolvedAddress }) => ({
      name: record.name,
      transport: record.transport,
      address: record.address,
      resolvedAddress,
    }));
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(resolved));
}

// GET /logs -- the backend's own recent activity, timestamped. Same
// bounded-buffer store live-streamed over /events below (a "log" named
// event on the same connection, not a second SSE endpoint) -- a log
// screen loads this once for its initial rows, then the SSE stream
// appends anything new.
export function handleLogs(req, res) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(listLogs()));
}

export function handleSubscribe(registry, req, res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(": connected\n\n"); // force headers onto the wire now, not on first event
  const unsubscribeRegistry = subscribe(registry, (event) => {
    res.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const unsubscribeLog = subscribeLogs((entry) => {
    res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
  });
  req.on("close", () => {
    unsubscribeRegistry();
    unsubscribeLog();
  });
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

const PUBLIC_DIR = resolve(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public"));

export async function serveStaticPage(filename, req, res) {
  const html = await readFile(join(PUBLIC_DIR, filename), "utf8");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

const STATIC_CONTENT_TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

// Backs the screens app's own JS/CSS, the vendored observable-forms
// plugin, and the handcoded public/pages/*.md files -- every one of
// those is served as a plain static file, not through a dedicated route
// per file. `relativePath` is untrusted (comes straight off the request
// URL), so it's resolved and checked against PUBLIC_DIR before any read
// -- `resolve()` collapses a `../` traversal attempt, and the prefix
// check (with a trailing separator, so PUBLIC_DIR itself and a
// same-named sibling directory can't be confused) rejects anything that
// escaped it.
export async function serveStaticFile(relativePath, req, res) {
  const filePath = resolve(join(PUBLIC_DIR, relativePath));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + sep)) {
    res.writeHead(403).end();
    return;
  }
  const contentType = STATIC_CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "content-type": contentType });
    res.end(content);
  } catch {
    res.writeHead(404).end();
  }
}

export function createServer(registry, displayFields = {}) {
  return createHttpServer((req, res) => {
    const url = new URL(req.url, "http://localhost");

    // The screens app (sidebar + markdown pages) is the default landing
    // experience -- a real redirect, not just a link, so a plain
    // http://localhost:8420/ actually lands there instead of on the
    // older, table-only index.html (real user report: reaching that
    // plain root and asking "where's the sidebar" -- it was never on
    // this page at all, only on /screens). The old live-SSE device table
    // still exists, just at its own path now, not orphaned.
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(302, { location: "/screens" });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/table") {
      return serveStaticPage("index.html", req, res);
    }

    if (req.method === "GET" && url.pathname === "/devices") {
      return handleList(registry, displayFields, req, res);
    }

    if (req.method === "GET" && url.pathname === "/resolved") {
      return handleResolved(registry, req, res);
    }

    if (req.method === "GET" && url.pathname === "/logs") {
      return handleLogs(req, res);
    }

    if (req.method === "GET" && url.pathname === "/events") {
      return handleSubscribe(registry, req, res);
    }

    if (req.method === "GET" && url.pathname === "/web-scan") {
      return serveStaticPage("web-scan.html", req, res);
    }

    // /screens and /screens/:slug both serve the same shell page --
    // screens.js parses the real slug from location.pathname client-side
    // (the standard SPA-fallback pattern), so a hard refresh or a direct
    // deep link to /screens/devices still works.
    if (req.method === "GET" && /^\/screens(\/[^/]+)?$/.test(url.pathname)) {
      return serveStaticPage("screens.html", req, res);
    }

    // Everything the screens app needs beyond its own shell page --
    // grid.js, screens.css, the vendored observable-forms plugin, and
    // the handcoded pages/*.md files -- is a plain static file. Checked
    // after every other route above, so nothing here can shadow a real
    // API endpoint.
    if (req.method === "GET" && /\.(js|css|md|json)$/.test(url.pathname)) {
      return serveStaticFile(decodeURIComponent(url.pathname.slice(1)), req, res);
    }

    const deviceMatch = url.pathname.match(/^\/devices\/([^/]+)$/);
    if (req.method === "GET" && deviceMatch) {
      return handleGet(registry, displayFields, decodeURIComponent(deviceMatch[1]), req, res);
    }
    if (req.method === "POST" && deviceMatch) {
      return handleReport(registry, decodeURIComponent(deviceMatch[1]), req, res);
    }

    res.writeHead(404).end();
  });
}
