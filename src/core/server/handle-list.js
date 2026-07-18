import { listRecords } from "../registry/list-records.js";

export function handleList(registry, req, res) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(listRecords(registry)));
}
