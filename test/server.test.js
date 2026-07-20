import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry, getRecord, upsertRecord } from "../src/core/registry.js";
import {
  handleReport,
  serveStaticPage,
  serveStaticFile,
  handleResolved,
  summarizeResolution,
  handleLogs,
  handleList,
  handleGet,
  handleDiscover,
  handleAddToPlaylist,
} from "../src/core/server.js";
import { readPlaylist, writePlaylist } from "../src/core/playlist.js";
import { log } from "../src/core/log.js";

function fakeRequestWithBody(bodyString) {
  const req = new EventEmitter();
  queueMicrotask(() => {
    req.emit("data", bodyString);
    req.emit("end");
  });
  return req;
}

function fakeResponse() {
  return {
    statusCode: undefined,
    headers: undefined,
    body: undefined,
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = headers;
      return this;
    },
    end(body) {
      this.body = body;
    },
  };
}

test("handleReport upserts a valid JSON body and responds with the stored record", async () => {
  const registry = createRegistry();
  const req = fakeRequestWithBody(
    JSON.stringify({ transport: "bluetooth", address: "AA:BB:CC:DD:EE:FF", meta: { value: 87, unit: "%" } }),
  );
  const res = fakeResponse();

  await new Promise((resolve) => {
    const originalEnd = res.end.bind(res);
    res.end = (body) => {
      originalEnd(body);
      resolve();
    };
    handleReport(registry, "kitchen-thermometer-battery", req, res);
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(getRecord(registry, "kitchen-thermometer-battery"), {
    name: "kitchen-thermometer-battery",
    transport: "bluetooth",
    address: "AA:BB:CC:DD:EE:FF",
    meta: { value: 87, unit: "%" },
  });
});

test("handleReport responds 400 for an invalid JSON body, without touching the registry", async () => {
  const registry = createRegistry();
  const req = fakeRequestWithBody("not json");
  const res = fakeResponse();

  await new Promise((resolve) => {
    const originalEnd = res.end.bind(res);
    res.end = (body) => {
      originalEnd(body);
      resolve();
    };
    handleReport(registry, "kitchen-thermometer-battery", req, res);
  });

  assert.equal(res.statusCode, 400);
  assert.equal(getRecord(registry, "kitchen-thermometer-battery"), undefined);
});

test("serveStaticPage serves web-scan.html as HTML", async () => {
  const res = fakeResponse();
  await serveStaticPage("web-scan.html", {}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
  assert.match(res.body, /WebBLE/);
});

test("serveStaticPage serves index.html as HTML", async () => {
  const res = fakeResponse();
  await serveStaticPage("index.html", {}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
  assert.match(res.body, /Devices/);
});

test("summarizeResolution reads resolvedAddress for the dns/mdns-hostname shape", () => {
  const record = { transport: "dns", meta: { resolvedAddress: "192.168.1.53", family: "A" } };
  assert.equal(summarizeResolution(record), "192.168.1.53");
});

test("summarizeResolution combines host:port for the mdns-service shape", () => {
  const record = { transport: "mdns", meta: { instanceName: "My Broker._mqtt._tcp.local", host: "10.1.2.3", port: 1883 } };
  assert.equal(summarizeResolution(record), "10.1.2.3:1883");
});

test("summarizeResolution returns null for an unresolved or non-resolver transport", () => {
  assert.equal(summarizeResolution({ transport: "mdns", meta: undefined }), null);
  assert.equal(summarizeResolution({ transport: "dirigera", meta: { isOn: true } }), null);
});

test("handleResolved lists only dns/mdns records that actually resolved", () => {
  const registry = createRegistry();
  upsertRecord(registry, "raspi3", { transport: "dns", address: "raspi3.home", meta: { resolvedAddress: "192.168.1.53", family: "A" } });
  upsertRecord(registry, "mqtt-broker", {
    transport: "mdns",
    address: "_mqtt._tcp.local",
    meta: { instanceName: "My Broker._mqtt._tcp.local", host: "10.1.2.3", port: 1883, txt: {} },
  });
  upsertRecord(registry, "myHpPrinter", { transport: "mdns", address: "printer.local" }); // never resolved
  upsertRecord(registry, "kitchen-lamp", { transport: "dirigera", address: "dev-1", meta: { isOn: true } }); // not a resolver transport

  const res = fakeResponse();
  handleResolved(registry, {}, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), [
    { name: "raspi3", transport: "dns", address: "raspi3.home", resolvedAddress: "192.168.1.53" },
    { name: "mqtt-broker", transport: "mdns", address: "_mqtt._tcp.local", resolvedAddress: "10.1.2.3:1883" },
  ]);
});

test("serveStaticFile serves a real file under public/ with the right content-type", async () => {
  const res = fakeResponse();
  await serveStaticFile("screens.js", {}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "text/javascript; charset=utf-8");
  assert.match(res.body.toString(), /createGrid/);
});

test("serveStaticFile serves a handcoded page as markdown", async () => {
  const res = fakeResponse();
  await serveStaticFile("pages/resolved.md", {}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "text/markdown; charset=utf-8");
  assert.match(res.body.toString(), /:::form/);
});

test("serveStaticFile responds 404 for a file that doesn't exist", async () => {
  const res = fakeResponse();
  await serveStaticFile("pages/nonexistent.md", {}, res);

  assert.equal(res.statusCode, 404);
});

test("serveStaticFile rejects a path-traversal attempt with 403, never reads outside public/", async () => {
  const res = fakeResponse();
  await serveStaticFile("../package.json", {}, res);

  assert.equal(res.statusCode, 403);
});

test("handleLogs returns recent log entries as JSON, including one just logged", () => {
  log("info", "handleLogs test unique message");

  const res = fakeResponse();
  handleLogs({}, res);

  assert.equal(res.statusCode, 200);
  const logs = JSON.parse(res.body);
  assert.ok(logs.some((entry) => entry.message === "handleLogs test unique message" && entry.level === "info"));
});

test("handleList adds curated display lines per record's own transport, empty for a transport with no mapping", () => {
  const registry = createRegistry();
  upsertRecord(registry, "weather-station", {
    transport: "ecowitt",
    address: "AA:BB",
    meta: { indoor: { temperature: { value: "23.5", unit: "℃" } } },
  });
  upsertRecord(registry, "kitchen-lamp", { transport: "dirigera", address: "dev-1", meta: { isOn: true } });
  const displayFields = {
    ecowitt: [{ label: "Indoor Temperature", valuePath: "indoor.temperature.value", unitPath: "indoor.temperature.unit" }],
  };

  const res = fakeResponse();
  handleList(registry, displayFields, {}, res);

  const records = JSON.parse(res.body);
  const weatherStation = records.find((r) => r.name === "weather-station");
  const kitchenLamp = records.find((r) => r.name === "kitchen-lamp");
  assert.deepEqual(weatherStation.display, [{ label: "Indoor Temperature", display: "23.5 ℃" }]);
  assert.deepEqual(kitchenLamp.display, []);
});

test("handleGet includes the same curated display lines for a single record", () => {
  const registry = createRegistry();
  upsertRecord(registry, "weather-station", {
    transport: "ecowitt",
    address: "AA:BB",
    meta: { indoor: { temperature: { value: "23.5", unit: "℃" } } },
  });
  const displayFields = {
    ecowitt: [{ label: "Indoor Temperature", valuePath: "indoor.temperature.value", unitPath: "indoor.temperature.unit" }],
  };

  const res = fakeResponse();
  handleGet(registry, displayFields, "weather-station", {}, res);

  assert.deepEqual(JSON.parse(res.body).display, [{ label: "Indoor Temperature", display: "23.5 ℃" }]);
});

test("handleGet resolves display fields by transport+deviceType for a hub like Dirigera, keeps a flat transport like Ecowitt working", () => {
  const registry = createRegistry();
  upsertRecord(registry, "kitchen-lamp", {
    transport: "dirigera",
    address: "dev-1",
    deviceType: "light",
    meta: { isOn: true, lightLevel: 70 },
  });
  upsertRecord(registry, "front-door", {
    transport: "dirigera",
    address: "dev-2",
    deviceType: "openCloseSensor",
    meta: { isOpen: false },
  });
  const displayFields = {
    dirigera: {
      light: [
        { label: "On", valuePath: "isOn", format: "boolean" },
        { label: "Brightness", valuePath: "lightLevel", unit: "%" },
      ],
      openCloseSensor: [{ label: "Open", valuePath: "isOpen", format: "boolean" }],
    },
  };

  const lampRes = fakeResponse();
  handleGet(registry, displayFields, "kitchen-lamp", {}, lampRes);
  assert.deepEqual(JSON.parse(lampRes.body).display, [
    { label: "On", display: "On" },
    { label: "Brightness", display: "70.0 %" },
  ]);

  const doorRes = fakeResponse();
  handleGet(registry, displayFields, "front-door", {}, doorRes);
  assert.deepEqual(JSON.parse(doorRes.body).display, [{ label: "Open", display: "Off" }]);
});

test("handleGet narrows display down to a device's own allow-list, moving the rest into displayHidden", () => {
  const registry = createRegistry();
  upsertRecord(registry, "kitchen-lamp", {
    transport: "dirigera",
    address: "dev-1",
    deviceType: "light",
    displayFields: ["On"],
    meta: { isOn: true, lightLevel: 70 },
  });
  const displayFields = {
    dirigera: {
      light: [
        { label: "On", valuePath: "isOn", format: "boolean" },
        { label: "Brightness", valuePath: "lightLevel", unit: "%" },
      ],
    },
  };

  const res = fakeResponse();
  handleGet(registry, displayFields, "kitchen-lamp", {}, res);
  const body = JSON.parse(res.body);

  assert.deepEqual(body.display, [{ label: "On", display: "On" }]);
  assert.deepEqual(body.displayHidden, [{ label: "Brightness", display: "70.0 %" }]);
});

test("handleGet narrows display down using a device's own deny-list", () => {
  const registry = createRegistry();
  upsertRecord(registry, "hallway-lamp", {
    transport: "dirigera",
    address: "dev-2",
    deviceType: "light",
    excludeDisplayFields: ["Brightness"],
    meta: { isOn: false, lightLevel: 30 },
  });
  const displayFields = {
    dirigera: {
      light: [
        { label: "On", valuePath: "isOn", format: "boolean" },
        { label: "Brightness", valuePath: "lightLevel", unit: "%" },
      ],
    },
  };

  const res = fakeResponse();
  handleGet(registry, displayFields, "hallway-lamp", {}, res);
  const body = JSON.parse(res.body);

  assert.deepEqual(body.display, [{ label: "On", display: "Off" }]);
  assert.deepEqual(body.displayHidden, [{ label: "Brightness", display: "30.0 %" }]);
});

test("handleDiscover returns a transport's candidates as JSON", async () => {
  const discoverFns = {
    dirigera: async () => [{ transport: "dirigera", address: "dev-9", suggestedName: "shed-sensor", meta: {} }],
  };
  const res = fakeResponse();

  await handleDiscover(discoverFns, "dirigera", new URLSearchParams(), {}, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), [{ transport: "dirigera", address: "dev-9", suggestedName: "shed-sensor", meta: {} }]);
});

test("handleDiscover responds 404 for a transport with no discovery function wired up", async () => {
  const res = fakeResponse();
  await handleDiscover({}, "dns", new URLSearchParams(), {}, res);
  assert.equal(res.statusCode, 404);
});

test("handleDiscover responds 502 when the discovery function itself fails (a real network/credential error, not a bug)", async () => {
  const discoverFns = { dirigera: async () => { throw new Error("DIRIGERA_HOSTNAME is not set"); } };
  const res = fakeResponse();

  await handleDiscover(discoverFns, "dirigera", new URLSearchParams(), {}, res);

  assert.equal(res.statusCode, 502);
  assert.deepEqual(JSON.parse(res.body), { error: "DIRIGERA_HOSTNAME is not set" });
});

test("handleDiscover forwards the request's own query params to the discover function -- DNS's cidr has no sane server-side default", async () => {
  let receivedQuery;
  const discoverFns = {
    dns: async (query) => {
      receivedQuery = query;
      return [];
    },
  };
  const res = fakeResponse();

  await handleDiscover(discoverFns, "dns", new URLSearchParams("cidr=192.168.1.0/30"), {}, res);

  assert.equal(receivedQuery.get("cidr"), "192.168.1.0/30");
});

test("handleAddToPlaylist writes a real entry to disk (backup + atomic write, same as any hand-edit) and upserts it into the live registry immediately", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  const playlistPath = join(dir, "device-playlist.toml");
  try {
    await writePlaylist(playlistPath, { "kitchen-lamp": { transport: "dirigera", address: "dev-1" } });
    const registry = createRegistry();
    upsertRecord(registry, "kitchen-lamp", { transport: "dirigera", address: "dev-1" });

    const req = fakeRequestWithBody(
      JSON.stringify({ name: "shed-sensor", transport: "dirigera", address: "dev-9", deviceType: "motionSensor" }),
    );
    const res = fakeResponse();
    await new Promise((resolve) => {
      const originalEnd = res.end.bind(res);
      res.end = (body) => {
        originalEnd(body);
        resolve();
      };
      handleAddToPlaylist(registry, playlistPath, req, res);
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.pollingStartsAfterRestart, true);
    assert.equal(body.record.name, "shed-sensor");

    const onDisk = await readPlaylist(playlistPath);
    assert.deepEqual(onDisk["shed-sensor"], { transport: "dirigera", address: "dev-9", deviceType: "motionSensor" });
    assert.deepEqual(getRecord(registry, "shed-sensor"), {
      name: "shed-sensor",
      transport: "dirigera",
      address: "dev-9",
      deviceType: "motionSensor",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("handleAddToPlaylist responds 400 when the body has no name", async () => {
  const registry = createRegistry();
  const req = fakeRequestWithBody(JSON.stringify({ transport: "dirigera", address: "dev-9" }));
  const res = fakeResponse();

  await new Promise((resolve) => {
    const originalEnd = res.end.bind(res);
    res.end = (body) => {
      originalEnd(body);
      resolve();
    };
    handleAddToPlaylist(registry, "/unused", req, res);
  });

  assert.equal(res.statusCode, 400);
});

test("handleAddToPlaylist responds 409 with a suggestedName on a real collision, leaves the playlist and registry untouched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  const playlistPath = join(dir, "device-playlist.toml");
  try {
    await writePlaylist(playlistPath, { "shed-sensor": { transport: "dirigera", address: "dev-1" } });
    const registry = createRegistry();
    upsertRecord(registry, "shed-sensor", { transport: "dirigera", address: "dev-1" });

    const req = fakeRequestWithBody(JSON.stringify({ name: "shed-sensor", transport: "dirigera", address: "dev-9" }));
    const res = fakeResponse();
    await new Promise((resolve) => {
      const originalEnd = res.end.bind(res);
      res.end = (body) => {
        originalEnd(body);
        resolve();
      };
      handleAddToPlaylist(registry, playlistPath, req, res);
    });

    assert.equal(res.statusCode, 409);
    assert.equal(JSON.parse(res.body).suggestedName, "shed-sensor-2");
    assert.deepEqual(getRecord(registry, "shed-sensor"), { name: "shed-sensor", transport: "dirigera", address: "dev-1" });

    const onDisk = await readPlaylist(playlistPath);
    assert.deepEqual(onDisk["shed-sensor"], { transport: "dirigera", address: "dev-1" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
