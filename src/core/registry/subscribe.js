export function subscribe(registry, listener) {
  registry.subscribers.add(listener);
  return () => registry.subscribers.delete(listener);
}
