import { upsertRecord } from "../registry/upsert-record.js";

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
