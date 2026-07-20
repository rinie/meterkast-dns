import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flattenDisplayFields, loadDisplayFields, resolveFieldDefs, partitionDisplayLines } from "../src/core/display-fields.js";

const ECOWITT_META = {
  indoor: {
    temperature: { time: "1784545104", unit: "℃", value: "23.5" },
    humidity: { time: "1784545104", unit: "%", value: "44" },
  },
  outdoor: {
    temperature: { time: "1784545104", unit: "℃", value: "20.5" },
  },
};

test("flattenDisplayFields resolves dot-paths and formats value+unit with a period decimal", () => {
  const fieldDefs = [{ label: "Indoor Temperature", valuePath: "indoor.temperature.value", unitPath: "indoor.temperature.unit" }];
  assert.deepEqual(flattenDisplayFields(fieldDefs, ECOWITT_META), [{ label: "Indoor Temperature", display: "23.5 ℃" }]);
});

test("flattenDisplayFields works without a unitPath -- no trailing unit", () => {
  const fieldDefs = [{ label: "Indoor Humidity Value Only", valuePath: "indoor.humidity.value" }];
  assert.deepEqual(flattenDisplayFields(fieldDefs, ECOWITT_META), [{ label: "Indoor Humidity Value Only", display: "44.0" }]);
});

test("flattenDisplayFields skips a field whose path doesn't resolve, keeps the rest", () => {
  const fieldDefs = [
    { label: "Pressure (not in this reading)", valuePath: "pressure.absolute.value" },
    { label: "Outdoor Temperature", valuePath: "outdoor.temperature.value", unitPath: "outdoor.temperature.unit" },
  ];
  assert.deepEqual(flattenDisplayFields(fieldDefs, ECOWITT_META), [{ label: "Outdoor Temperature", display: "20.5 ℃" }]);
});

test("flattenDisplayFields returns an empty array for missing meta or missing fieldDefs", () => {
  assert.deepEqual(flattenDisplayFields([{ label: "x", valuePath: "a" }], undefined), []);
  assert.deepEqual(flattenDisplayFields(undefined, ECOWITT_META), []);
});

