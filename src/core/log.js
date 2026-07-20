// A bounded, timestamped, in-memory log -- the backend's own activity
// history, made visible the way Domoticz/Home Assistant's log screens
// show it. No database to persist it in (same reasoning as everywhere
// else in this project), so a rolling window of recent entries is the
// whole store: `log()` still prints to the real console too, so terminal
// output is unchanged by this existing everywhere it's called from.
const MAX_ENTRIES = 500;
const entries = [];
const subscribers = new Set();

const CONSOLE_METHOD = { error: "error", warn: "warn", info: "log", debug: "log" };

export function log(level, message) {
  const entry = { timestamp: new Date().toISOString(), level, message };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  console[CONSOLE_METHOD[level] ?? "log"](message);
  for (const notify of subscribers) notify(entry);
  return entry;
}

export function listLogs() {
  return [...entries];
}

export function subscribeLogs(listener) {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}
