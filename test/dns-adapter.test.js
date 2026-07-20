import { test } from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import dnsPromises from "node:dns/promises";
import dnsPacket from "dns-packet";
import { resolveDnsHostname, hostAddressesInCidr, scanSubnet, unclaimedDnsCandidates, detectLocalCidr } from "../src/adapters/dns-adapter.js";

// Real local unicast DNS, not a mock of the wire protocol -- a tiny UDP
// server built on dns-packet (already installed transitively via
// multicast-dns, made an explicit devDependency here since tests import it
// directly) answers real DNS queries on a real loopback socket, the same
// "real local infrastructure standing in for a real remote peer" pattern
// as the cloud adapters' self-signed HTTPS servers and the mdns adapter's
// fake responder.
function startFakeDnsServer(handleQuery) {
  return new Promise((resolveReady) => {
    const socket = dgram.createSocket("udp4");
    socket.on("message", (msg, rinfo) => {
      const query = dnsPacket.decode(msg);
      const answers = handleQuery(query.questions[0]);
      if (!answers) return;
      socket.send(
        dnsPacket.encode({ type: "response", id: query.id, questions: query.questions, answers }),
        rinfo.port,
        rinfo.address,
      );
    });
    socket.bind(0, "127.0.0.1", () => resolveReady(socket));
  });
}

async function withFakeDnsServer(handleQuery, run) {
  const socket = await startFakeDnsServer(handleQuery);
  const resolver = new dnsPromises.Resolver();
  resolver.setServers([`127.0.0.1:${socket.address().port}`]);
  try {
    return await run(resolver);
  } finally {
    socket.close();
  }
}

test("resolveDnsHostname resolves a router-assigned hostname to an A record", async () => {
  await withFakeDnsServer(
    (q) => (q?.type === "A" && q.name === "raspi3.home" ? [{ name: "raspi3.home", type: "A", ttl: 120, data: "192.168.1.53" }] : null),
    async (resolver) => {
      const result = await resolveDnsHostname("raspi3.home", { resolver });
      assert.equal(result.resolvedAddress, "192.168.1.53");
      assert.equal(result.family, "A");
    },
  );
});

test("resolveDnsHostname falls back to AAAA when only an IPv6 record exists", async () => {
  await withFakeDnsServer(
    (q) => {
      if (q?.type === "A" && q.name === "ipv6-only.home") return []; // ENODATA below, not a match
      if (q?.type === "AAAA" && q.name === "ipv6-only.home") {
        return [{ name: "ipv6-only.home", type: "AAAA", ttl: 120, data: "fe80::1" }];
      }
      return null;
    },
    async (resolver) => {
      const result = await resolveDnsHostname("ipv6-only.home", { resolver });
      assert.equal(result.resolvedAddress, "fe80::1");
      assert.equal(result.family, "AAAA");
    },
  );
});

test("resolveDnsHostname rejects when the server has neither an A nor AAAA record", async () => {
  // A real NOERROR-but-zero-answers response for every query -- genuine
  // NODATA, not silence, so this stays fast and deterministic instead of
  // waiting out a real resolver timeout.
  await withFakeDnsServer(
    () => [],
    async (resolver) => {
      await assert.rejects(resolveDnsHostname("empty.home", { resolver }), (error) => {
        return error.code === "ENODATA" || error.code === "ENOTFOUND";
      });
    },
  );
});

test("hostAddressesInCidr excludes the network and broadcast addresses for a /30", () => {
  assert.deepEqual(hostAddressesInCidr("192.168.1.0/30"), ["192.168.1.1", "192.168.1.2"]);
});

test("hostAddressesInCidr returns all 254 host addresses for a /24", () => {
  const addresses = hostAddressesInCidr("192.168.1.0/24");
  assert.equal(addresses.length, 254);
  assert.equal(addresses[0], "192.168.1.1");
  assert.equal(addresses[253], "192.168.1.254");
});

test("hostAddressesInCidr rejects a malformed CIDR string", () => {
  assert.throws(() => hostAddressesInCidr("not-a-cidr"), /Not a valid IPv4 CIDR/);
  assert.throws(() => hostAddressesInCidr("192.168.1.0"), /Not a valid IPv4 CIDR/);
});

