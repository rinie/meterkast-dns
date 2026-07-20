// Flattens a device's nested `meta` (Ecowitt's real_time response, say --
// {outdoor: {temperature: {value, unit}}}) into a few curated, formatted
// display lines, driven by display-fields.toml -- mirroring a device's
// own physical console rather than dumping every field the API happens
// to return. Same "normalize a differing meta shape into one clean
// field" spirit as server.js's summarizeResolution for dns/mdns, just
// hand-configurable per transport instead of hardcoded.
import { readFile } from "node:fs/promises";
import { parse } from "smol-toml";

function getPath(obj, path) {
  return path.split(".").reduce((cur, key) => cur?.[key], obj);
}

// Ecowitt (and most weather APIs) hand back numbers as decimal-point
// strings ("20.5") already -- normalized here to a fixed one decimal
// place for consistency (an integer-looking "20" still shows as "20.0"),
// but the decimal separator itself stays a plain period, on request:
// programming convention, not locale formatting, both internally and in
// this display. `toFixed` rather than `toLocaleString` specifically
// because the latter defaults to the runtime's own locale, which could
// silently reintroduce a comma decimal on a differently-configured host.
function formatNumber(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  return num.toFixed(1);
}

// fieldDefs: [{label, valuePath, unitPath?}], meta: a device's own meta
// object. A field whose valuePath resolves to nothing (wrong path, or
// this particular reading didn't include it) is skipped rather than
// shown blank -- same "only show what's real" reasoning as GET /resolved
// leaving out a never-resolved entry entirely.
export function flattenDisplayFields(fieldDefs, meta) {
  if (!meta || !fieldDefs) return [];
  const lines = [];
  for (const { label, valuePath, unitPath } of fieldDefs) {
    const rawValue = getPath(meta, valuePath);
    if (rawValue === undefined) continue;
    const unit = unitPath ? getPath(meta, unitPath) : undefined;
    const display = unit ? `${formatNumber(rawValue)} ${unit}` : formatNumber(rawValue);
    lines.push({ label, display });
  }
  return lines;
}

// Returns {transport: [{label, valuePath, unitPath?}]} -- empty object
// (every transport just gets no display lines) when the file doesn't
// exist, the same graceful-degradation shape readPlaylist already uses
// for a missing device-playlist.toml.
export async function loadDisplayFields(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  const parsed = parse(text);
  return parsed.displayFields ?? {};
}
