// Address-prefix (or full-address) filtering for BLE discovery results,
// entirely playlist-driven (a top-level `bleIgnore` array in
// device-playlist.toml) -- deliberately never compiled into the ESP32
// proxy firmware, which keeps scanning and reporting every device it
// sees regardless. A household's own "ignore my neighbor's solar panel
// broadcasts" list is exactly that: a per-installation preference, not a
// firmware concern. A bare entry is matched as an address prefix
// (case-insensitive) so one entry like "DE:AD:BE:EF:00:" can cover an
// entire vendor's OUI block, not just one exact address.
//
// A "uuid:XXXX" entry instead matches by advertisement service-data UUID
// -- real, concrete need: Android's crowdsourced "Find My Device"
// network beacon (registered to Google LLC, confirmed against the
// official Bluetooth SIG assigned-numbers registry) uses genuinely
// rotating private addresses, so no fixed address prefix can ever catch
// it; the UUID it always advertises under is the only stable thing to
// match on. "uuid:fef3" and "uuid:0xfef3" are equivalent -- see
// normalizeUuid.

// The ESP32's own NimBLEUUID::toString() renders a 16-bit UUID as
// "0xfcd2" (confirmed live against real hardware, not assumed) --
// matching has to be tolerant of that "0x" prefix rather than require an
// exact string match. Shared here (not duplicated in
// ble-gatt-proxy-adapter.js, which has the same real need matching a
// profile's own serviceDataUuid against what the proxy reports).
export function normalizeUuid(uuid) {
  return uuid.toLowerCase().replace(/^0x/, "");
}

const UUID_PREFIX = "uuid:";

export function isBleIgnored(address, ignoreList = [], serviceData) {
  const upper = address.toUpperCase();
  const deviceUuids = serviceData ? new Set(Object.keys(serviceData).map(normalizeUuid)) : undefined;
  return ignoreList.some((entry) => {
    if (entry.toLowerCase().startsWith(UUID_PREFIX)) {
      return deviceUuids?.has(normalizeUuid(entry.slice(UUID_PREFIX.length))) ?? false;
    }
    return upper.startsWith(entry.toUpperCase());
  });
}
