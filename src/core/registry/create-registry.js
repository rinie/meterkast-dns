export function createRegistry() {
  return { records: new Map(), subscribers: new Set() };
}
