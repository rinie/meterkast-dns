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

// Dirigera reports on/off state as a real boolean (isOn: true/false), not
// a string with a unit -- "23.7 %" formatting doesn't apply, it needs its
// own On/Off rendering instead.
function formatBoolean(value) {
  return value === true || value === "true" ? "On" : "Off";
}

// fieldDefs: [{label, valuePath, unitPath?, unit?, format?}], meta: a
// device's own meta object. A field whose valuePath resolves to nothing
// (wrong path, or this particular reading didn't include it) is skipped
// rather than shown blank -- same "only show what's real" reasoning as
// GET /resolved leaving out a never-resolved entry entirely.
//
// unitPath (a path into meta, Ecowitt-style: the unit travels alongside
// the reading) and unit (a literal string, Dirigera-style: lightLevel is
// always "%", there's no unit field in the API response to point at) are
// both supported -- unitPath wins if both happen to be set.
export function flattenDisplayFields(fieldDefs, meta) {
  if (!meta || !fieldDefs) return [];
  const lines = [];
  for (const { label, valuePath, unitPath, unit: literalUnit, format } of fieldDefs) {
    const rawValue = getPath(meta, valuePath);
    if (rawValue === undefined) continue;
    if (format === "boolean") {
      lines.push({ label, display: formatBoolean(rawValue) });
      continue;
    }
    const unit = unitPath ? getPath(meta, unitPath) : literalUnit;
    const display = unit ? `${formatNumber(rawValue)} ${unit}` : formatNumber(rawValue);
    lines.push({ label, display });
  }
  return lines;
}

// displayFields[transport] is either a flat array (Ecowitt: one uniform
// response shape, deviceType doesn't apply) or an object keyed by
// deviceType (Dirigera: one hub fans out to structurally different
// device types, each with its own fields -- a light's isOn/lightLevel
// doesn't mean anything for a door sensor's isOpen). Array wins the
// shape check so a bare `[[displayFields.ecowitt]]` transport never has
// to also carry a deviceType key it doesn't have.
export function resolveFieldDefs(displayFields, transport, deviceType) {
  const entry = displayFields?.[transport];
  if (!entry) return undefined;
  if (Array.isArray(entry)) return entry;
  return entry[deviceType];
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
