// MACs arrive in different cases/separators from different sources
// (noble's discovered peripherals vs. what a human typed into the
// playlist); compare on a normalized form rather than trusting both sides
// to agree on formatting.
export function normalizeAddress(address) {
  return address.toLowerCase().replaceAll(":", "");
}
