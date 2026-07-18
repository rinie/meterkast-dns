// Turns a nested `[devices.name]` + `[devices.name.readings]` playlist
// section into flat records, one per reading:
// `${deviceName}-${readingName}` -> {transport, address, service,
// characteristic}. Lets a human write the address once per physical
// device -- the same address-once pattern as RC5/newKaku remotes -- while
// every reading still ends up as an independently queryable entry in the
// same flat registry namespace as everything else, with no special-casing
// needed anywhere downstream (the core, the HTTP API).
export function flattenDeviceReadings(devicesSection = {}) {
  const flat = {};
  for (const [deviceName, device] of Object.entries(devicesSection)) {
    const { readings = {}, ...deviceFields } = device;
    for (const [readingName, reading] of Object.entries(readings)) {
      flat[`${deviceName}-${readingName}`] = { ...deviceFields, ...reading };
    }
  }
  return flat;
}
