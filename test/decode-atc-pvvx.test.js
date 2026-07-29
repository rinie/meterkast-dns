import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeAtcPvvx } from "../src/adapters/decode-atc-pvvx.js";

// The pvvx-custom vector is a real, live-captured advertisement from the
// same real device decode-mibeacon.test.js's own vectors use ("ATC_F28AFA",
// a4:c1:38:f2:8a:fa) -- hand-verified byte-by-byte before writing this
// test (temperature/humidity math also cross-checked against
// meterkast-proxy's own real, already-verified decodePvvxCustom in
// src/mija_thermometer.cpp). The atc1441 vector is hand-constructed from
// the documented 13-byte layout (mija_thermometer.h's own writeup),
// since no real atc1441-format capture exists on this network yet.

test("decodeAtcPvvx decodes a real captured pvvx-custom frame (15 bytes)", () => {
  const buffer = Buffer.from("fa8af238c1a4250af213190b47a104", "hex");
  assert.deepEqual(decodeAtcPvvx(buffer), { temperature: 25.97, humidity: 51.06, voltage: 2.841, battery: 71 });
});

test("decodeAtcPvvx decodes an atc1441 original frame (13 bytes)", () => {
  // MAC(aabbccddeeff) + temp(d700=215->21.5C) + humidity(37=55%) +
  // battery(50=80%) + voltage(b80b=3000mV->3.0V) + counter(01, unused).
  const buffer = Buffer.from("aabbccddeeffd7003750b80b01", "hex");
  assert.deepEqual(decodeAtcPvvx(buffer), { temperature: 21.5, humidity: 55, battery: 80, voltage: 3 });
});

test("decodeAtcPvvx returns {} for a payload matching neither known length", () => {
  assert.deepEqual(decodeAtcPvvx(Buffer.alloc(14)), {});
  assert.deepEqual(decodeAtcPvvx(Buffer.alloc(0)), {});
});
