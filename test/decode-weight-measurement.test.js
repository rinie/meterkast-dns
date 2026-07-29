import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeWeightMeasurement } from "../src/adapters/decode-weight-measurement.js";

test("decodeWeightMeasurement decodes SI (kg) weight (72.5 kg)", () => {
  // raw=14500, *0.005 = 72.5; flags=0x00 (SI)
  const buffer = Buffer.from([0x00, 0xa4, 0x38]);
  assert.deepEqual(decodeWeightMeasurement(buffer), { value: 72.5, unit: "kg" });
});

test("decodeWeightMeasurement decodes Imperial (lb) weight", () => {
  // same raw=14500, *0.01 = 145; flags bit0=1 -> lb
  const buffer = Buffer.from([0x01, 0xa4, 0x38]);
  assert.deepEqual(decodeWeightMeasurement(buffer), { value: 145, unit: "lb" });
});
