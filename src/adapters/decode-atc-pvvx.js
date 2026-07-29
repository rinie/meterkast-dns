// ATC1441/pvvx custom thermometer firmware's own native advertisement
// format (advertisement Service Data under UUID 0x181A, the Bluetooth
// SIG's Environmental Sensing Service -- reused here as a container, not
// an actual ESS-conformant payload) -- a third, different format from
// both BTHome v2 (decode-bthome.js) and Xiaomi's native MiBeacon
// (decode-mibeacon.js), and the richest of the three for a device
// running this firmware: every field arrives in one packet every cycle,
// no round-robin wait the way MiBeacon's Object-per-advertisement design
// has. Two real, different layouts share this one UUID, told apart
// purely by payload length -- ported from meterkast-proxy's own real,
// already-verified `decodeAtc1441`/`decodePvvxCustom` in
// src/mija_thermometer.cpp (temperature/humidity math confirmed
// identical there); battery/voltage are new here, cross-checked against
// a real captured pvvx-format frame from the same device
// decode-mibeacon.js's tests already use ("ATC_F28AFA",
// a4:c1:38:f2:8a:fa).
//
// Both layouts start with the device's own MAC (6 bytes, byte-reversed)
// -- not decoded here, since the advertisement's own address (already
// matched against the playlist's configured address by the caller) is
// the same information.
const LENGTH_ATC1441 = 13;
const LENGTH_PVVX_CUSTOM = 15;

function readInt16LE(buffer, offset) {
  return buffer.readInt16LE(offset);
}

function readUInt16LE(buffer, offset) {
  return buffer.readUInt16LE(offset);
}

function applyFactor(raw, factor) {
  return Math.round(raw * factor * 1e6) / 1e6;
}

// atc1441 original format (13 bytes): MAC(6) + temperature (int16 LE,
// x0.1C) + humidity (uint8, whole percent) + battery percent (uint8) +
// battery voltage (uint16 LE, mV) + frame counter (uint8, not decoded --
// diagnostic, not a reading).
function decodeAtc1441(buffer) {
  return {
    temperature: applyFactor(readInt16LE(buffer, 6), 0.1),
    humidity: buffer.readUInt8(8),
    battery: buffer.readUInt8(9),
    voltage: applyFactor(readUInt16LE(buffer, 10), 0.001),
  };
}

// pvvx's extended "custom" format (15 bytes): MAC(6) + temperature
// (int16 LE, x0.01C) + humidity (uint16 LE, x0.01%) + battery voltage
// (uint16 LE, mV) + battery percent (uint8) + frame counter/flags (not
// decoded -- diagnostic, not a reading).
function decodePvvxCustom(buffer) {
  return {
    temperature: applyFactor(readInt16LE(buffer, 6), 0.01),
    humidity: applyFactor(readUInt16LE(buffer, 8), 0.01),
    voltage: applyFactor(readUInt16LE(buffer, 10), 0.001),
    battery: buffer.readUInt8(12),
  };
}

export function decodeAtcPvvx(buffer) {
  if (buffer.length === LENGTH_ATC1441) return decodeAtc1441(buffer);
  if (buffer.length === LENGTH_PVVX_CUSTOM) return decodePvvxCustom(buffer);
  return {};
}
