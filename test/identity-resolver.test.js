import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAliasIndex, resolveCandidates, currentAliasValue } from "../src/core/identity-resolver.js";

test("resolveCandidates resolves an existing no-aliases entry via its plain address (backward compat)", () => {
  const index = buildAliasIndex({
    "koelkast-thermometer": { transport: "ble-gatt", address: "A4:C1:38:70:D9:33", deviceType: "mibeacon" },
  });
  assert.deepEqual(resolveCandidates(index, "mac", "a4:c1:38:70:d9:33"), { status: "resolved", name: "koelkast-thermometer" });
});

test("resolveCandidates matches case-insensitively on both sides", () => {
  const index = buildAliasIndex({ "oven-ble": { transport: "bluetooth", address: "34:55:e5:57:1e:52" } });
  assert.equal(resolveCandidates(index, "mac", "34:55:E5:57:1E:52").status, "resolved");
});

test("resolveCandidates returns unknown for a raw key with no matching alias at all", () => {
  const index = buildAliasIndex({ "oven-ble": { transport: "bluetooth", address: "34:55:E5:57:1E:52" } });
  assert.deepEqual(resolveCandidates(index, "mac", "11:22:33:44:55:66"), { status: "unknown" });
});

test("resolveCandidates ignores records on transports with no implicit alias type (e.g. dirigera)", () => {
  const index = buildAliasIndex({ "kitchen-lamp": { transport: "dirigera", address: "dev-1" } });
  assert.deepEqual(resolveCandidates(index, "mac", "dev-1"), { status: "unknown" });
});

test("resolveCandidates resolves via an explicit aliases array", () => {
  const index = buildAliasIndex({
    "garage-thermometer": {
      transport: "ble-gatt",
      aliases: [{ type: "mac", value: "A4:C1:38:F2:8A:FA", validFrom: "2026-06-01" }],
    },
  });
  const result = resolveCandidates(index, "mac", "A4:C1:38:F2:8A:FA", new Date("2026-07-01"));
  assert.deepEqual(result, { status: "resolved", name: "garage-thermometer" });
});

test("resolveCandidates returns unknown for an alias observed before its validFrom", () => {
  const index = buildAliasIndex({
    "garage-thermometer": {
      transport: "ble-gatt",
      aliases: [{ type: "mac", value: "A4:C1:38:F2:8A:FA", validFrom: "2026-06-01" }],
    },
  });
  const result = resolveCandidates(index, "mac", "A4:C1:38:F2:8A:FA", new Date("2026-05-01"));
  assert.deepEqual(result, { status: "unknown" });
});

test("resolveCandidates returns unknown for an alias observed after its validTo", () => {
  const index = buildAliasIndex({
    "garage-thermometer": {
      transport: "ble-gatt",
      aliases: [{ type: "mac", value: "A4:C1:38:F2:8A:FA", validFrom: "2026-06-01", validTo: "2026-07-15" }],
    },
  });
  const result = resolveCandidates(index, "mac", "A4:C1:38:F2:8A:FA", new Date("2026-08-01"));
  assert.deepEqual(result, { status: "unknown" });
});

test("resolveCandidates handles a real MAC-rotation scenario: old alias expired, new one current, same device either way", () => {
  const index = buildAliasIndex({
    "garage-thermometer": {
      transport: "ble-gatt",
      aliases: [
        { type: "mac", value: "A4:C1:38:F2:8A:FA", validFrom: "2026-06-01", validTo: "2026-08-01" },
        { type: "mac", value: "A4:C1:38:F2:8A:FB", validFrom: "2026-08-01" },
      ],
    },
  });
  assert.deepEqual(resolveCandidates(index, "mac", "A4:C1:38:F2:8A:FA", new Date("2026-07-01")), {
    status: "resolved",
    name: "garage-thermometer",
  });
  assert.deepEqual(resolveCandidates(index, "mac", "A4:C1:38:F2:8A:FB", new Date("2026-09-01")), {
    status: "resolved",
    name: "garage-thermometer",
  });
  // The old address, queried after it stopped being valid for this
  // device, is a real "not this device anymore" -- not a stale hit.
  assert.deepEqual(resolveCandidates(index, "mac", "A4:C1:38:F2:8A:FA", new Date("2026-09-01")), { status: "unknown" });
});

test("resolveCandidates returns ambiguous when two live devices claim the same raw key at the same instant", () => {
  const index = buildAliasIndex({
    "device-a": { transport: "bluetooth", aliases: [{ type: "mac", value: "AA:BB:CC:DD:EE:FF" }] },
    "device-b": { transport: "bluetooth", aliases: [{ type: "mac", value: "AA:BB:CC:DD:EE:FF" }] },
  });
  const result = resolveCandidates(index, "mac", "AA:BB:CC:DD:EE:FF");
  assert.equal(result.status, "ambiguous");
  assert.deepEqual(
    result.candidates.map((c) => c.name).sort(),
    ["device-a", "device-b"],
  );
});

test("currentAliasValue returns the plain address for a no-aliases record (backward compat)", () => {
  const record = { transport: "ble-gatt", address: "A4:C1:38:70:D9:33" };
  assert.equal(currentAliasValue(record, "mac"), "A4:C1:38:70:D9:33");
});

test("currentAliasValue picks whichever alias is live right now, following a rotation", () => {
  const record = {
    transport: "ble-gatt",
    aliases: [
      { type: "mac", value: "A4:C1:38:F2:8A:FA", validFrom: "2026-06-01", validTo: "2026-08-01" },
      { type: "mac", value: "A4:C1:38:F2:8A:FB", validFrom: "2026-08-01" },
    ],
  };
  assert.equal(currentAliasValue(record, "mac", new Date("2026-07-01")), "A4:C1:38:F2:8A:FA");
  assert.equal(currentAliasValue(record, "mac", new Date("2026-09-01")), "A4:C1:38:F2:8A:FB");
});

test("currentAliasValue returns undefined when nothing is live for that type at that instant", () => {
  const record = { transport: "ble-gatt", aliases: [{ type: "mac", value: "A4:C1:38:F2:8A:FA", validFrom: "2026-06-01" }] };
  assert.equal(currentAliasValue(record, "mac", new Date("2026-01-01")), undefined);
});

test("buildAliasIndex ignores a record's aliases entirely if the array is empty, no implicit fallback added either", () => {
  const index = buildAliasIndex({ "weird-device": { transport: "ble-gatt", address: "AA:BB:CC:DD:EE:FF", aliases: [] } });
  // An explicit (even empty) aliases array opts out of the implicit
  // single-address fallback -- an empty array is a real, if unusual,
  // "this device currently has no valid aliases" statement.
  assert.deepEqual(resolveCandidates(index, "mac", "AA:BB:CC:DD:EE:FF"), { status: "unknown" });
});
