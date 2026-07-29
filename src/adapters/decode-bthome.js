// BTHome v2 -- a real, officially documented, self-describing format
// (https://bthome.io/format/), not reverse-engineered like the Medisana
// scale's protocol. Service data under UUID 0xFCD2: a 1-byte device-info
// byte, then a sequence of {objectId (1 byte), value (a fixed length
// determined entirely by that objectId)} pairs -- no length prefix per
// field, the object ID itself is the only thing that says how many bytes
// follow. This is the default output format for the pvvx ATC_MiThermometer
// custom firmware since v4.5, and generic across many sensor types by
// construction: the same parser below handles any BTHome-compliant
// device, not just one specific thermometer model.
//
// Real object-ID table (values confirmed against the official spec, a
// subset covering common environmental sensors -- extend as needed for a
// specific device, don't guess a missing entry):
const OBJECT_TYPES = {
  0x00: { name: "packetId", bytes: 1, signed: false, factor: 1 },
  0x01: { name: "battery", bytes: 1, signed: false, factor: 1 },
  0x02: { name: "temperature", bytes: 2, signed: true, factor: 0.01 },
  0x03: { name: "humidity", bytes: 2, signed: false, factor: 0.01 },
  0x04: { name: "pressure", bytes: 3, signed: false, factor: 0.01 },
  0x05: { name: "illuminance", bytes: 3, signed: false, factor: 0.01 },
  0x08: { name: "dewpoint", bytes: 2, signed: true, factor: 0.01 },
  0x0a: { name: "energy", bytes: 3, signed: false, factor: 0.001 },
  0x0b: { name: "power", bytes: 3, signed: false, factor: 0.01 },
  0x0c: { name: "voltage", bytes: 2, signed: false, factor: 0.001 },
  0x0d: { name: "pm2_5", bytes: 2, signed: false, factor: 1 },
  0x0e: { name: "pm10", bytes: 2, signed: false, factor: 1 },
  0x12: { name: "co2", bytes: 2, signed: false, factor: 1 },
  0x57: { name: "temperature", bytes: 1, signed: true, factor: 1 },
};

function readInt(buffer, offset, bytes, signed) {
  return signed ? buffer.readIntLE(offset, bytes) : buffer.readUIntLE(offset, bytes);
}

// Most real factors (0.01, 0.001, ...) aren't exactly representable in
// binary floating point -- raw * factor routinely lands on something
// like 25.060000000000002 instead of 25.06. Rounding to 6 decimal places
// is well past any real sensor's actual precision, so this only ever
// removes floating-point noise, never real data.
function applyFactor(raw, factor) {
  return Math.round(raw * factor * 1e6) / 1e6;
}

// Per the spec: "A receiver stops parsing when encountering an
// unsupported object ID" -- there's no generic length prefix to skip an
// unknown object by, only the fixed-per-objectId length in the table
// above, so an object ID this table doesn't know about genuinely can't
// be safely skipped past. Returns whatever fields decoded successfully
// before that point, not an error -- a real, spec-sanctioned partial
// result, not a failure.
export function decodeBthome(buffer) {
  const readings = {};
  // Byte 0 is the device-info byte (encryption flag, trigger-based flag,
  // BTHome version) -- not decoded here, only the measurements after it.
  let offset = 1;
  while (offset < buffer.length) {
    const objectId = buffer.readUInt8(offset);
    const type = OBJECT_TYPES[objectId];
    if (!type) break;
    offset += 1;
    if (offset + type.bytes > buffer.length) break;
    const raw = readInt(buffer, offset, type.bytes, type.signed);
    readings[type.name] = applyFactor(raw, type.factor);
    offset += type.bytes;
  }
  return readings;
}
