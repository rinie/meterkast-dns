import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProxyHosts, discoverBleViaProxies, unclaimedProxyBleDevices, tallyServiceDataUuidCounts } from "../src/adapters/proxy-adapter.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

async function loadBleFixture() {
  return JSON.parse(await readFile(join(FIXTURES_DIR, "proxy-ble-scan.json"), "utf8"));
}

// Real local plain-HTTP server standing in for a real proxy board -- the
// firmware's own webserver is plain HTTP, not HTTPS (see
// meterkast-proxy/src/web_server.cpp), so this is the honest
// equivalent of the self-signed-HTTPS-server pattern dirigera.test.js/
// smartbridge.test.js already use for their own real HTTP round trips.
function startFakeProxyServer(routes) {
  return new Promise((resolveReady) => {
    const server = createServer((req, res) => {
      const body = routes[req.url];
      if (body === undefined) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
    server.listen(0, "127.0.0.1", () => resolveReady(server));
  });
}

test("parseProxyHosts splits a comma-separated list, defaults to port 80, honours an explicit port", () => {
  const hosts = parseProxyHosts("meterkast-proxy.local, garage-proxy.local:8080");
  assert.deepEqual(hosts, ["http://meterkast-proxy.local:80", "http://garage-proxy.local:8080"]);
});

test("parseProxyHosts returns an empty array for an unset/blank value", () => {
  assert.deepEqual(parseProxyHosts(undefined), []);
  assert.deepEqual(parseProxyHosts(""), []);
});

test("discoverBleViaProxies fetches a real local proxy's /scan/ble and keeps results keyed by proxy URL", async () => {
  const bleFixture = await loadBleFixture();
  const server = await startFakeProxyServer({ "/scan/ble": bleFixture });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const results = await discoverBleViaProxies([baseUrl]);
    assert.deepEqual(results, { [baseUrl]: bleFixture });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("discoverBleViaProxies passes minRssi through as /scan/ble's own query param when given", async () => {
  const bleFixture = await loadBleFixture();
  const server = await startFakeProxyServer({ "/scan/ble?minRssi=-67": bleFixture });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const results = await discoverBleViaProxies([baseUrl], -67);
    assert.deepEqual(results, { [baseUrl]: bleFixture });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("discoverBleViaProxies omits the query string entirely when minRssi isn't given -- unfiltered, previous behavior", async () => {
  const bleFixture = await loadBleFixture();
  const server = await startFakeProxyServer({ "/scan/ble": bleFixture });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const results = await discoverBleViaProxies([baseUrl]);
    assert.deepEqual(results, { [baseUrl]: bleFixture });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("discoverBleViaProxies isolates an unreachable proxy -- one offline board doesn't fail the others", async () => {
  const bleFixture = await loadBleFixture();
  const server = await startFakeProxyServer({ "/scan/ble": bleFixture });
  const { port } = server.address();
  const reachableUrl = `http://127.0.0.1:${port}`;
  const unreachableUrl = "http://127.0.0.1:1"; // real, guaranteed-closed port -- a genuine connection failure, not a mock

  try {
    const results = await discoverBleViaProxies([reachableUrl, unreachableUrl]);
    assert.deepEqual(results[reachableUrl], bleFixture);
    assert.deepEqual(results[unreachableUrl], []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("unclaimedProxyBleDevices uppercases the address, excludes an already-claimed one, tags the source proxy", async () => {
  const bleFixture = await loadBleFixture();
  const rawByProxy = { "http://proxy-a": bleFixture };
  const configuredRecords = {
    "kitchen-lamp": { transport: "dirigera", address: "dev-1" },
    "already-claimed": { transport: "bluetooth", address: "AA:BB:CC:DD:EE:FF" },
  };

  const candidates = unclaimedProxyBleDevices(rawByProxy, configuredRecords);

  assert.deepEqual(candidates, [
    {
      transport: "bluetooth",
      address: "11:22:33:44:55:66".toUpperCase(),
      suggestedName: "bluetooth-112233445566",
      meta: {
        name: undefined,
        rssi: -80,
        proximity: "TOO FAR",
        ageMs: 30500,
        sourceProxy: "http://proxy-a",
        serviceDataUuidCounts: undefined,
      },
    },
  ]);
});

test("unclaimedProxyBleDevices excludes a device matching a bleIgnore prefix", async () => {
  const bleFixture = await loadBleFixture();
  const rawByProxy = { "http://proxy-a": bleFixture };

  const candidates = unclaimedProxyBleDevices(rawByProxy, {}, ["11:22:33:"]);

  assert.deepEqual(
    candidates.map((c) => c.address),
    ["AA:BB:CC:DD:EE:FF"],
  );
});

test("unclaimedProxyBleDevices passes through the proxy's own proximity label, undefined on older firmware without it", async () => {
  const rawByProxy = {
    "http://proxy-a": [
      { address: "aa:aa:aa:aa:aa:aa", rssi: -35, proximity: "VERY CLOSE", ageMs: 100 },
      { address: "bb:bb:bb:bb:bb:bb", rssi: -90, ageMs: 100 }, // no proximity field at all -- pre-upgrade firmware
    ],
  };

  const candidates = unclaimedProxyBleDevices(rawByProxy, {});

  assert.equal(candidates.find((c) => c.address === "AA:AA:AA:AA:AA:AA").meta.proximity, "VERY CLOSE");
  assert.equal(candidates.find((c) => c.address === "BB:BB:BB:BB:BB:BB").meta.proximity, undefined);
});

test("unclaimedProxyBleDevices suggests a slugified name when the device advertised one", async () => {
  const rawByProxy = { "http://proxy-a": [{ address: "aa:bb:cc:dd:ee:ff", name: "Oven", rssi: -62, ageMs: 1200 }] };

  const candidates = unclaimedProxyBleDevices(rawByProxy, {});

  assert.equal(candidates[0].suggestedName, "oven");
  assert.equal(candidates[0].address, "AA:BB:CC:DD:EE:FF");
});

test("tallyServiceDataUuidCounts counts each serviceData UUID across every configured proxy, deduped by address", () => {
  const rawByProxy = {
    "http://proxy-a": [
      { address: "11:11:11:11:11:11", serviceData: { "0xfef3": "aa" } },
      { address: "22:22:22:22:22:22", serviceData: { "0xfef3": "bb", "0xfcd2": "cc" } },
    ],
    // Same physical device as the first one above, also seen by a second board -- must not be double-counted.
    "http://proxy-b": [{ address: "11:11:11:11:11:11", serviceData: { "0xfef3": "aa-fresher" } }],
  };

  assert.deepEqual(tallyServiceDataUuidCounts(rawByProxy), { fef3: 2, fcd2: 1 });
});

test("unclaimedProxyBleDevices excludes a device matching a uuid: bleIgnore entry, keeps others", () => {
  const rawByProxy = {
    "http://proxy-a": [
      { address: "11:11:11:11:11:11", rssi: -80, ageMs: 100, serviceData: { "0xfef3": "aa" } },
      { address: "22:22:22:22:22:22", rssi: -70, ageMs: 200, serviceData: { "0xfcd2": "bb" } },
    ],
  };

  const candidates = unclaimedProxyBleDevices(rawByProxy, {}, ["uuid:fef3"]);

  assert.deepEqual(
    candidates.map((c) => c.address),
    ["22:22:22:22:22:22"],
  );
});

test("unclaimedProxyBleDevices attaches how common each of a device's own serviceData UUIDs is across the current scan", () => {
  const rawByProxy = {
    "http://proxy-a": [
      { address: "11:11:11:11:11:11", rssi: -80, ageMs: 100, serviceData: { "0xfef3": "aa" } },
      { address: "22:22:22:22:22:22", rssi: -70, ageMs: 200, serviceData: { "0xfef3": "bb" } },
      { address: "33:33:33:33:33:33", rssi: -60, ageMs: 300, serviceData: { "0xfcd2": "cc" } },
    ],
  };

  const candidates = unclaimedProxyBleDevices(rawByProxy, {});

  const common = candidates.find((c) => c.address === "11:11:11:11:11:11");
  assert.deepEqual(common.meta.serviceDataUuidCounts, { fef3: 2 });
  const rare = candidates.find((c) => c.address === "33:33:33:33:33:33");
  assert.deepEqual(rare.meta.serviceDataUuidCounts, { fcd2: 1 });
});
