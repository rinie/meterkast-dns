import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import bleGattProxyAdapter, { readBleGattRecord } from "../src/adapters/ble-gatt-proxy-adapter.js";

// A real local HTTP server standing in for the ESP32 proxy, same
// pattern proxy-adapter.test.js already uses -- routes hand-configured
// per test rather than one fixed fixture, since this adapter talks to
// two different real endpoints (GET /scan/ble, POST /gatt/session)
// depending on the profile kind.
function startFakeProxyServer(handlers) {
  return new Promise((resolveReady) => {
    const server = createServer((req, res) => {
      const handler = handlers[`${req.method} ${req.url}`];
      if (!handler) {
        res.writeHead(404).end();
        return;
      }
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = body ? JSON.parse(body) : undefined;
        const result = handler(parsed);
        res.writeHead(result.status ?? 200, { "content-type": "application/json" });
        res.end(JSON.stringify(result.body));
      });
    });
    server.listen(0, "127.0.0.1", () => resolveReady(server));
  });
}

// readBleGattRecord (one attempt, no loop) covers every "does this
// record produce a reading or not" case directly -- deliberately not
// exercised through the live bleGattProxyAdapter generator for the skip
// cases below: an async generator's .return() only takes effect at a
// yield point, and a record that never yields (unknown deviceType,
// device not currently visible) never reaches one, so racing a real
// generator for "did NOT yield" has no reliable way to tear it back down
// afterward. The generator itself is still exercised end-to-end by the
// two success-path tests, which do reach a real yield.

test("readBleGattRecord reads an advertisement-based (bthome-v2) profile from the passive scan", async () => {
  const server = await startFakeProxyServer({
    "GET /scan/ble": () => ({
      body: [
        {
          address: "A4:C1:38:AA:BB:CC",
          rssi: -60,
          ageMs: 1000,
          // device-info (0x40) + temperature objectId 0x02, CA 09 -> 25.06
          serviceData: { "0xfcd2": "4002ca09" },
        },
      ],
    }),
  });
  const { port } = server.address();
  try {
    const record = { transport: "ble-gatt", address: "A4:C1:38:AA:BB:CC", deviceType: "bthome-v2", proxyUrl: `http://127.0.0.1:${port}` };
    assert.deepEqual(await readBleGattRecord("living-room-thermometer", record), { temperature: 25.06 });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("readBleGattRecord reads a GATT-based (sig-thermometer) profile via a real POST /gatt/session", async () => {
  const server = await startFakeProxyServer({
    "POST /gatt/session": (requestBody) => {
      assert.equal(requestBody.address, "00:11:22:33:44:55");
      assert.equal(requestBody.serviceUuid, "1809");
      assert.deepEqual(requestBody.read, ["2a1c"]);
      // flags=0x00 (Celsius), mantissa=365, exponent=-1 -> 36.5 C
      return { body: { ok: true, readings: { "2a1c": "006d0100ff" } } };
    },
  });
  const { port } = server.address();
  try {
    const record = { transport: "ble-gatt", address: "00:11:22:33:44:55", deviceType: "sig-thermometer", proxyUrl: `http://127.0.0.1:${port}` };
    assert.deepEqual(await readBleGattRecord("kitchen-thermometer", record), { temperature: 36.5 });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("readBleGattRecord returns undefined for an unknown deviceType", async () => {
  const record = { transport: "ble-gatt", address: "AA:BB:CC:DD:EE:FF", deviceType: "not-a-real-profile", proxyUrl: "http://127.0.0.1:1" };
  assert.equal(await readBleGattRecord("mystery", record), undefined);
});

test("readBleGattRecord returns undefined for a device not currently visible in the passive scan", async () => {
  const server = await startFakeProxyServer({ "GET /scan/ble": () => ({ body: [] }) });
  const { port } = server.address();
  try {
    const record = { transport: "ble-gatt", address: "FF:FF:FF:FF:FF:FF", deviceType: "bthome-v2", proxyUrl: `http://127.0.0.1:${port}` };
    assert.equal(await readBleGattRecord("away-thermometer", record), undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("readBleGattRecord returns undefined when a GATT session fails", async () => {
  const server = await startFakeProxyServer({
    "POST /gatt/session": () => ({ body: { ok: false, error: "connect failed" } }),
  });
  const { port } = server.address();
  try {
    const record = { transport: "ble-gatt", address: "00:00:00:00:00:00", deviceType: "sig-thermometer", proxyUrl: `http://127.0.0.1:${port}` };
    assert.equal(await readBleGattRecord("unreachable-thermometer", record), undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("bleGattProxyAdapter yields the standard {...record, name, meta} shape for a real reading", async () => {
  const server = await startFakeProxyServer({
    "GET /scan/ble": () => ({ body: [{ address: "A4:C1:38:AA:BB:CC", rssi: -60, ageMs: 1000, serviceData: { "0xfcd2": "4002ca09" } }] }),
  });
  const { port } = server.address();
  const proxyUrl = `http://127.0.0.1:${port}`;
  const records = {
    "living-room-thermometer": { transport: "ble-gatt", address: "A4:C1:38:AA:BB:CC", deviceType: "bthome-v2", proxyUrl },
  };
  const generator = bleGattProxyAdapter(records, { intervalMs: 5 });

  try {
    const { value, done } = await generator.next();
    assert.equal(done, false);
    assert.deepEqual(value, {
      transport: "ble-gatt",
      address: "A4:C1:38:AA:BB:CC",
      deviceType: "bthome-v2",
      proxyUrl,
      name: "living-room-thermometer",
      meta: { temperature: 25.06 },
    });
  } finally {
    // Reaches this test's own yield before returning, so .return() here
    // takes effect immediately -- unlike the skip-case scenarios above,
    // deliberately not exercised through the live generator at all.
    await generator.return();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("bleGattProxyAdapter yields nothing at all when no ble-gatt records are configured", async () => {
  const generator = bleGattProxyAdapter({ other: { transport: "dirigera", address: "x" } });
  const { done } = await generator.next();
  assert.equal(done, true);
});
