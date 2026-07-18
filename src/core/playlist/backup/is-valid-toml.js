import { parse } from "smol-toml";

// The "validated" gate: never preserve a corrupt or truncated write as if
// it were a good backup generation.
export function isValidToml(text) {
  try {
    parse(text);
    return true;
  } catch {
    return false;
  }
}
