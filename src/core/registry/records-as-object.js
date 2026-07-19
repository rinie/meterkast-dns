// The registry's records Map is already keyed by name with each record
// carrying its own .name field (upsertRecord stores it that way) -- so
// this is just a shape change, not a lookup, for handing the current
// state to an adapter that expects {name: record} rather than a Map.
export function recordsAsObject(registry) {
  return Object.fromEntries(registry.records);
}
