import { test } from "node:test";
import assert from "node:assert/strict";
import { isBleIgnored } from "../src/adapters/ble-ignore.js";

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
