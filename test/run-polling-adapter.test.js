import { test } from "node:test";
import assert from "node:assert/strict";
import { createRegistry, upsertRecord, getRecord } from "../src/core/registry.js";
import { runPollingAdapter } from "../src/core/run-polling-adapter.js";

test("runPollingAdapter never calls the adapter when no device uses that transport", async () => {
  const registry = createRegistry();
  upsertRecord(registry, "myHpPrinter", { transport: "mdns", address: "printer.local" });
  let called = false;
  async function* fakeAdapter() {
    called = true;
  }

  await runPollingAdapter(registry, "dirigera", fakeAdapter);

  assert.equal(called, false);
});

test("runPollingAdapter runs the adapter and folds yielded readings back into the registry", async () => {
  const registry = createRegistry();
  upsertRecord(registry, "kitchen-lamp", { transport: "dirigera", address: "dev-1" });

  async function* fakeAdapter(records) {
    assert.deepEqual(Object.keys(records), ["kitchen-lamp"]);
    yield { name: "kitchen-lamp", transport: "dirigera", address: "dev-1", meta: { isOn: true } };
  }

  await runPollingAdapter(registry, "dirigera", fakeAdapter);

  assert.deepEqual(getRecord(registry, "kitchen-lamp").meta, { isOn: true });
});
