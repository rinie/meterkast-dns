import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBthome } from "../src/adapters/decode-bthome.js";

// Every hex sequence below is a real example straight from the official
// BTHome v2 spec (bthome.io/format/), not invented -- hand-verified by
// tracing the little-endian/signed math before writing the decoder, the
// same discipline this project has held to for every other real-protocol
// decoder (IEEE-11073 temperature, the Medisana scale's format, etc.).

test("decodeBthome decodes temperature (sint16, factor 0.01)", () => {
  // device-info byte (0x40) + objectId 0x02 + CA 09 (LE int16 = 2506) -> 25.06
  const buffer = Buffer.from([0x40, 0x02, 0xca, 0x09]);
  assert.deepEqual(decodeBthome(buffer), { temperature: 25.06 });
});

test("decodeBthome decodes humidity (uint16, factor 0.01)", () => {
  const buffer = Buffer.from([0x40, 0x03, 0xbf, 0x13]);
  assert.deepEqual(decodeBthome(buffer), { humidity: 50.55 });
});

test("decodeBthome decodes battery (uint8, factor 1)", () => {
  const buffer = Buffer.from([0x40, 0x01, 0x61]);
  assert.deepEqual(decodeBthome(buffer), { battery: 97 });
});

test("decodeBthome decodes pressure (uint24, factor 0.01)", () => {
  const buffer = Buffer.from([0x40, 0x04, 0x13, 0x8a, 0x01]);
  assert.deepEqual(decodeBthome(buffer), { pressure: 1008.83 });
});

test("decodeBthome decodes illuminance (uint24, factor 0.01)", () => {
  const buffer = Buffer.from([0x40, 0x05, 0x13, 0x8a, 0x14]);
  assert.deepEqual(decodeBthome(buffer), { illuminance: 13460.67 });
});

test("decodeBthome decodes voltage (uint16, factor 0.001)", () => {
  const buffer = Buffer.from([0x40, 0x0c, 0x02, 0x0c]);
  assert.deepEqual(decodeBthome(buffer), { voltage: 3.074 });
});

test("decodeBthome decodes the 1-byte signed temperature variant (factor 1)", () => {
  const buffer = Buffer.from([0x40, 0x57, 0xea]); // -22
  assert.deepEqual(decodeBthome(buffer), { temperature: -22 });
});

test("decodeBthome decodes dewpoint (sint16, factor 0.01)", () => {
  const buffer = Buffer.from([0x40, 0x08, 0xca, 0x06]);
  assert.deepEqual(decodeBthome(buffer), { dewpoint: 17.38 });
});

test("decodeBthome decodes multiple fields in one packet, real thermometer shape", () => {
  // device-info + temperature(02CA09) + humidity(03BF13) + battery(0161)
  const buffer = Buffer.from([0x40, 0x02, 0xca, 0x09, 0x03, 0xbf, 0x13, 0x01, 0x61]);
  assert.deepEqual(decodeBthome(buffer), { temperature: 25.06, humidity: 50.55, battery: 97 });
});

test("decodeBthome stops at an unrecognized object ID, keeping fields decoded before it", () => {
  // per spec: a receiver can't safely skip an object id it doesn't know
  // the length of -- temperature decodes, then a bogus 0xff object id
  // halts parsing rather than misreading the rest of the buffer.
  const buffer = Buffer.from([0x40, 0x02, 0xca, 0x09, 0xff, 0x01, 0x02]);
  assert.deepEqual(decodeBthome(buffer), { temperature: 25.06 });
});

test("decodeBthome returns {} for a buffer with only the device-info byte", () => {
  assert.deepEqual(decodeBthome(Buffer.from([0x40])), {});
});
