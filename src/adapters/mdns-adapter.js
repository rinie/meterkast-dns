// mDNS/DNS-SD resolution -- see README.md "Adapters, not one monolith"
// "MQTT adapter": the broker's address is discovered live via
// `_mqtt._tcp.local` instead of being hardcoded into the device at
// provisioning time, which is the actual motivating case this whole
// project started from. The same underlying mDNS query also resolves a
// plain hostname like `printer.local` -- both are transport = "mdns" in
// the playlist already, so one adapter covers both address shapes.
import createMdns from "multicast-dns";

// A DNS-SD service pattern looks like "_mqtt._tcp.local": service type,
// protocol, domain. A plain hostname like "printer.local" has none of that
// structure -- that's the only thing that tells the two paths apart, since
// mDNS folds "what kind of thing this is" into the name itself rather than
// a separate field.
export function isServiceQuery(address) {
  return address.startsWith("_") && (address.includes("._tcp.") || address.includes("._udp."));
}

// Resolves as soon as a matching answer arrives, not after the full
// timeout every time -- mDNS on a real LAN typically answers in
// milliseconds, and a resolution chain (PTR -> SRV -> A -> TXT) means
// waiting out a multi-second timeout four times over for one lookup.
// timeoutMs is a "nothing answered" fallback, not a fixed cost every call
// pays.
function queryOnce(mdns, question, matches, timeoutMs) {
  return new Promise((resolve) => {
    const found = [];
    let timer;
    const finish = () => {
      mdns.removeListener("response", onResponse);
      clearTimeout(timer);
      resolve(found);
    };
    const onResponse = (response) => {
      for (const answer of [...response.answers, ...response.additionals]) {
        if (matches(answer)) found.push(answer);
      }
      if (found.length > 0) finish();
    };
    mdns.on("response", onResponse);
    mdns.query({ questions: [question] });
    timer = setTimeout(finish, timeoutMs);
  });
}

// dns-packet hands TXT records back as an array of Buffers, one per
// key=value pair -- not a parsed object. Malformed entries (no "=") are
// skipped rather than guessed at, the same honest-fallback reasoning as
// the WebUSB/WebHID hex fallback.
export function decodeTxt(buffers) {
  const txt = {};
  for (const buffer of buffers) {
    const pair = buffer.toString("utf8");
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    txt[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return txt;
}

// Queries "ANY" rather than hardcoding "A" -- confirmed against a real
// device on a real LAN (Home Assistant's zeroconf responder) that a plain
// A query can come back empty while the device is genuinely live and
// mDNS-reachable, just IPv6-only on that network path (a link-local fe80::
// address, no A record at all). A well-behaved responder answers ANY with
// every record it has for that name, A and AAAA together when both exist
// (RFC 6762 §6), so this is the more honest query -- "give me whatever
// address you have", not "give me only IPv4 or nothing". IPv4 is preferred
// when both come back, since most downstream consumers (an HTTP client,
// say) still expect it, but the family actually used is reported in
// `meta` rather than silently assumed.
export async function resolveHostname(mdns, hostname, { timeoutMs = 3000 } = {}) {
  const answers = await queryOnce(
    mdns,
    { name: hostname, type: "ANY" },
    (a) => (a.type === "A" || a.type === "AAAA") && a.name === hostname,
    timeoutMs,
  );
  if (answers.length === 0) {
    throw new Error(`mDNS: no A or AAAA record found for ${hostname}`);
  }
  const preferred = answers.find((a) => a.type === "A") ?? answers[0];
  return { resolvedAddress: preferred.data, family: preferred.type, ttl: preferred.ttl };
}

// PTR (service type -> instance) -> SRV (instance -> host:port) -> A
// (host -> IP), plus TXT for whatever extra key=value data the service
// advertises. This is the standard DNS-SD resolution chain, the same one
// `avahi-browse`/`dns-sd` walk -- nothing project-specific about it.
export async function resolveService(mdns, serviceName, { timeoutMs = 3000 } = {}) {
  const ptrAnswers = await queryOnce(mdns, { name: serviceName, type: "PTR" }, (a) => a.type === "PTR" && a.name === serviceName, timeoutMs);
  if (ptrAnswers.length === 0) {
    throw new Error(`mDNS: no service instance found for ${serviceName}`);
  }
  const instanceName = ptrAnswers[0].data;

  const srvAnswers = await queryOnce(mdns, { name: instanceName, type: "SRV" }, (a) => a.type === "SRV" && a.name === instanceName, timeoutMs);
  if (srvAnswers.length === 0) {
    throw new Error(`mDNS: no SRV record for ${instanceName}`);
  }
  const { target, port } = srvAnswers[0].data;

  const targetAnswers = await queryOnce(
    mdns,
    { name: target, type: "ANY" },
    (a) => (a.type === "A" || a.type === "AAAA") && a.name === target,
    timeoutMs,
  );
  const targetAnswer = targetAnswers.find((a) => a.type === "A") ?? targetAnswers[0];
  const host = targetAnswer?.data ?? target; // fall back to the SRV target name if neither resolved within the window

  const txtAnswers = await queryOnce(mdns, { name: instanceName, type: "TXT" }, (a) => a.type === "TXT" && a.name === instanceName, timeoutMs);
  const txt = txtAnswers.length > 0 ? decodeTxt(txtAnswers[0].data) : {};

  return { instanceName, host, port, txt };
}

// Polls every transport = "mdns" playlist entry on an interval and
// re-resolves it, the same shape as every other polling adapter. `address`
// stays the human-configured name (printer.local, _mqtt._tcp.local) --
// that's the lookup key, not the answer -- while the live resolution
// (resolved IP, broker host:port, TXT data) lands in `meta`. Spreading
// `...record` first, rather than only { name, transport, address, meta },
// carries forward any extra hand-typed playlist field for this entry (like
// mqtt-broker's password_env) that this adapter doesn't itself manage --
// upsertRecord fully replaces the stored record on every reading, so
// without this a live mDNS update would silently wipe that field out.
export default async function* mdnsAdapter(records, { intervalMs = 60000, timeoutMs = 3000 } = {}) {
  const targets = Object.entries(records).filter(([, record]) => record.transport === "mdns");
  if (targets.length === 0) return;

  const mdns = createMdns();
  try {
    while (true) {
      for (const [name, record] of targets) {
        try {
          const resolved = isServiceQuery(record.address)
            ? await resolveService(mdns, record.address, { timeoutMs })
            : await resolveHostname(mdns, record.address, { timeoutMs });
          yield { ...record, name, meta: resolved };
        } catch (error) {
          console.error(`mDNS resolution failed for ${name}:`, error.message);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  } finally {
    mdns.destroy();
  }
}
