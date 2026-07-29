// The "specific mapping" the ESP32 proxy no longer has any of -- what a
// deviceType string in the playlist actually means, in terms a real BLE
// GATT/advertisement request can be built from, and how to decode
// whatever bytes come back. Two shapes, matching the two real mechanisms
// meterkast-proxy exposes:
//
// - "advertisement" profiles have no GATT connection at all -- they read
//   a serviceData UUID already captured by the proxy's own continuous
//   passive scan (GET /scan/ble). decode(serviceDataBuffer) -> meta.
// - "gatt" profiles connect and read one or more characteristics
//   (POST /gatt/session). decode(readingsByCharacteristicUuid) -> meta,
//   where each value is already a Buffer (hex-decoded by the adapter
//   before this runs, so a profile's own decode() never deals with hex
//   strings directly).
import { decodeBthome } from "./decode-bthome.js";
import { decodeMibeacon } from "./decode-mibeacon.js";
import { decodeAtcPvvx } from "./decode-atc-pvvx.js";
import { decodeTemperatureMeasurement } from "./decode-temperature-measurement.js";
import { KNOWN_SERVICES } from "./known-services.js";
import { KNOWN_CHARACTERISTICS } from "./known-characteristics.js";

export const BLE_GATT_PROFILES = {
  // BTHome v2 (bthome.io/format/) -- the default output format for the
  // pvvx ATC_MiThermometer custom firmware since v4.5. Its own UUID
  // (0xfcd2) isn't a Bluetooth SIG-assigned GATT service, so it's not in
  // known-services.js -- that registry is for GATT service UUIDs, a
  // different namespace than an advertisement's own service-data UUID,
  // even though both happen to be 16-bit hex forms.
  "bthome-v2": {
    kind: "advertisement",
    serviceDataUuid: "fcd2",
    decode: (serviceData) => decodeBthome(serviceData),
  },
  // Xiaomi's own native MiBeacon protocol -- stock Xiaomi firmware, or
  // ATC/pvvx custom firmware explicitly set to "Mi Like" advertising
  // instead of its own atc1441/pvvx-custom formats. Its own UUID
  // (0xfe95) is a Xiaomi vendor advertising UUID, not a Bluetooth SIG
  // GATT service, same reasoning bthome-v2's 0xfcd2 isn't in
  // known-services.js either. decodeMibeacon already normalizes to the
  // same flat field names (temperature, humidity, battery) as every
  // other profile here.
  mibeacon: {
    kind: "advertisement",
    serviceDataUuid: "fe95",
    decode: (serviceData) => decodeMibeacon(serviceData),
  },
  // ATC1441/pvvx custom thermometer firmware's own native advertisement
  // format -- the richest of the three advertisement profiles for a
  // device running it: temperature, humidity, battery percent, and
  // battery voltage all arrive in one packet every cycle, unlike
  // MiBeacon's round-robin Object-per-advertisement design. Two real,
  // different byte layouts share this one UUID (0x181A, reused as a
  // container, not an actual Bluetooth SIG Environmental Sensing Service
  // payload), told apart purely by payload length -- see
  // decode-atc-pvvx.js.
  "atc-pvvx": {
    kind: "advertisement",
    serviceDataUuid: "181a",
    decode: (serviceData) => decodeAtcPvvx(serviceData),
  },
  // A standard Bluetooth SIG Health Thermometer -- real, if this
  // project's own history is any guide, only for a device that actually
  // implements the standard profile rather than a proprietary one (see
  // meterkast-proxy's README on the stock Xiaomi thermometer's own
  // real, still-unconfirmed byte layout).
  //
  // Normalized to a bare `temperature` (always Celsius) rather than the
  // decoder's own raw {value, unit} shape, so display-fields/ble-gatt.toml
  // can stay flat -- every profile here reports the same field names
  // regardless of which physical protocol produced them, matching
  // bthome-v2's own always-Celsius convention (its temperature object has
  // no unit flag at all, unlike Weight Measurement's).
  "sig-thermometer": {
    kind: "gatt",
    serviceUuid: KNOWN_SERVICES["health-thermometer"],
    characteristics: [KNOWN_CHARACTERISTICS["temperature-measurement"]],
    decode: (readings) => {
      const { value, unit } = decodeTemperatureMeasurement(readings[KNOWN_CHARACTERISTICS["temperature-measurement"]]);
      return { temperature: unit === "fahrenheit" ? Math.round(((value - 32) * 5 / 9) * 100) / 100 : value };
    },
  },
};
