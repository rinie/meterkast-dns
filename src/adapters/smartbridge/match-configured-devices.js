// The ICS2000 cloud's `data`/`status` fields are opaque encrypted blobs --
// confirmed against the real API, not assumed: base64-looking ciphertext,
// no documented or publicly known way to decrypt them. They pass through
// unchanged rather than being guessed at, the same honest fallback as an
// undecoded 128-bit BLE UUID or LIRC's raw pulse mode. version_status and
// version_data still change when the device's real state changes, which is
// enough to detect "something happened" without knowing what happened.
export function matchConfiguredDevices(smartbridgeDevices, configuredRecords) {
  const byId = new Map(smartbridgeDevices.map((device) => [device.id, device]));
  const matches = [];
  for (const [name, record] of Object.entries(configuredRecords)) {
    if (record.transport !== "smartbridge") continue;
    const device = byId.get(record.address);
    if (!device) continue;
    matches.push({
      name,
      transport: "smartbridge",
      address: record.address,
      meta: {
        version_status: device.version_status,
        version_data: device.version_data,
        time_added: device.time_added,
        encrypted_data: device.data,
        encrypted_status: device.status,
      },
    });
  }
  return matches;
}
