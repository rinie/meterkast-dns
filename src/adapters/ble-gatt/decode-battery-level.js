// Battery Level (0x2A19): a single unsigned 8-bit percentage, 0-100.
export function decodeBatteryLevel(buffer) {
  return { value: buffer.readUInt8(0), unit: "%" };
}
