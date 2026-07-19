import https from "node:https";
import { parseSmartbridgeResponse } from "./parse-smartbridge-response.js";

// trustsmartcloud2.com (KlikAanKlikUit's ICS2000 cloud) is a real public
// API with a properly CA-signed cert -- rejectUnauthorized defaults to
// true, same reasoning as the Ecowitt adapter. Tests point hostname/port
// at a local mock and override it there only.
export function fetchSmartbridgeDevices(
  { hostname, email, mac, passwordHash },
  { port = 443, rejectUnauthorized = true } = {},
) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({ action: "sync", email, mac, password_hash: passwordHash });
    const req = https.request(
      {
        hostname,
        port,
        path: `/ics2000_api/gateway.php?${query}`,
        method: "GET",
        rejectUnauthorized,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(parseSmartbridgeResponse(res.statusCode, Buffer.concat(chunks).toString()));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}
