import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSecretEnv } from "../src/core/secrets/resolve-secret-env.js";

test("resolveSecretEnv returns the value of a set environment variable", () => {
  process.env.METERKAST_TEST_SECRET = "hunter2";
  try {
    assert.equal(resolveSecretEnv("METERKAST_TEST_SECRET"), "hunter2");
  } finally {
    delete process.env.METERKAST_TEST_SECRET;
  }
});

test("resolveSecretEnv throws a clear error when the variable is unset", () => {
  delete process.env.METERKAST_TEST_SECRET_UNSET;
  assert.throws(
    () => resolveSecretEnv("METERKAST_TEST_SECRET_UNSET"),
    /Missing required environment variable: METERKAST_TEST_SECRET_UNSET/,
  );
});