test("loadDisplayFields reads a flat fields array from <transport>.toml, keyed by filename", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  try {
    await writeFile(
      join(dir, "ecowitt.toml"),
      '[[fields]]\nlabel = "Indoor Temperature"\nvaluePath = "indoor.temperature.value"\nunitPath = "indoor.temperature.unit"\n',
    );
    const displayFields = await loadDisplayFields(dir);
    assert.deepEqual(displayFields.ecowitt, [
      { label: "Indoor Temperature", valuePath: "indoor.temperature.value", unitPath: "indoor.temperature.unit" },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadDisplayFields reads a deviceType-keyed table (no top-level fields array) as-is, merges multiple transport files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  try {
    await writeFile(join(dir, "ecowitt.toml"), '[[fields]]\nlabel = "Indoor Temperature"\nvaluePath = "indoor.temperature.value"\n');
    await writeFile(
      join(dir, "dirigera.toml"),
      '[[light]]\nlabel = "On"\nvaluePath = "isOn"\nformat = "boolean"\n\n[[outlet]]\nlabel = "On"\nvaluePath = "isOn"\nformat = "boolean"\n',
    );
    const displayFields = await loadDisplayFields(dir);
    assert.deepEqual(displayFields.ecowitt, [{ label: "Indoor Temperature", valuePath: "indoor.temperature.value" }]);
    assert.deepEqual(displayFields.dirigera, {
      light: [{ label: "On", valuePath: "isOn", format: "boolean" }],
      outlet: [{ label: "On", valuePath: "isOn", format: "boolean" }],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadDisplayFields ignores non-.toml files in the directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  try {
    await writeFile(join(dir, "ecowitt.toml"), '[[fields]]\nlabel = "Indoor Temperature"\nvaluePath = "indoor.temperature.value"\n');
    await writeFile(join(dir, "README.md"), "not a display-fields file\n");
    const displayFields = await loadDisplayFields(dir);
    assert.deepEqual(Object.keys(displayFields), ["ecowitt"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("flattenDisplayFields renders format:'boolean' as On/Off regardless of unitPath/unit", () => {
  const fieldDefs = [{ label: "On", valuePath: "isOn", format: "boolean" }];
  assert.deepEqual(flattenDisplayFields(fieldDefs, { isOn: true }), [{ label: "On", display: "On" }]);
  assert.deepEqual(flattenDisplayFields(fieldDefs, { isOn: false }), [{ label: "On", display: "Off" }]);
});

test("flattenDisplayFields uses a literal `unit` string when there's no unitPath -- Dirigera's lightLevel has no unit field to point at", () => {
  const fieldDefs = [{ label: "Brightness", valuePath: "lightLevel", unit: "%" }];
  assert.deepEqual(flattenDisplayFields(fieldDefs, { lightLevel: 70 }), [{ label: "Brightness", display: "70.0 %" }]);
});

test("resolveFieldDefs returns a flat array transport (Ecowitt) unchanged, ignoring deviceType", () => {
  const displayFields = { ecowitt: [{ label: "Indoor Temperature", valuePath: "indoor.temperature.value" }] };
  assert.deepEqual(resolveFieldDefs(displayFields, "ecowitt", undefined), displayFields.ecowitt);
});

test("resolveFieldDefs looks up by deviceType for a transport keyed that way (Dirigera)", () => {
  const displayFields = {
    dirigera: {
      light: [{ label: "On", valuePath: "isOn", format: "boolean" }],
      outlet: [{ label: "On", valuePath: "isOn", format: "boolean" }],
    },
  };
  assert.deepEqual(resolveFieldDefs(displayFields, "dirigera", "light"), displayFields.dirigera.light);
  assert.equal(resolveFieldDefs(displayFields, "dirigera", "motionSensor"), undefined);
});

test("resolveFieldDefs returns undefined for an unconfigured transport", () => {
  assert.equal(resolveFieldDefs({}, "bluetooth", undefined), undefined);
});

const SAMPLE_LINES = [
  { label: "On", display: "Off" },
  { label: "Brightness", display: "70.0 %" },
  { label: "Color", display: "Warm White" },
];

test("partitionDisplayLines with neither include nor exclude shows everything, hides nothing", () => {
  assert.deepEqual(partitionDisplayLines(SAMPLE_LINES), { shown: SAMPLE_LINES, hidden: [] });
  assert.deepEqual(partitionDisplayLines(SAMPLE_LINES, {}), { shown: SAMPLE_LINES, hidden: [] });
});

test("partitionDisplayLines with an allow-list shows only those labels, hides the rest", () => {
  const result = partitionDisplayLines(SAMPLE_LINES, { include: ["On"] });
  assert.deepEqual(result.shown, [{ label: "On", display: "Off" }]);
  assert.deepEqual(result.hidden, [
    { label: "Brightness", display: "70.0 %" },
    { label: "Color", display: "Warm White" },
  ]);
});

test("partitionDisplayLines with a deny-list hides only those labels, shows the rest", () => {
  const result = partitionDisplayLines(SAMPLE_LINES, { exclude: ["Color"] });
  assert.deepEqual(result.shown, [
    { label: "On", display: "Off" },
    { label: "Brightness", display: "70.0 %" },
  ]);
  assert.deepEqual(result.hidden, [{ label: "Color", display: "Warm White" }]);
});

test("partitionDisplayLines with both set: the allow-list wins outright, exclude is ignored", () => {
  const result = partitionDisplayLines(SAMPLE_LINES, { include: ["On"], exclude: ["On"] });
  assert.deepEqual(result.shown, [{ label: "On", display: "Off" }]);
});

test("loadDisplayFields returns {} when the directory doesn't exist, same graceful-degradation shape as readPlaylist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  try {
    const displayFields = await loadDisplayFields(join(dir, "nonexistent-dir"));
    assert.deepEqual(displayFields, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
