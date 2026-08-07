// Shared plumbing for talking to a meterkast proxy board -- a small
// Arduino-style HTTP server (see the separate meterkast-proxy
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
import { isBleIgnored, normalizeUuid } from "./ble-ignore.js";

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

// Exported: mdns-adapter.js's own proxy-resolution mode, and now
// ble-gatt-proxy-adapter.js's generic relay calls, reuse this same
// fetch-and-parse helper rather than duplicating it. All three are
// really talking to the same kind of thing (a proxy's small JSON API),
// just for different purposes. `body`, when given, POSTs it as JSON
// (the shape POST /gatt/session needs) instead of a plain GET.
export async function fetchProxyJson(baseUrl, path, body) {
  const res = await fetch(`${baseUrl}${path}`, body === undefined ? undefined : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
//
// minRssi, when given, is passed straight through as /scan/ble's own
// ?minRssi= query param (see meterkast-proxy's ble_scanner.h) -- the
// filtering happens on the board itself, not here; this side just
// forwards the floor rather than fetching everything and re-filtering
// client-side, since the proxy already does exactly this filtering for
// free. Omitted (undefined) means no query string at all, the same
// unfiltered behavior as before this existed.
export async function discoverBleViaProxies(proxyUrls, minRssi) {
  const path = minRssi === undefined ? "/scan/ble" : `/scan/ble?minRssi=${encodeURIComponent(minRssi)}`;
  const results = await Promise.all(proxyUrls.map((url) => fetchFromProxy(url, path, "BLE")));
  return Object.fromEntries(proxyUrls.map((url, i) => [url, results[i]]));
}

// How many currently-visible devices advertise each serviceData UUID --
// real motivation: deciding whether a `bleIgnore = ["uuid:XXXX"]` entry
// is worth adding at all (Google's crowdsourced "Find My Device" beacon
// showed up on 53 different, privacy-rotating addresses in one real
// scan; a device broadcasting a UUID nothing else uses is a real,
// distinct sensor, not noise). Deduped by address across every
// configured proxy first -- two boards both seeing the same physical
// device shouldn't count it twice, the tally is about how common a UUID
// is in the environment, not how many boards happened to catch it.
export function tallyServiceDataUuidCounts(rawDevicesByProxy) {
  const byAddress = new Map();
  for (const devices of Object.values(rawDevicesByProxy)) {
    for (const device of devices) {
      byAddress.set(device.address.toUpperCase(), device);
    }
  }
  const counts = {};
  for (const device of byAddress.values()) {
    if (!device.serviceData) continue;
    for (const uuid of Object.keys(device.serviceData)) {
      const normalized = normalizeUuid(uuid);
      counts[normalized] = (counts[normalized] ?? 0) + 1;
    }
  }
  return counts;
}

// transport stays "bluetooth" -- the same value the Windows-native
// paired/nearby scans and web-scan.html's own WebBluetooth flow already
// use.
export function unclaimedProxyBleDevices(rawDevicesByProxy, configuredRecords, ignoreList = []) {
  const claimed = new Set(
    Object.values(configuredRecords)
      .filter((record) => record.transport === "bluetooth")
      .map((record) => record.address),
  );
  const uuidCounts = tallyServiceDataUuidCounts(rawDevicesByProxy);
  const candidates = [];
  for (const [proxyUrl, devices] of Object.entries(rawDevicesByProxy)) {
    for (const device of devices) {
      const address = device.address.toUpperCase();
      if (claimed.has(address)) continue;
      if (isBleIgnored(address, ignoreList, device.serviceData)) continue;
      const serviceDataUuidCounts = device.serviceData
        ? Object.fromEntries(Object.keys(device.serviceData).map((uuid) => [normalizeUuid(uuid), uuidCounts[normalizeUuid(uuid)]]))
        : undefined;
      candidates.push({
        transport: "bluetooth",
        address,
        suggestedName: device.name ? slugify(device.name) : `bluetooth-${address.replace(/:/g, "")}`,
        meta: {
          name: device.name,
          rssi: device.rssi,
          // Coarse RSSI-bucketed label the proxy itself computes (see
          // ble_scanner.h's proximityLabel) -- not a distance estimate,
          // just a human-readable grouping of the same rssi already
          // here. Passed through as-is, same as every other raw field
          // in this object; undefined on an older proxy firmware that
          // predates this field.
          proximity: device.proximity,
          ageMs: device.ageMs,
          sourceProxy: proxyUrl,
          serviceDataUuidCounts,
        },
      });
    }
  }
  return candidates;
}
