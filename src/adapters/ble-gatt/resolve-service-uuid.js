import { KNOWN_SERVICES } from "./known-services.js";

// Semantic name -> the SIG-assigned 16-bit UUID (lowercase hex, no dashes
// or "0x" prefix -- noble's own convention). A proprietary 128-bit UUID has
// no semantic name and passes through unchanged; see README.md "Extending
// to BLE GATT characteristics".
export function resolveServiceUuid(name) {
  return KNOWN_SERVICES[name] ?? name;
}
