import { test } from "node:test";
import assert from "node:assert/strict";
import { log, listLogs, subscribeLogs } from "../src/core/log.js";

test("log appends a timestamped entry and returns it", () => {
  const entry = log("info", "test message a1b2c3");
  assert.equal(entry.level, "info");
  assert.equal(entry.message, "test message a1b2c3");
  assert.equal(typeof entry.timestamp, "string");
  assert.ok(!Number.isNaN(Date.parse(entry.timestamp)));
});

test("listLogs returns entries in insertion order, most recent last", () => {
  log("info", "listLogs order test 1");
  log("warn", "listLogs order test 2");
  const logs = listLogs();
  const idx1 = logs.findIndex((e) => e.message === "listLogs order test 1");
  const idx2 = logs.findIndex((e) => e.message === "listLogs order test 2");
  assert.ok(idx1 !== -1 && idx2 !== -1 && idx1 < idx2);
});

test("listLogs returns a snapshot copy, not a live reference", () => {
  const before = listLogs();
  log("info", "listLogs snapshot test");
  assert.equal(before.some((e) => e.message === "listLogs snapshot test"), false);
});

test("subscribeLogs notifies listeners of new entries and unsubscribe stops delivery", () => {
  const received = [];
  const unsubscribe = subscribeLogs((entry) => received.push(entry));
  log("debug", "subscribeLogs test 1");
  unsubscribe();
  log("debug", "subscribeLogs test 2");

  assert.equal(received.length, 1);
  assert.equal(received[0].message, "subscribeLogs test 1");
});

test("the log buffer is bounded -- old entries drop off past the max", () => {
  // log() always echoes to the real console by design (see log.js) --
  // real behavior everywhere else it's called, but this test alone would
  // otherwise spam 600 lines into the test run's own output. Silenced
  // for just this test, restored immediately after.
  const originalConsoleLog = console.log;
  console.log = () => {};
  try {
    for (let i = 0; i < 600; i += 1) log("debug", `bounded buffer filler ${i}`);
  } finally {
    console.log = originalConsoleLog;
  }
  const logs = listLogs();
  assert.ok(logs.length <= 500);
  assert.equal(logs.some((e) => e.message === "bounded buffer filler 0"), false);
  assert.equal(logs.some((e) => e.message === "bounded buffer filler 599"), true);
});
