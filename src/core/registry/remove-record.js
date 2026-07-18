export function removeRecord(registry, name) {
  const existed = registry.records.delete(name);
  if (existed) for (const notify of registry.subscribers) notify({ type: "remove", name });
  return existed;
}
