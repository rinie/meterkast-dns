// Weight Measurement (0x2A9D), per the Bluetooth GATT spec. Byte 0 is
// flags (bit 0: 0=SI/kg, 1=Imperial/lb); bytes 1-2 are the weight as a
// little-endian uint16, resolution 0.005 kg (SI) or 0.01 lb (Imperial).
// The optional time-stamp/user-ID/BMI-and-height fields are not decoded
// here, same scope limit as decode-temperature-measurement.js.
export function decodeWeightMeasurement(buffer) {
  const flags = buffer.readUInt8(0);
  const imperial = (flags & 0x01) === 1;
  const raw = buffer.readUInt16LE(1);

  return {
    value: imperial ? raw * 0.01 : raw * 0.005,
    unit: imperial ? "lb" : "kg",
  };
}
