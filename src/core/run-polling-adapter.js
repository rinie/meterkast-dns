import { upsertRecord, recordsAsObject } from "./registry.js";

// Shared wiring for every polling adapter (Dirigera, Ecowitt, Smartbridge,
// ...): only runs if the playlist actually configured a device for that
// transport, folds every yielded reading back into the registry via
// upsertRecord. A misconfigured or unreachable adapter stays contained to
// itself -- see IMPLEMENTATION.md "Isolation is not the default" -- the
// caller is expected to .catch() and log, not let one adapter's failure
// take the whole daemon down.
export async function runPollingAdapter(registry, transport, adapterFn) {
  const hasDevices = [...registry.records.values()].some((record) => record.transport === transport);
  if (!hasDevices) return;
  for await (const reading of adapterFn(recordsAsObject(registry))) {
    upsertRecord(registry, reading.name, reading);
  }
}
