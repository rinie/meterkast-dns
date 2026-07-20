import { test } from "node:test";
import assert from "node:assert/strict";
import createMdns from "multicast-dns";
import { isServiceQuery, decodeTxt, resolveHostname, resolveService } from "../src/adapters/mdns-adapter.js";

test("isServiceQuery recognizes DNS-SD service patterns", () => {
  assert.equal(isServiceQuery("_mqtt._tcp.local"), true);
  assert.equal(isServiceQuery("_http._udp.local"), true);
  assert.equal(isServiceQuery("printer.local"), false);
  assert.equal(isServiceQuery("myHpPrinter"), false);
});

test("decodeTxt parses key=value Buffer pairs, skipping malformed entries", () => {
  const buffers = [Buffer.from("proto=3.1.1"), Buffer.from("no-equals-sign"), Buffer.from("tls=true")];
  assert.deepEqual(decodeTxt(buffers), { proto: "3.1.1", tls: "true" });
});

// Real local UDP multicast, not a mock of the wire protocol -- a second
// multicast-dns instance in this same test process acts as the responder,
// the same "real local infrastructure standing in for a real remote peer"
// pattern already used for the cloud adapters' self-signed HTTPS servers.
function withFakeResponder(handleQuery, run) {
  const responder = createMdns();
  const resolver = createMdns();
  responder.on("query", handleQuery(responder));
  return run(resolver).finally(() => {
    responder.destroy();
    resolver.destroy();
  });
}

test("resolveHostname resolves a plain mDNS hostname to an A record", async () => {
  await withFakeResponder(
    (responder) => (query) => {
      const q = query.questions[0];
      if (q?.type === "A" && q.name === "test-host.local") {
        responder.respond({ answers: [{ name: "test-host.local", type: "A", ttl: 120, data: "10.9.8.7" }] });
      }
    },
    async (resolver) => {
      const result = await resolveHostname(resolver, "test-host.local", { timeoutMs: 1000 });
      assert.equal(result.resolvedAddress, "10.9.8.7");
      assert.equal(result.ttl, 120);
    },
  );
});

test("resolveHostname rejects with a clear error when nothing responds", async () => {
  const resolver = createMdns();
  try {
    await assert.rejects(
      resolveHostname(resolver, "nobody-home.local", { timeoutMs: 200 }),
      /no A record found for nobody-home\.local/,
    );
  } finally {
    resolver.destroy();
  }
});

test("resolveService walks PTR -> SRV -> A -> TXT to a full broker address", async () => {
  await withFakeResponder(
    (responder) => (query) => {
      const q = query.questions[0];
      if (q?.type === "PTR" && q.name === "_mqtt._tcp.local") {
        responder.respond({
          answers: [{ name: "_mqtt._tcp.local", type: "PTR", ttl: 120, data: "My Broker._mqtt._tcp.local" }],
        });
      }
      if (q?.type === "SRV" && q.name === "My Broker._mqtt._tcp.local") {
        responder.respond({
          answers: [
            {
              name: "My Broker._mqtt._tcp.local",
              type: "SRV",
              ttl: 120,
              data: { priority: 0, weight: 0, port: 1883, target: "broker.local" },
            },
          ],
        });
      }
      if (q?.type === "TXT" && q.name === "My Broker._mqtt._tcp.local") {
        responder.respond({
          answers: [{ name: "My Broker._mqtt._tcp.local", type: "TXT", ttl: 120, data: [Buffer.from("proto=3.1.1")] }],
        });
      }
      if (q?.type === "A" && q.name === "broker.local") {
        responder.respond({ answers: [{ name: "broker.local", type: "A", ttl: 120, data: "10.1.2.3" }] });
      }
    },
    async (resolver) => {
      const result = await resolveService(resolver, "_mqtt._tcp.local", { timeoutMs: 1000 });
      assert.deepEqual(result, {
        instanceName: "My Broker._mqtt._tcp.local",
        host: "10.1.2.3",
        port: 1883,
        txt: { proto: "3.1.1" },
      });
    },
  );
});

test("resolveService rejects with a clear error when no PTR answer comes back", async () => {
  const resolver = createMdns();
  try {
    await assert.rejects(
      resolveService(resolver, "_nobody._tcp.local", { timeoutMs: 200 }),
      /no service instance found for _nobody\._tcp\.local/,
    );
  } finally {
    resolver.destroy();
  }
});
