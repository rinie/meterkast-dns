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
        console.error(`DNS resolution failed for ${name}:`, error.message);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
