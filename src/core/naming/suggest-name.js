import { slugify } from "./slugify.js";
import { suffixFromIp } from "./suffix-from-ip.js";
import { suffixFromCounter } from "./suffix-from-counter.js";

const IP_REACHABLE_TRANSPORTS = new Set(["mdns", "dhcp"]);

export function suggestName({ hostname, address, transport, existingNames }) {
  const base = slugify(hostname || transport);

  if (IP_REACHABLE_TRANSPORTS.has(transport)) {
    const octet = suffixFromIp(address);
    if (octet) return `${base}${octet}`;
  }

  return `${base}${suffixFromCounter(existingNames, base)}`;
}
