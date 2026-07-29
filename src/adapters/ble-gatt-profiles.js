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
