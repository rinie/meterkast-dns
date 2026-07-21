import { test } from "node:test";
import assert from "node:assert/strict";
import createMdns from "multicast-dns";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import mdnsAdapter, {
  isServiceQuery,
  decodeTxt,
  resolveHostname,
  resolveService,
  resolveViaProxy,
  discoverMdnsViaProxies,
  unclaimedMdnsCandidates,
} from "../src/adapters/mdns-adapter.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

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
      if (q?.type === "ANY" && q.name === "test-host.local") {
        responder.respond({ answers: [{ name: "test-host.local", type: "A", ttl: 120, data: "10.9.8.7" }] });
      }
    },
    async (resolver) => {
      const result = await resolveHostname(resolver, "test-host.local", { timeoutMs: 1000 });
      assert.equal(result.resolvedAddress, "10.9.8.7");
      assert.equal(result.family, "A");
      assert.equal(result.ttl, 120);
    },
  );
});

// Real finding, not a hypothetical: querying "A" for a real, live,
// mDNS-reachable Home Assistant instance on a real LAN came back empty --
// `ping homeassistant.local` succeeded via a link-local IPv6 (fe80::...)
// address the whole time. This is that case reproduced deterministically.
test("resolveHostname falls back to AAAA when a responder is IPv6-only", async () => {
  await withFakeResponder(
    (responder) => (query) => {
      const q = query.questions[0];
      if (q?.type === "ANY" && q.name === "homeassistant.local") {
        responder.respond({
          answers: [{ name: "homeassistant.local", type: "AAAA", ttl: 120, data: "fe80::dd5:891:aabe:aa77" }],
        });
      }
    },
    async (resolver) => {
      const result = await resolveHostname(resolver, "homeassistant.local", { timeoutMs: 1000 });
      assert.equal(result.resolvedAddress, "fe80::dd5:891:aabe:aa77");
      assert.equal(result.family, "AAAA");
    },
  );
});

test("resolveHostname prefers A over AAAA when a responder offers both", async () => {
  await withFakeResponder(
    (responder) => (query) => {
      const q = query.questions[0];
      if (q?.type === "ANY" && q.name === "dual-stack.local") {
        responder.respond({
          answers: [
            { name: "dual-stack.local", type: "A", ttl: 120, data: "10.5.5.5" },
            { name: "dual-stack.local", type: "AAAA", ttl: 120, data: "fe80::1" },
          ],
        });
      }
    },
    async (resolver) => {
      const result = await resolveHostname(resolver, "dual-stack.local", { timeoutMs: 1000 });
      assert.equal(result.resolvedAddress, "10.5.5.5");
      assert.equal(result.family, "A");
    },
  );
});

