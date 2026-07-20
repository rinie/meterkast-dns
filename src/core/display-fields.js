// Flattens a device's nested `meta` (Ecowitt's real_time response, say --
// {outdoor: {temperature: {value, unit}}}) into a few curated, formatted
// display lines, driven by display-fields/ -- mirroring a device's own
// physical console rather than dumping every field the API happens to
// return. Same "normalize a differing meta shape into one clean field"
// spirit as server.js's summarizeResolution for dns/mdns, just
// hand-configurable per transport instead of hardcoded.
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

// Splits an already-flattened `{label, display}` line array into `shown`
// (the primary curated lines) and `hidden` (real, already-formatted
// values that exist in the catalog but this specific device chose not to
// show by default) -- per-device narrowing on top of display-fields/'s
// per-transport/deviceType catalog, driven by two optional
// device-playlist.toml keys: `displayFields` (an allow-list of labels --
// only these show) or `excludeDisplayFields` (a deny-list -- everything
// except these shows). Neither set: every catalog line shows, today's
// behavior, unchanged. Both set on one device: `include` wins outright --
// documented, not silently merged, since "show only X" and "show
// everything but Y" answer different questions and combining them would
// just be guessing which one the device actually meant.
//
// `hidden` isn't a UI decision this function makes -- it's the same
// values the catalog would have shown, just set aside, so a caller (the
// /screens/devices detail panel's collapsed "Hidden fields" section) can
// let someone check whether a deliberately-hidden field's live value
// still looks sane, without permanently re-enabling it.
export function partitionDisplayLines(lines, { include, exclude } = {}) {
  if (include && include.length > 0) {
    const allowed = new Set(include);
    return {
      shown: lines.filter((line) => allowed.has(line.label)),
      hidden: lines.filter((line) => !allowed.has(line.label)),
    };
  }
  if (exclude && exclude.length > 0) {
    const denied = new Set(exclude);
    return {
      shown: lines.filter((line) => !denied.has(line.label)),
      hidden: lines.filter((line) => denied.has(line.label)),
    };
  }
  return { shown: lines, hidden: [] };
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

// One file per transport (display-fields/ecowitt.toml,
// display-fields/dirigera.toml, ...) -- the same "one file per chapter"
// granularity as the rest of this project, and specifically to avoid a
// single shared file growing merge conflicts across independent
// transports' PRs (the exact friction a two-file device-playlist.toml/
// display-fields.toml split was originally built to avoid, just one
// layer further in). The filename is the transport name; a file's own
// content therefore never repeats it, unlike the old single-file
// `[[displayFields.ecowitt]]` shape.
//
// A parsed file with a top-level `fields` array is flat (Ecowitt: one
// uniform response shape). Otherwise every top-level key is a deviceType
// whose own array is used directly (Dirigera: one hub, structurally
// different device types) -- the same flat-vs-nested distinction
// resolveFieldDefs already makes on the merged in-memory shape, just
// decided once per file at load time instead of at lookup time.
//
// Returns {transport: [...] | {deviceType: [...]}} -- empty object (every
// transport just gets no display lines) when the directory doesn't exist,
// the same graceful-degradation shape readPlaylist already uses for a
// missing device-playlist.toml.
export async function loadDisplayFields(dir) {
  // bin/meterkastd.js passes a file:// URL (relative to import.meta.url);
  // readdir/readFile both accept that directly, but path.join doesn't --
  // normalized to a plain string path once here rather than at every
  // call site.
  const dirPath = dir instanceof URL ? fileURLToPath(dir) : dir;
  let filenames;
  try {
    filenames = await readdir(dirPath);
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  const displayFields = {};
  for (const filename of filenames) {
    if (extname(filename) !== ".toml") continue;
    const transport = basename(filename, ".toml");
    const text = await readFile(join(dirPath, filename), "utf8");
    const parsed = parse(text);
    displayFields[transport] = parsed.fields ?? parsed;
  }
  return displayFields;
}