test("hostAddressesInCidr rejects a prefix outside /22../32 -- a typo shouldn't be able to sweep a /8", () => {
  assert.throws(() => hostAddressesInCidr("10.0.0.0/8"), /CIDR prefix must be between \/22 and \/32/);
  assert.throws(() => hostAddressesInCidr("192.168.1.0/21"), /CIDR prefix must be between \/22 and \/32/);
});

// Real local unicast DNS again, same pattern as resolveDnsHostname's own
// tests above -- a genuine PTR query/response round trip, not a mocked
// resolver.reverse(). Confirmed the exact query shape Node's own
// resolver.reverse() sends (53.1.168.192.in-addr.arpa, type PTR) against
// this same fake-server harness before writing this test, rather than
// guessing at it.
test("scanSubnet sweeps a small range, collecting only the addresses that actually answer a PTR query", async () => {
  await withFakeDnsServer(
    (q) => {
      if (q?.type === "PTR" && q.name === "1.1.168.192.in-addr.arpa") {
        return [{ name: q.name, type: "PTR", ttl: 120, data: "raspi3.home" }];
      }
      return []; // NODATA (real, expected) for every other address in the /30
    },
    async (resolver) => {
      const results = await scanSubnet("192.168.1.0/30", { resolver, concurrency: 2 });
      assert.deepEqual(results, [{ ip: "192.168.1.1", hostname: "raspi3.home" }]);
    },
  );
});

test("unclaimedDnsCandidates filters out hostnames already claimed as transport=dns entries, suggests a slugified name", () => {
  const scanResults = [
    { ip: "192.168.1.53", hostname: "raspi3.home" },
    { ip: "192.168.1.77", hostname: "printer2.home" },
  ];
  const configuredRecords = {
    raspi3: { transport: "dns", address: "raspi3.home" },
    "kitchen-lamp": { transport: "dirigera", address: "dev-1" },
  };

  const candidates = unclaimedDnsCandidates(scanResults, configuredRecords);

  assert.deepEqual(candidates, [
    { transport: "dns", address: "printer2.home", suggestedName: "printer2-home", meta: { ip: "192.168.1.77" } },
  ]);
});

// Fixture shape captured from this project's own real dev machine's
// os.networkInterfaces() -- a real corporate VPN client ("Centric Azure
// VPN") active alongside a real Wi-Fi LAN adapter, plus the always-present
// loopback. Not synthesized: this exact ambiguity (two real, simultaneous
// non-internal IPv4 interfaces, one of them a VPN) is why the VPN-name
// heuristic exists at all.
const REAL_LAPTOP_INTERFACES = {
  "Wi-Fi": [
    { address: "192.168.1.57", netmask: "255.255.255.0", family: "IPv4", internal: false },
  ],
  "Centric Azure VPN": [
    { address: "172.22.33.40", netmask: "255.255.255.255", family: "IPv4", internal: false },
  ],
  "Loopback Pseudo-Interface 1": [
    { address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", internal: true },
  ],
};

test("detectLocalCidr prefers the real LAN interface over an active VPN's own adapter", () => {
  assert.deepEqual(detectLocalCidr(REAL_LAPTOP_INTERFACES), { cidr: "192.168.1.0/24", interfaceName: "Wi-Fi" });
});

test("detectLocalCidr masks the interface's own host address down to the true network address", () => {
  const interfaces = { Ethernet: [{ address: "10.0.5.200", netmask: "255.255.255.0", family: "IPv4", internal: false }] };
  assert.deepEqual(detectLocalCidr(interfaces), { cidr: "10.0.5.0/24", interfaceName: "Ethernet" });
});

test("detectLocalCidr falls back to the only candidate even if it looks VPN-like, rather than returning nothing", () => {
  const interfaces = { "Corp VPN": [{ address: "10.8.0.5", netmask: "255.255.255.0", family: "IPv4", internal: false }] };
  assert.deepEqual(detectLocalCidr(interfaces), { cidr: "10.8.0.0/24", interfaceName: "Corp VPN" });
});

test("detectLocalCidr ignores internal (loopback) and non-IPv4 addresses", () => {
  const interfaces = {
    Loopback: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", internal: true }],
    Wi6: [{ address: "fe80::1", netmask: "ffff:ffff:ffff:ffff::", family: "IPv6", internal: false }],
  };
  assert.equal(detectLocalCidr(interfaces), undefined);
});

test("detectLocalCidr returns undefined when there are no non-internal IPv4 addresses at all", () => {
  assert.equal(detectLocalCidr({}), undefined);
});
