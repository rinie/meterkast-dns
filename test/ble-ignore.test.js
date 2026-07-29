import { test } from "node:test";
import assert from "node:assert/strict";
import { isBleIgnored, normalizeUuid } from "../src/adapters/ble-ignore.js";

test("isBleIgnored matches a full address case-insensitively", () => {
  assert.equal(isBleIgnored("aa:bb:cc:dd:ee:ff", ["AA:BB:CC:DD:EE:FF"]), true);
});

test("isBleIgnored matches an OUI-style address prefix", () => {
  assert.equal(isBleIgnored("DE:AD:BE:EF:00:12", ["DE:AD:BE:EF:00:"]), true);
});

test("isBleIgnored returns false for an address matching no entry", () => {
  assert.equal(isBleIgnored("11:22:33:44:55:66", ["DE:AD:BE:EF:00:"]), false);
});

test("isBleIgnored returns false for an empty/default ignore list", () => {
  assert.equal(isBleIgnored("11:22:33:44:55:66"), false);
  assert.equal(isBleIgnored("11:22:33:44:55:66", []), false);
});

test("isBleIgnored matches by serviceData UUID via a uuid: entry, tolerant of the 0x prefix on either side", () => {
  const serviceData = { "0xfef3": "aabbcc" };
  assert.equal(isBleIgnored("11:22:33:44:55:66", ["uuid:fef3"], serviceData), true);
  assert.equal(isBleIgnored("11:22:33:44:55:66", ["uuid:0xfef3"], serviceData), true);
  assert.equal(isBleIgnored("11:22:33:44:55:66", ["UUID:FEF3"], serviceData), true);
});

test("isBleIgnored returns false for a uuid: entry when the device has no matching (or no) serviceData", () => {
  assert.equal(isBleIgnored("11:22:33:44:55:66", ["uuid:fef3"], { "0xfcd2": "aabbcc" }), false);
  assert.equal(isBleIgnored("11:22:33:44:55:66", ["uuid:fef3"]), false);
  assert.equal(isBleIgnored("11:22:33:44:55:66", ["uuid:fef3"], undefined), false);
});

test("normalizeUuid lowercases and strips an optional 0x prefix", () => {
  assert.equal(normalizeUuid("0xFCD2"), "fcd2");
  assert.equal(normalizeUuid("fcd2"), "fcd2");
});