test("resolveHostname rejects with a clear error when nothing responds", async () => {
  const resolver = createMdns();
  try {
    await assert.rejects(
      resolveHostname(resolver, "nobody-home.local", { timeoutMs: 200 }),
      /no A or AAAA record found for nobody-home\.local/,
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
      if (q?.type === "ANY" && q.name === "broker.local") {
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

// Real local plain-HTTP server standing in for a real meterkast proxy
// board -- same pattern proxy-adapter.test.js uses for its own BLE
// round trips, reused here for mDNS-via-proxy resolution/discovery.
function startFakeProxyServer(routes) {
  return new Promise((resolveReady) => {
    const server = createServer((req, res) => {
      const body = routes[req.url];
      if (body === undefined) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
    server.listen(0, "127.0.0.1", () => resolveReady(server));
  });
}

async function loadProxyMdnsFixture() {
  return JSON.parse(await readFile(join(FIXTURES_DIR, "proxy-mdns-scan.json"), "utf8"));
}

test("resolveViaProxy resolves a plain hostname from the proxy's own cached /scan/mdns", async () => {
  const fixture = await loadProxyMdnsFixture();
  const server = await startFakeProxyServer({ "/scan/mdns": fixture });
  const { port } = server.address();
  const proxyUrl = `http://127.0.0.1:${port}`;

  try {
    const result = await resolveViaProxy(proxyUrl, "homeassistant.local");
    assert.deepEqual(result, { resolvedAddress: "192.168.1.50", family: "A" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("resolveViaProxy resolves a service query by matching serviceType, txt always empty (not part of the proxy's own JSON)", async () => {
  const fixture = await loadProxyMdnsFixture();
  const server = await startFakeProxyServer({ "/scan/mdns": fixture });
  const { port } = server.address();
  const proxyUrl = `http://127.0.0.1:${port}`;

  try {
    const result = await resolveViaProxy(proxyUrl, "_googlecast._tcp.local");
    assert.deepEqual(result, { instanceName: "chromecast-abcd.local", host: "192.168.1.60", port: 8009, txt: {} });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("resolveViaProxy rejects with a clear error when the proxy's cache has nothing for that address", async () => {
  const server = await startFakeProxyServer({ "/scan/mdns": [] });
  const { port } = server.address();
  const proxyUrl = `http://127.0.0.1:${port}`;

  try {
    await assert.rejects(resolveViaProxy(proxyUrl, "nobody.local"), /no A or AAAA record found for nobody\.local/);
    await assert.rejects(resolveViaProxy(proxyUrl, "_nobody._tcp.local"), /no service instance found for _nobody\._tcp\.local/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("discoverMdnsViaProxies flattens results from multiple proxies, tagging each entry with its source", async () => {
  const fixture = await loadProxyMdnsFixture();
  const server = await startFakeProxyServer({ "/scan/mdns": fixture });
  const { port } = server.address();
  const proxyUrl = `http://127.0.0.1:${port}`;

  try {
    const entries = await discoverMdnsViaProxies([proxyUrl]);
    assert.equal(entries.length, 2);
    assert.ok(entries.every((entry) => entry.sourceProxy === proxyUrl));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("discoverMdnsViaProxies isolates an unreachable proxy -- one offline board doesn't fail the others", async () => {
  const entries = await discoverMdnsViaProxies(["http://127.0.0.1:1"]);
  assert.deepEqual(entries, []);
});

test("unclaimedMdnsCandidates uses transport 'mdns' (not a separate transport), excludes an already-claimed hostname", async () => {
  const fixture = await loadProxyMdnsFixture();
  const entries = fixture.map((entry) => ({ ...entry, sourceProxy: "http://proxy-a" }));
  const configuredRecords = {
    "living-room-hub": { transport: "mdns", address: "homeassistant.local" },
  };

  const candidates = unclaimedMdnsCandidates(entries, configuredRecords);

  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0], {
    transport: "mdns",
    address: "chromecast-abcd.local",
    suggestedName: "chromecast-abcd",
    meta: { serviceType: "_googlecast._tcp", ip: "192.168.1.60", port: 8009, sourceProxy: "http://proxy-a" },
  });
});

test("unclaimedMdnsCandidates dedupes the same hostname seen by more than one proxy", () => {
  const entries = [
    { serviceType: "_home-assistant._tcp", hostname: "homeassistant.local", ip: "192.168.1.50", port: 8123, sourceProxy: "http://proxy-a" },
    { serviceType: "_home-assistant._tcp", hostname: "homeassistant.local", ip: "192.168.1.50", port: 8123, sourceProxy: "http://proxy-b" },
  ];
  const candidates = unclaimedMdnsCandidates(entries, {});
  assert.equal(candidates.length, 1);
});

test("mdnsAdapter uses resolveViaProxy for every target and never opens a local multicast socket when proxyUrl is set", async () => {
  const fixture = await loadProxyMdnsFixture();
  const server = await startFakeProxyServer({ "/scan/mdns": fixture });
  const { port } = server.address();
  const proxyUrl = `http://127.0.0.1:${port}`;

  const records = { "living-room-hub": { transport: "mdns", address: "homeassistant.local" } };
  const generator = mdnsAdapter(records, { intervalMs: 5, proxyUrl });

  try {
    const { value, done } = await generator.next();
    assert.equal(done, false);
    assert.equal(value.name, "living-room-hub");
    assert.deepEqual(value.meta, { resolvedAddress: "192.168.1.50", family: "A" });
  } finally {
    await generator.return();
    await new Promise((resolve) => server.close(resolve));
  }
});
