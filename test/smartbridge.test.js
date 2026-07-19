import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSmartbridgeResponse } from "../src/adapters/smartbridge/parse-smartbridge-response.js";
import { fetchSmartbridgeDevices } from "../src/adapters/smartbridge/fetch-smartbridge-devices.js";
import { matchConfiguredDevices } from "../src/adapters/smartbridge/match-configured-devices.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

async function loadFixture() {
  return JSON.parse(await readFile(join(FIXTURES_DIR, "smartbridge-sync-response.json"), "utf8"));
}

test("parseSmartbridgeResponse parses the device array on success", async () => {
  const fixture = await loadFixture();
  const result = parseSmartbridgeResponse(200, JSON.stringify(fixture));
  assert.equal(result.length, 2);
  assert.equal(result[0].id, "111111");
});

test("parseSmartbridgeResponse throws on a non-200 status", () => {
  assert.throws(() => parseSmartbridgeResponse(401, "[]"), /Smartbridge API returned HTTP 401/);
});

test("matchConfiguredDevices passes encrypted data/status through unchanged, exposes version fields", async () => {
  const devices = await loadFixture();
  const configuredRecords = {
    "kaku-plug": { transport: "smartbridge", address: "222222" },
    "kitchen-thermometer-battery": { transport: "bluetooth", address: "AA:BB" },
  };

  const matches = matchConfiguredDevices(devices, configuredRecords);

  assert.deepEqual(matches, [
    {
      name: "kaku-plug",
      transport: "smartbridge",
      address: "222222",
      meta: {
        version_status: "1454",
        version_data: "5",
        time_added: "2025-02-24 19:00:15",
        encrypted_data: "fake-opaque-ciphertext-2",
        encrypted_status: "fake-opaque-ciphertext-status-2",
      },
    },
  ]);
});

test("matchConfiguredDevices ignores configured devices the sync response didn't return", () => {
  const matches = matchConfiguredDevices([], {
    "kaku-plug": { transport: "smartbridge", address: "111111" },
  });
  assert.deepEqual(matches, []);
});

// Real HTTPS round trip against a local self-signed server, same pattern
// as Dirigera/Ecowitt -- trustsmartcloud2.com is CA-signed in production.
test("fetchSmartbridgeDevices performs a real HTTPS request and returns the device array", async () => {
  const [cert, key] = await Promise.all([
    readFile(join(FIXTURES_DIR, "test-cert.pem")),
    readFile(join(FIXTURES_DIR, "test-cert.key")),
  ]);
  const fixture = await loadFixture();

  let receivedPath;
  const server = createServer({ cert, key }, (req, res) => {
    receivedPath = req.url;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(fixture));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const result = await fetchSmartbridgeDevices(
      { hostname: "127.0.0.1", email: "test@example.com", mac: "AA:BB", passwordHash: "p@ssword" },
      { port, rejectUnauthorized: false },
    );
    assert.equal(result.length, 2);
    assert.match(receivedPath, /^\/ics2000_api\/gateway\.php\?/);
    assert.match(receivedPath, /action=sync/);
    assert.match(receivedPath, /password_hash=p%40ssword/); // @ must be percent-encoded
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
