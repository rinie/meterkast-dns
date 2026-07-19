// Matches Dirigera's raw device list against the playlist's configured
// dirigera-transport records (keyed by Dirigera's own device id), and
// produces upsert-ready records. Dirigera's own `attributes` object is
// passed through as `meta` verbatim rather than cherry-picked field by
// field -- the API already returns clean, well-named state (isOn,
// lightLevel, batteryPercentage, ...), which is the whole reason to use it
// instead of raw Zigbee/Matter in the first place.
export function matchConfiguredDevices(dirigeraDevices, configuredRecords) {
  const byId = new Map(dirigeraDevices.map((device) => [device.id, device]));
  const matches = [];
  for (const [name, record] of Object.entries(configuredRecords)) {
    if (record.transport !== "dirigera") continue;
    const device = byId.get(record.address);
    if (!device) continue;
    matches.push({
      name,
      transport: "dirigera",
      address: record.address,
      meta: device.attributes,
    });
  }
  return matches;
}
