import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeTemperatureMeasurement } from "../src/adapters/decode-temperature-measurement.js";

test("decodeTemperatureMeasurement decodes a Celsius IEEE-11073 FLOAT value (36.5 C)", () => {
  // mantissa=365, exponent=-1 -> 365 * 10^-1 = 36.5; flags=0x00 (Celsius)
  const buffer = Buffer.from([0x00, 0x6d, 0x01, 0x00, 0xff]);
  assert.deepEqual(decodeTemperatureMeasurement(buffer), { value: 36.5, unit: "celsius" });
});

test("decodeTemperatureMeasurement reports Fahrenheit from the units flag", () => {
  const buffer = Buffer.from([0x01, 0x6d, 0x01, 0x00, 0xff]);
  assert.equal(decodeTemperatureMeasurement(buffer).unit, "fahrenheit");
});
