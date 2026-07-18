import { decodeTemperatureMeasurement } from "./decode-temperature-measurement.js";
import { decodeWeightMeasurement } from "./decode-weight-measurement.js";
import { decodeBatteryLevel } from "./decode-battery-level.js";

const DECODERS = {
  "temperature-measurement": decodeTemperatureMeasurement,
  "weight-measurement": decodeWeightMeasurement,
  "battery-level": decodeBatteryLevel,
};

// Dispatches a raw characteristic value to its decoder by semantic name.
// An unknown/proprietary characteristic comes back as the raw Buffer --
// there is no spec to decode against, the same honest fallback as an
// undecodable IR remote falling back to LIRC's raw pulse capture.
export function decodeCharacteristic(characteristicName, buffer) {
  const decode = DECODERS[characteristicName];
  return decode ? decode(buffer) : buffer;
}
