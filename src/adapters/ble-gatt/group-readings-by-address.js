// Takes the flat {name: {transport, address, service, characteristic}}
// records the registry already holds and groups them back by address, so
// one BLE connection can serve every reading on that device instead of
// reconnecting per characteristic.
export function groupReadingsByAddress(records) {
  const byAddress = new Map();
  for (const [name, record] of Object.entries(records)) {
    if (record.transport !== "bluetooth") continue;
    if (!byAddress.has(record.address)) byAddress.set(record.address, []);
    byAddress.get(record.address).push({ name, ...record });
  }
  return byAddress;
}
