import { KNOWN_CHARACTERISTICS } from "./known-characteristics.js";

export function resolveCharacteristicUuid(name) {
  return KNOWN_CHARACTERISTICS[name] ?? name;
}
