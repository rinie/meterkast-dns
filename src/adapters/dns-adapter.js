// Regular unicast DNS resolution -- for router-assigned local hostnames
// (raspi3.home -> 192.168.1.53, typically from a dnsmasq-style router's
// combined DHCP+DNS server), a genuinely different mechanism from the
// mdns adapter's multicast .local resolution: one query, one unicast
// reply, straight to whatever DNS server the OS is already configured to
// use -- on a typical home LAN, that's the router itself. transport =
// "dns" in the playlist, distinct from transport = "mdns", because the
// protocol and the domain-suffix convention (.home/.lan/whatever the
// router uses, never reserved the way .local is) are both different, not
// because the shape of what gets stored differs. Uses Node's built-in
// `dns` module -- no new dependency, unlike the mdns adapter.
import defaultDns from "node:dns/promises";
import { networkInterfaces } from "node:os";
import { log } from "../core/log.js";

// Same A-preferred, AAAA-fallback shape as the mdns adapter's
// resolveHostname, for the same reason: a router-assigned hostname can be
// IPv6-only just as easily as an mDNS one, and the family actually used is
// reported explicitly rather than assumed. `resolver` defaults to the
// real global resolver but accepts an isolated `dns.Resolver` instance
// (via `setServers`) so tests can point at a fake local DNS server
// instead of touching the real network.
export async function resolveDnsHostname(hostname, { resolver = defaultDns } = {}) {
  try {
    const addresses = await resolver.resolve4(hostname);
    return { resolvedAddress: addresses[0], family: "A" };
  } catch (error) {
    if (error.code !== "ENODATA" && error.code !== "ENOTFOUND") throw error;
  }
  const addresses = await resolver.resolve6(hostname);
  return { resolvedAddress: addresses[0], family: "AAAA" };
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ipToInt(ip) {
  return (
    ip
      .split(".")
      .reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0
  );
}

function intToIp(int) {
  return [24, 16, 8, 0].map((shift) => (int >>> shift) & 0xff).join(".");
}

// Every host address in an IPv4 CIDR range -- plain arithmetic, no new
// npm package just to walk a subnet (a /24 is only 254 addresses). The
// network and broadcast addresses are excluded for anything smaller than
// a /31, since neither is ever a valid host on a real LAN. Bounded to
// /22..../32 (at most 1024 addresses) deliberately -- this is meant for
// "your own local subnet", not an accidental typo turning into a sweep of
// a /8; the cap exists to stop a mistake from hammering a real router's
// DNS server with thousands of lookups, not because anything larger is
// unsafe in principle.
export function hostAddressesInCidr(cidr) {
  const match = cidr.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/);
  if (!match) throw new Error(`Not a valid IPv4 CIDR: "${cidr}"`);
  const [, base, prefixStr] = match;
  const prefix = Number(prefixStr);
  if (prefix < 22 || prefix > 32) {
    throw new Error(`CIDR prefix must be between /22 and /32 (at most 1024 addresses) -- got /${prefix}`);
  }
  const hostBits = 32 - prefix;
  const size = 2 ** hostBits;
  const networkInt = hostBits === 0 ? ipToInt(base) : (ipToInt(base) & ((0xffffffff << hostBits) >>> 0)) >>> 0;
  const skipNetworkAndBroadcast = hostBits >= 2;
  const start = skipNetworkAndBroadcast ? 1 : 0;
  const end = skipNetworkAndBroadcast ? size - 1 : size;
  const addresses = [];
  for (let i = start; i < end; i += 1) addresses.push(intToIp(networkInt + i));
  return addresses;
}

function netmaskToPrefixLength(netmask) {
  return netmask.split(".").reduce((count, octet) => count + Number(octet).toString(2).split("1").length - 1, 0);
}

// No OS-portable API flag means "this interface is a VPN" -- this is a
// best-effort, name-based heuristic instead. Confirmed against a real
// case rather than invented: this project's own dev machine runs a
// corporate VPN client whose adapter is literally named "Centric Azure
// VPN" alongside a real "Wi-Fi" adapter, and detectLocalCidr below needs
// to prefer the latter. Not foolproof for every VPN client's naming
// convention -- errs toward skipping a plausible non-LAN interface rather
// than risking a scan of a VPN's own tunnel network by mistake.
const VPN_INTERFACE_NAME_PATTERN = /vpn|tap|tun\d|ppp|wireguard|openvpn|zerotier|tailscale|wsl|docker|virtualbox|vmware|hyper-v/i;

