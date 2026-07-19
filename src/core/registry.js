// The in-memory name -> record store, plus its query/subscribe surface.
// state is a plain object ({records: Map, subscribers: Set}), passed
// explicitly into every function here -- no class, no hidden state.

export function createRegistry() {
  return { records: new Map(), subscribers: new Set() };
}

export function upsertRecord(registry, name, record) {
  const stored = { ...record, name };
  registry.records.set(name, stored);
  for (const notify of registry.subscribers) notify({ type: "upsert", name, record: stored });
  return stored;
}

export function removeRecord(registry, name) {
  const existed = registry.records.delete(name);
  if (existed) for (const notify of registry.subscribers) notify({ type: "remove", name });
  return existed;
}

export function getRecord(registry, name) {
  return registry.records.get(name);
}

export function listRecords(registry) {
  return [...registry.records.values()];
}

export function subscribe(registry, listener) {
  registry.subscribers.add(listener);
  return () => registry.subscribers.delete(listener);
}

// {records: Map} -> {name: record}, for adapters that need a plain object.
export function recordsAsObject(registry) {
  return Object.fromEntries(registry.records);
}
