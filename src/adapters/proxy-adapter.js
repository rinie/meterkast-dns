// Shared plumbing for talking to a meterkast proxy board -- a small
// Arduino-style HTTP server (see the separate meterkast-esp32-proxy
// repo/README) that does BLE scanning and mDNS querying on real
// hardware and exposes both as plain JSON. Board-agnostic on this side
// on purpose: an ESP32, a Pico W, or a Raspberry Pi running the same
// tiny JSON contract (GET /scan/ble, GET /scan/mdns) all fit here
// identically -- nothing on this side of the proxy cares which board
// produced the JSON, only its shape, hence no "esp32" in this file's
// name even though the firmware sketch happens to target one first.
//
// UNVERIFIED: no real proxy device has been flashed/reachable yet (see
// IMPLEMENTATION.md) -- this is real, tested code (fixture-based / a
// real local server, the same bar every other adapter's unit tests hold
// to), but "verified live against real hardware" is still pending,
// unlike every other adapter in this project at the point it shipped.
//
// Only BLE discovery lives in this file. mDNS via a proxy is a *setting*
// on mdns-adapter.js instead, not a separate transport here -- a claimed
// mdns-transport device resolves the exact same way whether the proxy
// mechanism is in play or not, so it belongs entirely inside the file
// that already owns "what does an mdns playlist entry mean." Bluetooth
// has no equivalent existing home: nothing server-side polls a claimed
// "bluetooth" entry today (the only consumer is web-scan.html's own
// browser-triggered WebBluetooth GATT read), so its proxy-discovery
// logic stays here.
import { log } from "../core/log.js";

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Multiple proxies -- one per physical board -- supported from the
// start, not bolted on later: comma-separated in .env
// (METERKAST_PROXY_HOSTS=meterkast-proxy.local,garage-proxy.local:8080),
// the same real-instance-specific-but-not-secret config tier
// DIRIGERA_HOSTNAME/METERKAST_DNS_CIDR already use. A bare hostname
// defaults to port 80 (the firmware's own WebServer default); an
// explicit ":port" overrides it.
export function parseProxyHosts(envValue) {
  if (!envValue) return [];
  return envValue
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean)
    .map((host) => (host.includes(":") ? `http://${host}` : `http://${host}:80`));
}

// Exported: mdns-adapter.js's own proxy-resolution mode reuses this same
// fetch-and-parse helper rather than duplicating it -- the one
// deliberate cross-adapter import in this project so far, worth calling
// out as such rather than leaving it looking accidental. Both files are
// really talking to the same kind of thing (a proxy's small JSON API),
// just for different purposes (BLE discovery here, mDNS resolution
// there).
export async function fetchProxyJson(baseUrl, path) {
  const res = await fetch(`${baseUrl}${path}`);
  if (!res.ok) throw new Error(`${baseUrl}${path} returned HTTP ${res.status}`);
  return res.json();
}

// One misbehaving/offline/mid-reboot board shouldn't take the other
// proxies down with it -- caught and logged per proxy, same "isolation
// is not the default, but it should be" reasoning the polling adapters'
// own per-cycle try/catch already established; an empty array from one
// proxy just means "nothing new from that board this round."
async function fetchFromProxy(baseUrl, path, label) {
  try {
    return await fetchProxyJson(baseUrl, path);
  } catch (error) {
    log("warn", `${label} proxy ${baseUrl} unreachable: ${error.message}`);
    return [];
  }
}

// Queries every configured proxy in parallel and returns
// {proxyUrl: rawDevices[]} -- kept per-proxy (not flattened yet) so
// unclaimedProxyBleDevices can tag each candidate with where it actually
// came from.
export async function discoverBleViaProxies(proxyUrls) {
  const results = await Promise.all(proxyUrls.map((url) => fetchFromProxy(url, "/scan/ble", "BLE")));
  return Object.fromEntries(proxyUrls.map((url, i) => [url, results[i]]));
}

// transport stays "bluetooth" -- the same value the Windows-native
// paired/nearby scans and web-scan.html's own WebBluetooth flow already
// use.
export function unclaimedProxyBleDevices(rawDevicesByProxy, configuredRecords) {
  const claimed = new Set(
    Object.values(configuredRecords)
      .filter((record) => record.transport === "bluetooth")
      .map((record) => record.address),
  );
  const candidates = [];
  for (const [proxyUrl, devices] of Object.entries(rawDevicesByProxy)) {
    for (const device of devices) {
      const address = device.address.toUpperCase();
      if (claimed.has(address)) continue;
      candidates.push({
        transport: "bluetooth",
        address,
        suggestedName: device.name ? slugify(device.name) : `bluetooth-${address.replace(/:/g, "")}`,
        meta: { name: device.name, rssi: device.rssi, ageMs: device.ageMs, sourceProxy: proxyUrl },
      });
    }
  }
  return candidates;
}
