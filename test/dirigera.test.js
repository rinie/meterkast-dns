import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
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

test("matchConfiguredDevices matches dirigera-transport records by device id", () => {
  const dirigeraDevices = [
    { id: "dev-1", attributes: { isOn: true, lightLevel: 75 } },
    { id: "dev-2", attributes: { isOn: false } },
  ];
  const configuredRecords = {
    "kitchen-lamp": { transport: "dirigera", address: "dev-1" },
    "hallway-lamp": { transport: "dirigera", address: "dev-2" },
    "kitchen-thermometer": { transport: "bluetooth", address: "AA:BB" },
  };

  const matches = matchConfiguredDevices(dirigeraDevices, configuredRecords);

  assert.deepEqual(matches, [
    { name: "kitchen-lamp", transport: "dirigera", address: "dev-1", meta: { isOn: true, lightLevel: 75 } },
    { name: "hallway-lamp", transport: "dirigera", address: "dev-2", meta: { isOn: false } },
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
