// Discovery via one or more meterkast-esp32-proxy devices (a small
// Arduino-style HTTP server -- see the separate meterkast-esp32-proxy
// repo/README) that does BLE scanning and mDNS querying on real hardware
// and exposes both as plain JSON. Board-agnostic on purpose: an ESP32,
// a Pico W, or a Raspberry Pi running the same tiny JSON contract
// (GET /scan/ble, GET /scan/mdns) all fit here identically -- nothing in
// this file cares which board produced the JSON, only its shape.
//
// UNVERIFIED: no real proxy device has been flashed/reachable yet (see
// IMPLEMENTATION.md) -- this is real, tested code (fixture-based, the
// same bar every other adapter's unit tests hold to), but "verified live
// against real hardware" is still pending, unlike every other adapter in
// this project at the point it shipped.
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

async function fetchProxyJson(baseUrl, path) {
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
// {proxyUrl: rawDevices[]} -- kept per-proxy (not flattened yet) so the
// unclaimed* functions below can tag each candidate with where it
// actually came from.
export async function discoverBleViaProxies(proxyUrls) {
  const results = await Promise.all(proxyUrls.map((url) => fetchFromProxy(url, "/scan/ble", "BLE")));
  return Object.fromEntries(proxyUrls.map((url, i) => [url, results[i]]));
}

export async function discoverMdnsViaProxies(proxyUrls) {
  const results = await Promise.all(proxyUrls.map((url) => fetchFromProxy(url, "/scan/mdns", "mDNS")));
  return Object.fromEntries(proxyUrls.map((url, i) => [url, results[i]]));
}

// transport stays "bluetooth" -- the same value the Windows-native
// paired/nearby scans and web-scan.html's own WebBluetooth flow already
// use. Safe to share: nothing server-side polls a claimed "bluetooth"
// entry on a schedule today (the only consumer is web-scan.html's own
// browser-triggered GATT read, unrelated to how the device was
// discovered), so there's no local mechanism a proxy-sourced device
// could collide with the way mDNS does below.
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

// transport is "mdns-proxy", deliberately NOT "mdns" -- a real,
// load-bearing distinction, not a naming preference. Every existing
// transport="mdns" playlist entry is polled by mdns-adapter.js directly
// on this daemon -- exactly the path this whole proxy exists to route
// around, since this machine's own Windows Firewall blocks node.exe's
// own mDNS traffic (see README.md "Discovering unclaimed devices").
// Claiming a proxy-discovered device as plain "mdns" would silently hand
// it back to that same blocked local resolution path on the very next
// poll cycle, defeating the point of building this at all. A real
// mdns-proxy-adapter.js -- a small polling adapter that re-queries the
// proxy on an interval instead of resolving locally -- is the natural
// next piece once ongoing polling, not just one-time discovery, is
// wanted; not built yet, this file only produces the initial candidates.
export function unclaimedProxyMdnsDevices(rawEntriesByProxy, configuredRecords) {
  const claimed = new Set(
    Object.values(configuredRecords)
      .filter((record) => record.transport === "mdns-proxy")
      .map((record) => record.address),
  );
  const candidates = [];
  for (const [proxyUrl, entries] of Object.entries(rawEntriesByProxy)) {
    for (const entry of entries) {
      if (claimed.has(entry.hostname)) continue;
      candidates.push({
        transport: "mdns-proxy",
        address: entry.hostname,
        suggestedName: slugify(entry.hostname.replace(/\.local\.?$/i, "")),
        meta: { serviceType: entry.serviceType, ip: entry.ip, port: entry.port, sourceProxy: proxyUrl },
      });
    }
  }
  return candidates;
}
