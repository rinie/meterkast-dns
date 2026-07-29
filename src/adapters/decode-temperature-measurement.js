// Temperature Measurement (0x2A1C), per the Bluetooth GATT spec. Byte 0 is
// flags (bit 0: 0=Celsius, 1=Fahrenheit); bytes 1-4 are an IEEE 11073-20601
// 32-bit FLOAT: byte 4 (MSB) is a signed 8-bit exponent, bytes 1-3
// (LSB-first) are a signed 24-bit mantissa. value = mantissa * 10^exponent.
// The optional time-stamp/temperature-type fields (present per further
// flag bits) are not decoded here -- out of scope for what the resolver
// needs, which is the reading, not the full record.
export function decodeTemperatureMeasurement(buffer) {
  const flags = buffer.readUInt8(0);
  const unit = (flags & 0x01) === 0 ? "celsius" : "fahrenheit";

  const exponent = buffer.readInt8(4);
  let mantissa = buffer.readUIntLE(1, 3);
  if (mantissa & 0x800000) mantissa -= 0x1000000;

  return { value: mantissa * 10 ** exponent, unit };
}
