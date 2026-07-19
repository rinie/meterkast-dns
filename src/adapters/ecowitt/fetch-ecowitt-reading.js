import https from "node:https";
import { parseEcowittResponse } from "./parse-ecowitt-response.js";

// api.ecowitt.net is a real public cloud API with a properly CA-signed
// cert, unlike Dirigera's local hub -- rejectUnauthorized defaults to
// true. Tests point hostname/port at a local mock server and pass
// rejectUnauthorized: false only there, never against the real API.
export function fetchEcowittReading(
  { hostname, applicationKey, apiKey, mac },
  { port = 443, rejectUnauthorized = true } = {},
) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({
      application_key: applicationKey,
      api_key: apiKey,
      mac,
      call_back: "all",
    });
    const req = https.request(
      {
        hostname,
        port,
        path: `/api/v3/device/real_time?${query}`,
        method: "GET",
        rejectUnauthorized,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(parseEcowittResponse(res.statusCode, Buffer.concat(chunks).toString()));
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
