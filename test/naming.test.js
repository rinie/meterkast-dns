import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, suffixFromIp, suffixFromCounter, suggestName } from "../src/core/naming.js";

test("slugify lowercases and strips punctuation", () => {
  assert.equal(slugify("Raspberry Pi!"), "raspberry-pi");
});

test("suffixFromIp returns the last octet", () => {
  assert.equal(suffixFromIp("192.168.178.54"), "54");
});

test("suffixFromCounter is empty for a fresh base name", () => {
  assert.equal(suffixFromCounter([], "kitchen-light"), "");
});

test("suffixFromCounter finds the next free number", () => {
  assert.equal(suffixFromCounter(["kitchen-light"], "kitchen-light"), "2");
  assert.equal(suffixFromCounter(["kitchen-light", "kitchen-light2"], "kitchen-light"), "3");
});

test("suggestName uses the IP octet for mdns devices", () => {
  const name = suggestName({
    hostname: "raspberrypi",
    address: "192.168.178.54",
    transport: "mdns",
    existingNames: [],
  });
  assert.equal(name, "raspberrypi54");
});

test("suggestName falls back to a counter for non-IP transports", () => {
  const name = suggestName({
    hostname: "Kitchen Light",
    address: "AA:BB:CC:DD:EE:FF",
    transport: "bluetooth",
    existingNames: ["kitchen-light"],
  });
  assert.equal(name, "kitchen-light2");
});
