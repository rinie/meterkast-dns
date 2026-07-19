import { test } from "node:test";
import assert from "node:assert/strict";
import { createRegistry } from "../src/core/registry/create-registry.js";
import { upsertRecord } from "../src/core/registry/upsert-record.js";
import { getRecord } from "../src/core/registry/get-record.js";
import { listRecords } from "../src/core/registry/list-records.js";
import { removeRecord } from "../src/core/registry/remove-record.js";
import { subscribe } from "../src/core/registry/subscribe.js";
import { recordsAsObject } from "../src/core/registry/records-as-object.js";

test("upsert then get returns the record", () => {
  const registry = createRegistry();
  upsertRecord(registry, "kitchen-light", { transport: "zigbee", address: "0x1" });
  assert.deepEqual(getRecord(registry, "kitchen-light"), {
    name: "kitchen-light",
    transport: "zigbee",
    address: "0x1",
  });
});

test("list returns all records", () => {
  const registry = createRegistry();
  upsertRecord(registry, "a", { transport: "ble", address: "1" });
  upsertRecord(registry, "b", { transport: "ble", address: "2" });
  assert.equal(listRecords(registry).length, 2);
});

test("remove deletes and reports whether it existed", () => {
  const registry = createRegistry();
  upsertRecord(registry, "a", { transport: "ble", address: "1" });
  assert.equal(removeRecord(registry, "a"), true);
  assert.equal(removeRecord(registry, "a"), false);
});

test("subscribers are notified on upsert and remove, not after unsubscribing", () => {
  const registry = createRegistry();
  const events = [];
  const unsubscribe = subscribe(registry, (event) => events.push(event));

  upsertRecord(registry, "a", { transport: "ble", address: "1" });
  removeRecord(registry, "a");
  unsubscribe();
  upsertRecord(registry, "b", { transport: "ble", address: "2" });

  assert.equal(events.length, 2);
  assert.equal(events[0].type, "upsert");
  assert.equal(events[1].type, "remove");
});

test("recordsAsObject shapes the registry as {name: record} for an adapter", () => {
  const registry = createRegistry();
  upsertRecord(registry, "kitchen-lamp", { transport: "dirigera", address: "dev-1" });

  assert.deepEqual(recordsAsObject(registry), {
    "kitchen-lamp": { name: "kitchen-lamp", transport: "dirigera", address: "dev-1" },
  });
});