// Auto-detects a default subnet from this machine's own network
// interfaces -- a real, already-known local computation (no external
// lookup, nothing exposed beyond what the OS already hands any process on
// this machine). `interfaces` is injectable (os.networkInterfaces() by
// default) so tests can supply a fixed fake set instead of depending on
// whatever's real on the machine running the tests.
//
// Skips internal (loopback) and non-IPv4 addresses, then prefers the
// first candidate whose interface name doesn't look VPN-like -- a real
// laptop often has both a LAN adapter and an active VPN client's own
// virtual adapter at once, and auto-detecting the VPN's tunnel network
// instead of the real LAN would silently produce a scan that finds
// nothing useful, which is worse than not auto-detecting at all. Falls
// back to the first candidate found if every one of them looks VPN-like,
// rather than returning nothing -- a VPN-named LAN adapter is possible
// even if unlikely, and *a* candidate beats none. Returns undefined only
// when there's genuinely no non-internal IPv4 address to work with at
// all.
export function detectLocalCidr(interfaces = networkInterfaces()) {
  const candidates = [];
  for (const [interfaceName, addresses] of Object.entries(interfaces)) {
    for (const addr of addresses ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      candidates.push({ interfaceName, address: addr.address, netmask: addr.netmask });
    }
  }
  if (candidates.length === 0) return undefined;

  const preferred = candidates.find((c) => !VPN_INTERFACE_NAME_PATTERN.test(c.interfaceName)) ?? candidates[0];
  const prefix = netmaskToPrefixLength(preferred.netmask);
  const hostBits = 32 - prefix;
  const networkInt = hostBits === 0 ? ipToInt(preferred.address) : (ipToInt(preferred.address) & ((0xffffffff << hostBits) >>> 0)) >>> 0;
  return { cidr: `${intToIp(networkInt)}/${prefix}`, interfaceName: preferred.interfaceName };
}

// A reverse-PTR sweep of a subnet -- the only discovery mechanism plain
// DNS actually has (unlike mDNS's service-browse), and a real, if small,
// network scan: every address gets its own PTR query, run with bounded
// concurrency rather than all at once. A `ENOTFOUND`/`ENODATA` result
// (the overwhelming majority of addresses on a real LAN -- most IPs have
// no PTR record at all) is the expected, normal outcome, not an error;
// same treatment resolveDnsHostname already gives those two codes.
export async function scanSubnet(cidr, { resolver = defaultDns, concurrency = 8 } = {}) {
  const addresses = hostAddressesInCidr(cidr);
  const results = [];
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < addresses.length) {
      const ip = addresses[nextIndex];
      nextIndex += 1;
      try {
        const hostnames = await resolver.reverse(ip);
        if (hostnames.length > 0) results.push({ ip, hostname: hostnames[0] });
      } catch (error) {
        if (error.code !== "ENOTFOUND" && error.code !== "ENODATA") throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, addresses.length) }, worker));
  return results;
}

// The inverse of the targeted-resolution path: every scanSubnet hit whose
// hostname isn't already claimed by a `transport: "dns"` playlist entry
// (matched by hostname, the same value that entry's own `address` holds --
// see resolveDnsHostname/dnsAdapter above). `suggestedName` is a slugified
// version of the hostname itself (raspi3.home -> raspi3-home) -- only ever
// a starting point, same as every other transport's unclaimed-candidate
// function.
export function unclaimedDnsCandidates(scanResults, configuredRecords) {
  const claimedHostnames = new Set(
    Object.values(configuredRecords)
      .filter((record) => record.transport === "dns")
      .map((record) => record.address),
  );
  return scanResults
    .filter(({ hostname }) => !claimedHostnames.has(hostname))
    .map(({ ip, hostname }) => ({
      transport: "dns",
      address: hostname,
      suggestedName: slugify(hostname),
      meta: { ip },
    }));
}

// Polls every transport = "dns" playlist entry on an interval, same shape
// as every other polling adapter. `address` stays the human-configured
// hostname (raspi3.home) -- the lookup key, not the answer -- while the
// live-resolved IP and family land in `meta`. Spreading `...record` first
// carries forward any extra hand-typed playlist field, same reasoning as
// the mdns adapter's identical pattern.
export default async function* dnsAdapter(records, { intervalMs = 60000, resolver = defaultDns } = {}) {
  const targets = Object.entries(records).filter(([, record]) => record.transport === "dns");
  if (targets.length === 0) return;

  while (true) {
    for (const [name, record] of targets) {
      try {
        const resolved = await resolveDnsHostname(record.address, { resolver });
        yield { ...record, name, meta: resolved };
      } catch (error) {
        log("warn", `DNS resolution failed for ${name}: ${error.message}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
