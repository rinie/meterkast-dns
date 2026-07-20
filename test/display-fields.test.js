import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flattenDisplayFields, loadDisplayFields } from "../src/core/display-fields.js";

const ECOWITT_META = {
  indoor: {
    temperature: { time: "1784545104", unit: "℃", value: "23.5" },
    humidity: { time: "1784545104", unit: "%", value: "44" },
  },
  outdoor: {
    temperature: { time: "1784545104", unit: "℃", value: "20.5" },
  },
};

test("flattenDisplayFields resolves dot-paths and formats value+unit with a comma decimal", () => {
  const fieldDefs = [{ label: "Indoor Temperature", valuePath: "indoor.temperature.value", unitPath: "indoor.temperature.unit" }];
  assert.deepEqual(flattenDisplayFields(fieldDefs, ECOWITT_META), [{ label: "Indoor Temperature", display: "23,5 ℃" }]);
});

test("flattenDisplayFields works without a unitPath -- no trailing unit", () => {
  const fieldDefs = [{ label: "Indoor Humidity Value Only", valuePath: "indoor.humidity.value" }];
  assert.deepEqual(flattenDisplayFields(fieldDefs, ECOWITT_META), [{ label: "Indoor Humidity Value Only", display: "44,0" }]);
});

test("flattenDisplayFields skips a field whose path doesn't resolve, keeps the rest", () => {
  const fieldDefs = [
    { label: "Pressure (not in this reading)", valuePath: "pressure.absolute.value" },
    { label: "Outdoor Temperature", valuePath: "outdoor.temperature.value", unitPath: "outdoor.temperature.unit" },
  ];
  assert.deepEqual(flattenDisplayFields(fieldDefs, ECOWITT_META), [{ label: "Outdoor Temperature", display: "20,5 ℃" }]);
});

test("flattenDisplayFields returns an empty array for missing meta or missing fieldDefs", () => {
  assert.deepEqual(flattenDisplayFields([{ label: "x", valuePath: "a" }], undefined), []);
  assert.deepEqual(flattenDisplayFields(undefined, ECOWITT_META), []);
});

test("loadDisplayFields reads and parses a real file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  const path = join(dir, "display-fields.toml");
  try {
    await writeFile(
      path,
      '[[displayFields.ecowitt]]\nlabel = "Indoor Temperature"\nvaluePath = "indoor.temperature.value"\nunitPath = "indoor.temperature.unit"\n',
    );
    const displayFields = await loadDisplayFields(path);
    assert.deepEqual(displayFields.ecowitt, [
      { label: "Indoor Temperature", valuePath: "indoor.temperature.value", unitPath: "indoor.temperature.unit" },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadDisplayFields returns {} when the file doesn't exist, same graceful-degradation shape as readPlaylist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  try {
    const displayFields = await loadDisplayFields(join(dir, "nonexistent.toml"));
    assert.deepEqual(displayFields, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
