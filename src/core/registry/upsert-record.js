export function upsertRecord(registry, name, record) {
  const stored = { ...record, name };
  registry.records.set(name, stored);
  for (const notify of registry.subscribers) notify({ type: "upsert", name, record: stored });
  return stored;
}
