import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dirigeraAdapter, {
  parseDirigeraResponse,
  matchConfiguredDevices,
  fetchDirigeraDevices,
} from "../src/adapters/dirigera-adapter.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

test("parseDirigeraResponse parses a 200 response", () => {
  const body = JSON.stringify([{ id: "a" }]);
  assert.deepEqual(parseDirigeraResponse(200, body), [{ id: "a" }]);
});

test("parseDirigeraResponse throws on a non-200 status", () => {
  assert.throws(() => parseDirigeraResponse(401, "{}"), /Dirigera API returned 401/);
});

test("matchConfiguredDevices matches dirigera-transport records by device id, surfaces deviceType alongside meta", () => {
  const dirigeraDevices = [
    { id: "dev-1", deviceType: "light", attributes: { isOn: true, lightLevel: 75 } },
    { id: "dev-2", deviceType: "outlet", attributes: { isOn: false } },
  ];
  const configuredRecords = {
    "kitchen-lamp": { transport: "dirigera", address: "dev-1" },
    "hallway-lamp": { transport: "dirigera", address: "dev-2" },
    "kitchen-thermometer": { transport: "bluetooth", address: "AA:BB" },
  };

  const matches = matchConfiguredDevices(dirigeraDevices, configuredRecords);

  assert.deepEqual(matches, [
    { name: "kitchen-lamp", transport: "dirigera", address: "dev-1", deviceType: "light", meta: { isOn: true, lightLevel: 75 } },
    { name: "hallway-lamp", transport: "dirigera", address: "dev-2", deviceType: "outlet", meta: { isOn: false } },
  ]);
});

// Real bug, caught in live verification (not a test): an extra hand-typed
// playlist field this adapter doesn't itself manage (displayFields, the
// per-device display-filter allow-list) was silently dropped because
// matchConfiguredDevices built its match object field-by-field instead of
// spreading ...record first, unlike the mdns/dns adapters.
test("matchConfiguredDevices carries forward extra playlist fields it doesn't itself manage", () => {
  const dirigeraDevices = [{ id: "dev-1", deviceType: "light", attributes: { isOn: true } }];
  const configuredRecords = {
    "kitchen-lamp": { transport: "dirigera", address: "dev-1", displayFields: ["On"] },
  };

  const matches = matchConfiguredDevices(dirigeraDevices, configuredRecords);

  assert.deepEqual(matches, [
    { name: "kitchen-lamp", transport: "dirigera", address: "dev-1", deviceType: "light", displayFields: ["On"], meta: { isOn: true } },
  ]);
});

test("matchConfiguredDevices ignores configured devices Dirigera didn't return", () => {
  const matches = matchConfiguredDevices([], {
    "kitchen-lamp": { transport: "dirigera", address: "dev-1" },
  });
  assert.deepEqual(matches, []);
});

// Real HTTPS round trip against a local server using a throwaway
// self-signed test cert (test/fixtures/test-cert.{pem,key}), the same
// self-signed situation a real Dirigera hub presents. Verifies the actual
// request/response/rejectUnauthorized:false path works, rather than
// leaving fetchDirigeraDevices as an unverified boundary the way the BLE
// native adapter had to be for lack of hardware -- this doesn't need
// hardware, just a TLS server, which is fully fakeable.
test("fetchDirigeraDevices performs a real HTTPS request against a self-signed server", async () => {
  const [cert, key] = await Promise.all([
    readFile(join(FIXTURES_DIR, "test-cert.pem")),
    readFile(join(FIXTURES_DIR, "test-cert.key")),
  ]);

  const devices = [{ id: "dev-1", attributes: { isOn: true } }];
  let receivedAuth;
  let receivedPath;

  const server = createServer({ cert, key }, (req, res) => {
    receivedAuth = req.headers.authorization;
    receivedPath = req.url;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(devices));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const result = await fetchDirigeraDevices("127.0.0.1", "test-token-123", port);
    assert.deepEqual(result, devices);
    assert.equal(receivedAuth, "Bearer test-token-123");
    assert.equal(receivedPath, "/v1/devices");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("fetchDirigeraDevices rejects on a non-200 response from the server", async () => {
  const [cert, key] = await Promise.all([
    readFile(join(FIXTURES_DIR, "test-cert.pem")),
    readFile(join(FIXTURES_DIR, "test-cert.key")),
  ]);

  const server = createServer({ cert, key }, (req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    await assert.rejects(
      () => fetchDirigeraDevices("127.0.0.1", "wrong-token", port),
      /Dirigera API returned 401/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// Real bug, hit in production: a transient network error on this bulk
// fetch used to escape the generator entirely and kill the adapter
// permanently. fetchDevices is injectable specifically so this retry
// behavior is directly testable without a real network round trip --
// same dependency-injection shape as the dns adapter's own `resolver`.
test("dirigeraAdapter survives a failed poll cycle and yields on the next successful one", async () => {
  process.env.DIRIGERA_HOSTNAME = "test-hub.local";
  process.env.DIRIGERA_BEARER_TOKEN = "test-token";
  let callCount = 0;
  const fetchDevices = async () => {
    callCount += 1;
    if (callCount === 1) throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    return [{ id: "dev-1", deviceType: "light", attributes: { isOn: true } }];
  };
  const records = { "kitchen-lamp": { transport: "dirigera", address: "dev-1" } };
  const generator = dirigeraAdapter(records, { intervalMs: 5, fetchDevices });

  try {
    const { value, done } = await generator.next();
    assert.equal(done, false);
    assert.deepEqual(value, {
      name: "kitchen-lamp",
      transport: "dirigera",
      address: "dev-1",
      deviceType: "light",
      meta: { isOn: true },
    });
    assert.equal(callCount, 2); // first cycle failed and was caught; this yield came from the second
  } finally {
    await generator.return();
    delete process.env.DIRIGERA_HOSTNAME;
    delete process.env.DIRIGERA_BEARER_TOKEN;
  }
});
