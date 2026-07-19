import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEcowittResponse } from "../src/adapters/ecowitt/parse-ecowitt-response.js";
import { fetchEcowittReading } from "../src/adapters/ecowitt/fetch-ecowitt-reading.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

test("parseEcowittResponse extracts .data on success (code 0)", async () => {
  const fixture = JSON.parse(
    await readFile(join(FIXTURES_DIR, "ecowitt-real-time-response.json"), "utf8"),
  );
  const result = parseEcowittResponse(200, JSON.stringify(fixture));
  assert.equal(result.outdoor.temperature.value, "72.7");
  assert.equal(result.outdoor.temperature.unit, "ºF");
});

test("parseEcowittResponse throws on a non-200 HTTP status", () => {
  assert.throws(() => parseEcowittResponse(500, "{}"), /Ecowitt API returned HTTP 500/);
});

test("parseEcowittResponse throws on a non-zero API-level code even with HTTP 200", () => {
  const body = JSON.stringify({ code: 40010, msg: "Illegal Application_Key" });
  assert.throws(
    () => parseEcowittResponse(200, body),
    /Ecowitt API error: Illegal Application_Key \(code 40010\)/,
  );
});

// Real HTTPS round trip against a local self-signed server, same fixture
// cert as the Dirigera tests -- api.ecowitt.net itself is CA-signed in
// production (rejectUnauthorized defaults to true there), but the
// request/response mechanics are identical and fully verifiable locally.
test("fetchEcowittReading performs a real HTTPS request and returns .data", async () => {
  const [cert, key] = await Promise.all([
    readFile(join(FIXTURES_DIR, "test-cert.pem")),
    readFile(join(FIXTURES_DIR, "test-cert.key")),
  ]);
  const fixture = JSON.parse(
    await readFile(join(FIXTURES_DIR, "ecowitt-real-time-response.json"), "utf8"),
  );

  let receivedPath;
  const server = createServer({ cert, key }, (req, res) => {
    receivedPath = req.url;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(fixture));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const result = await fetchEcowittReading(
      { hostname: "127.0.0.1", applicationKey: "test-app-key", apiKey: "test-api-key", mac: "AA:BB" },
      { port, rejectUnauthorized: false },
    );
    assert.equal(result.indoor.humidity.value, "47");
    assert.match(receivedPath, /^\/api\/v3\/device\/real_time\?/);
    assert.match(receivedPath, /application_key=test-app-key/);
    assert.match(receivedPath, /mac=AA%3ABB/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
