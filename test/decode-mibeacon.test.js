import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeMibeacon } from "../src/adapters/decode-mibeacon.js";

// Several vectors below are real, live-captured advertisements from two
// different real devices on this network: an ATC-firmware thermometer
// ("ATC_F28AFA", a4:c1:38:f2:8a:fa, battery/combined-temp-humidity) and
// a Xiaomi Mi Flora plant sensor ("Flower care", c4:7c:8d:65:d2:d3,
// temperature/moisture) -- decoded by hand before writing each test, not
// invented; the thermometer ones were cross-checked against
// meterkast-proxy's own real, already-verified mija_thermometer.cpp. The
// rest (humidity/illuminance/conductivity/edge cases) are hand-constructed
// from the same documented frame layout (Frame Control flags gate which
// optional fields are present), the same "hand-verified before writing"
// treatment decode-bthome.test.js's own spec vectors already get.

test("decodeMibeacon decodes a real captured battery reading (Frame Control 0x3050, MAC included)", () => {
  // Frame Control(5030) + ProductID(5b05=LYWSD03MMC) + Counter(bd) +
  // MAC reversed(fa8af238c1a4 -> a4:c1:38:f2:8a:fa) + Object 0x100A
  // (battery) len 1, data 0x47 = 71.
  const buffer = Buffer.from("50305b05bdfa8af238c1a40a10014702170b", "hex");
  assert.deepEqual(decodeMibeacon(buffer), { battery: 71 });
});

test("decodeMibeacon decodes temperature (sint16, factor 0.1), no MAC/capability present", () => {
  // Frame Control(0040=hasObject only) + ProductID(5b05) + Counter(01) +
  // Object 0x1004 len 2, data 00D7 LE = 215 -> 21.5C.
  const buffer = Buffer.from("40005b0501041002d700", "hex");
  assert.deepEqual(decodeMibeacon(buffer), { temperature: 21.5 });
});

test("decodeMibeacon decodes humidity (uint16, factor 0.1)", () => {
  // Object 0x1006 len 2, data 0228 LE = 552 -> 55.2%.
  const buffer = Buffer.from("40005b05010610022802", "hex");
  assert.deepEqual(decodeMibeacon(buffer), { humidity: 55.2 });
});

test("decodeMibeacon decodes a real captured combined temperature+humidity reading (Object 0x100D)", () => {
  // Real second capture of the same device from the other proxy board:
  // Frame Control(5030) + ProductID(5b05) + Counter(01) + MAC reversed
  // (fa8af238c1a4 -> a4:c1:38:f2:8a:fa) + Object 0x100D len 4, data
  // 0301 (int16 LE = 259 -> 25.9C) + fc01 (uint16 LE = 508 -> 50.8%).
  const buffer = Buffer.from("50305b0501fa8af238c1a40d10040301fc01", "hex");
  assert.deepEqual(decodeMibeacon(buffer), { temperature: 25.9, humidity: 50.8 });
});

test("decodeMibeacon returns {} for a truncated combined temperature+humidity object", () => {
  // Object 0x100D claims len 4 but only 3 data bytes are present.
  const buffer = Buffer.from("50305b0501fa8af238c1a40d10040301fc", "hex");
  assert.deepEqual(decodeMibeacon(buffer), {});
});

test("decodeMibeacon decodes a real captured temperature reading from a Mi Flora plant sensor (PID 0x0098)", () => {
  // Real advertisement from a second, different real device on this
  // network ("Flower care", c4:7c:8d:65:d2:d3) -- Frame Control(2071) +
  // ProductID(9800=0x0098, Mi Flora/HHCCJCY01) + Counter(11) + MAC
  // reversed(d3d2658d7cc4 -> c4:7c:8d:65:d2:d3) + Capability(0d, no IO
  // sub-flag) + Object 0x1004 len 2, data 1d01 LE = 285 -> 28.5C.
  const buffer = Buffer.from("7120980011d3d2658d7cc40d0410021d01", "hex");
  assert.deepEqual(decodeMibeacon(buffer), { temperature: 28.5 });
});

test("decodeMibeacon decodes a real captured moisture reading from the same Mi Flora sensor (Object 0x1008)", () => {
  // Object 0x1008 len 1, data 00 -> 0% -- physically plausible for this
  // real sensor currently sitting off-soil, not a guess.
  const buffer = Buffer.from("7120980097d3d2658d7cc40d08100100", "hex");
  assert.deepEqual(decodeMibeacon(buffer), { moisture: 0 });
});

test("decodeMibeacon decodes illuminance (uint24, factor 1, lux)", () => {
  // Object 0x1007 len 3, data f40100 LE = 500 -> 500 lux.
  const buffer = Buffer.from("4000980001071003f40100", "hex");
  assert.deepEqual(decodeMibeacon(buffer), { illuminance: 500 });
});

test("decodeMibeacon decodes conductivity (uint16, factor 1, uS/cm)", () => {
  // Object 0x1009 len 2, data 5e01 LE = 350 -> 350 uS/cm.
  const buffer = Buffer.from("40009800010910025e01", "hex");
  assert.deepEqual(decodeMibeacon(buffer), { conductivity: 350 });
});

test("decodeMibeacon returns {} for an encrypted frame (no bindkey to decode with)", () => {
  // Frame Control bit3 (encrypted) + bit6 (hasObject) set = 0x0048.
  const buffer = Buffer.from("48005b0501", "hex");
  assert.deepEqual(decodeMibeacon(buffer), {});
});

test("decodeMibeacon returns {} when Frame Control reports no Object at all", () => {
  // Frame Control bit4 (hasMac) only, bit6 (hasObject) clear = 0x0010.
  const buffer = Buffer.from("10005b0501", "hex");
  assert.deepEqual(decodeMibeacon(buffer), {});
});

test("decodeMibeacon returns {} for a buffer shorter than the minimum fixed header", () => {
  assert.deepEqual(decodeMibeacon(Buffer.from("500001", "hex")), {});
});

test("decodeMibeacon returns {} for an object type this project doesn't track (e.g. illuminance 0x1010)", () => {
  const buffer = Buffer.from("40005b05011010020001", "hex");
  assert.deepEqual(decodeMibeacon(buffer), {});
});

test("decodeMibeacon returns {} for a truncated object (declared length exceeds the buffer)", () => {
  // Object 0x1004 claims len 2 but only 1 data byte is actually present.
  const buffer = Buffer.from("40005b0501041002d7", "hex");
  assert.deepEqual(decodeMibeacon(buffer), {});
});
