import { getRecord } from "../registry/get-record.js";

export function handleGet(registry, name, req, res) {
  const record = getRecord(registry, name);
  if (!record) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(record));
}
