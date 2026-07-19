import https from "node:https";
import { parseDirigeraResponse } from "./parse-dirigera-response.js";

// Dirigera's local REST API uses a self-signed cert -- there's no CA for a
// LAN IP, which is normal for this class of device, not a shortcut being
// taken carelessly. rejectUnauthorized is scoped to this one request only,
// never global: NODE_TLS_REJECT_UNAUTHORIZED=0 would disable cert checking
// for every HTTPS call in the process, not just this one hub.
export function fetchDirigeraDevices(hostname, bearerToken, port = 8443) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        port,
        path: "/v1/devices",
        method: "GET",
        headers: { authorization: `Bearer ${bearerToken}` },
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(parseDirigeraResponse(res.statusCode, Buffer.concat(chunks).toString()));
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
