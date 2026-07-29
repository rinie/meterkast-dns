// Address-prefix (or full-address) filtering for BLE discovery results,
// entirely playlist-driven (a top-level `bleIgnore` array in
// device-playlist.toml) -- deliberately never compiled into the ESP32
// proxy firmware, which keeps scanning and reporting every device it
// sees regardless. A household's own "ignore my neighbor's solar panel
// broadcasts" list is exactly that: a per-installation preference, not a
// firmware concern. Matching is prefix-based and case-insensitive so one
// entry like "DE:AD:BE:EF:00:" can cover an entire vendor's OUI block
// (the first 3 bytes of a MAC), not just one exact address.
export function isBleIgnored(address, ignoreList = []) {
  const upper = address.toUpperCase();
  return ignoreList.some((prefix) => upper.startsWith(prefix.toUpperCase()));
}
