import { test } from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import dnsPromises from "node:dns/promises";
import dnsPacket from "dns-packet";
import { resolveDnsHostname } from "../src/adapters/dns-adapter.js";

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
