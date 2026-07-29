// Xiaomi's own native MiBeacon protocol (advertisement Service Data
// under UUID 0xFE95) -- a different, older format than BTHome v2
// (decode-bthome.js), used by stock Xiaomi firmware and by ATC/pvvx
// custom firmware devices explicitly configured for "Mi Like"
// advertising rather than their own atc1441/pvvx-custom formats. Ported
// from meterkast-proxy's own real, already-verified `decodeMiBeacon` in
// src/mija_thermometer.cpp (written and confirmed live against a real
// device on this network, "ATC_F28AFA") -- same frame layout, extended
// here to also decode battery (0x100A), which that firmware-side parser
// deliberately ignores since it only feeds a Matter temperature/humidity
// accessory, but display-fields/ble-gatt.toml already has a battery
// field other profiles populate.
//
// Frame layout (little-endian throughout): Frame Control (2 bytes) +
// Product ID (2 bytes) + Frame Counter (1 byte) + optional MAC (6 bytes,
// byte-reversed) + optional Capability (1 byte, +2 more if its own IO
// bit is set) + one {Object ID (2 bytes), Length (1 byte), Data} triplet
// -- which optional fields are present is entirely gated by Frame
// Control's own bit flags, so nothing here is a fixed offset. A device
// round-robins which single value (temperature/humidity/battery/...) it
// reports each cycle -- most individual advertisements legitimately
// decode only one field, not a failure.
const FRAME_CONTROL_ENCRYPTED = 1 << 3;
const FRAME_CONTROL_HAS_MAC = 1 << 4;
const FRAME_CONTROL_HAS_CAPABILITY = 1 << 5;
const FRAME_CONTROL_HAS_OBJECT = 1 << 6;
const CAPABILITY_HAS_IO = 1 << 5;

// Real object-ID table (values confirmed against meterkast-proxy's own
// mija_thermometer.cpp, itself confirmed against real captured bytes) --
// only the fields this project actually has a real device reporting;
// extend as needed rather than guessing a missing entry.
const OBJECT_TYPES = {
  0x1004: { name: "temperature", bytes: 2, signed: true, factor: 0.1 },
  0x1006: { name: "humidity", bytes: 2, signed: false, factor: 0.1 },
  0x100a: { name: "battery", bytes: 1, signed: false, factor: 1 },
};

function readInt(buffer, offset, bytes, signed) {
  return signed ? buffer.readIntLE(offset, bytes) : buffer.readUIntLE(offset, bytes);
}

// Same floating-point-noise fix as decode-bthome.js's own applyFactor --
// raw * factor (0.1, say) routinely lands on 21.499999999999996 instead
// of 21.5 in ordinary IEEE 754 binary floating point.
function applyFactor(raw, factor) {
  return Math.round(raw * factor * 1e6) / 1e6;
}

export function decodeMibeacon(buffer) {
  if (buffer.length < 5) return {}; // Frame Control(2) + Product ID(2) + Frame Counter(1) minimum

  const frameControl = buffer.readUInt16LE(0);
  const isEncrypted = (frameControl & FRAME_CONTROL_ENCRYPTED) !== 0;
  const hasMac = (frameControl & FRAME_CONTROL_HAS_MAC) !== 0;
  const hasCapability = (frameControl & FRAME_CONTROL_HAS_CAPABILITY) !== 0;
  const hasObject = (frameControl & FRAME_CONTROL_HAS_OBJECT) !== 0;

  // Encrypted frames need a per-device bindkey this project has no way
  // to configure -- nothing to decode without an Object either.
  if (isEncrypted || !hasObject) return {};

  let offset = 5;
  if (hasMac) offset += 6;
  if (hasCapability) {
    if (offset >= buffer.length) return {};
    const hasIoCapability = (buffer.readUInt8(offset) & CAPABILITY_HAS_IO) !== 0;
    offset += 1;
    if (hasIoCapability) offset += 2;
  }

  if (offset + 3 > buffer.length) return {}; // Object ID(2) + Object Length(1) minimum
  const objectId = buffer.readUInt16LE(offset);
  const objectLen = buffer.readUInt8(offset + 2);
  if (offset + 3 + objectLen > buffer.length) return {}; // truncated

  const type = OBJECT_TYPES[objectId];
  if (!type || objectLen < type.bytes) return {};

  const raw = readInt(buffer, offset + 3, type.bytes, type.signed);
  return { [type.name]: applyFactor(raw, type.factor) };
}
