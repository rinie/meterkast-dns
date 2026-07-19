import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRegistry } from "../src/core/registry/create-registry.js";
import { getRecord } from "../src/core/registry/get-record.js";
import { handleReport } from "../src/core/server/handle-report.js";
import { serveStaticPage } from "../src/core/server/serve-static-page.js";

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
