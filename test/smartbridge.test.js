import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import smartbridgeAdapter, {
  parseSmartbridgeResponse,
  fetchSmartbridgeDevices,
  matchConfiguredDevices,
  unclaimedSmartbridgeDevices,
} from "../src/adapters/smartbridge-adapter.js";

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

// Real bug, caught in live verification (not a test): an extra
// hand-typed playlist field this adapter doesn't itself manage
// (displayFields, the per-device display-filter allow-list) was silently
// dropped because matchConfiguredDevices built its match object
// field-by-field instead of spreading ...record first, unlike the
// mdns/dns adapters (and now dirigera-adapter.js, fixed for the same
// reason).
test("matchConfiguredDevices carries forward extra playlist fields it doesn't itself manage", async () => {
  const devices = await loadFixture();
  const configuredRecords = {
    "kaku-plug": { transport: "smartbridge", address: "222222", excludeDisplayFields: ["Battery"] },
  };

  const matches = matchConfiguredDevices(devices, configuredRecords);

  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].excludeDisplayFields, ["Battery"]);
});

test("matchConfiguredDevices ignores configured devices the sync response didn't return", () => {
  const matches = matchConfiguredDevices([], {
    "kaku-plug": { transport: "smartbridge", address: "111111" },
  });
  assert.deepEqual(matches, []);
});

test("unclaimedSmartbridgeDevices returns real devices not matched by any playlist entry, falls back to a device-id-based name (no name field in this API at all)", async () => {
  const devices = await loadFixture();
  const configuredRecords = {
    "kaku-plug": { transport: "smartbridge", address: "222222" },
  };

  const candidates = unclaimedSmartbridgeDevices(devices, configuredRecords);

  assert.deepEqual(candidates, [
    {
      transport: "smartbridge",
      address: "111111",
      suggestedName: "smartbridge-111111",
      meta: {
        version_status: "0",
        version_data: "7",
        time_added: "2025-03-05 17:08:47",
        encrypted_data: "fake-opaque-ciphertext-1",
        encrypted_status: null,
      },
    },
  ]);
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

// Real bug, hit in production (the exact "read ECONNRESET" case): a
// transient network error on this bulk fetch used to escape the
// generator entirely and kill the adapter permanently. fetchDevices is
// injectable specifically so this retry behavior is directly testable
// without a real network round trip.
test("smartbridgeAdapter survives a failed poll cycle and yields on the next successful one", async () => {
  process.env.SMARTBRIDGE_EMAIL = "test@example.com";
  process.env.SMARTBRIDGE_MAC = "AA:BB";
  process.env.SMARTBRIDGE_PASSWORD_HASH = "test-hash";
  let callCount = 0;
  const fetchDevices = async () => {
    callCount += 1;
    if (callCount === 1) throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    return [{ id: "222222", version_status: "0", version_data: "1", time_added: "2025-01-01", data: "x", status: "y" }];
  };
  const records = { "kaku-plug": { transport: "smartbridge", address: "222222" } };
  const generator = smartbridgeAdapter(records, { intervalMs: 5, fetchDevices });

  try {
    const { value, done } = await generator.next();
    assert.equal(done, false);
    assert.equal(value.name, "kaku-plug");
    assert.equal(callCount, 2); // first cycle failed and was caught; this yield came from the second
  } finally {
    await generator.return();
    delete process.env.SMARTBRIDGE_EMAIL;
    delete process.env.SMARTBRIDGE_MAC;
    delete process.env.SMARTBRIDGE_PASSWORD_HASH;
  }
});
