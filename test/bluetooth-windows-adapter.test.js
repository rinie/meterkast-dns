import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  listWindowsPairedBluetoothDevices,
  parsePairedBluetoothDevices,
  unclaimedPairedBluetoothDevices,
  listWindowsNearbyBluetoothDevices,
  parseNearbyBluetoothDevices,
  unclaimedNearbyBluetoothDevices,
} from "../src/adapters/bluetooth-windows-adapter.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

async function loadPairedFixture() {
  return JSON.parse(await readFile(join(FIXTURES_DIR, "pnp-bluetooth-paired-devices.json"), "utf8"));
}

async function loadNearbyFixture() {
  return JSON.parse(await readFile(join(FIXTURES_DIR, "nearby-bluetooth-devices.json"), "utf8"));
}

function withPlatform(platform, run) {
  const original = process.platform;
  Object.defineProperty(process, "platform", { value: platform });
  return Promise.resolve()
    .then(run)
    .finally(() => Object.defineProperty(process, "platform", { value: original }));
}

test("parsePairedBluetoothDevices extracts a real MAC from BTHENUM\\DEV_<mac> InstanceIds", async () => {
  const pnpDevices = await loadPairedFixture();

  const devices = parsePairedBluetoothDevices(pnpDevices);

  assert.deepEqual(devices, [
    { address: "54:15:89:9A:7D:66", friendlyName: "JBL PartyBox Encore", status: "OK" },
    { address: "99:42:BF:73:D3:17", friendlyName: "RCS Soundboom", status: "OK" },
  ]);
});

test("parsePairedBluetoothDevices dedupes defensively even though real output never showed a duplicate", () => {
  const duplicated = [
    { InstanceId: "BTHENUM\\DEV_5415899A7D66\\1", FriendlyName: "JBL PartyBox Encore", Status: "OK" },
    { InstanceId: "BTHENUM\\DEV_5415899A7D66\\2", FriendlyName: "JBL PartyBox Encore", Status: "OK" },
  ];
  assert.equal(parsePairedBluetoothDevices(duplicated).length, 1);
});

test("unclaimedPairedBluetoothDevices excludes an already-claimed address, suggests a slugified name", async () => {
  const pnpDevices = await loadPairedFixture();
  const configuredRecords = {
    "party-speaker": { transport: "bluetooth", address: "54:15:89:9A:7D:66" },
    "kitchen-lamp": { transport: "dirigera", address: "dev-1" },
  };

  const candidates = unclaimedPairedBluetoothDevices(pnpDevices, configuredRecords);

  assert.deepEqual(candidates, [
    {
      transport: "bluetooth",
      address: "99:42:BF:73:D3:17",
      suggestedName: "rcs-soundboom",
      meta: { friendlyName: "RCS Soundboom", status: "OK" },
    },
  ]);
});

test("listWindowsPairedBluetoothDevices rejects on a non-Windows platform with a clear message", () =>
  withPlatform("linux", () =>
    assert.rejects(() => listWindowsPairedBluetoothDevices({ exec: async () => ({ stdout: "[]" }) }), /Windows-only/),
  ));

test("listWindowsPairedBluetoothDevices normalizes a single-object result into a one-element array", () =>
  withPlatform("win32", async () => {
    const exec = async () => ({ stdout: JSON.stringify({ InstanceId: "BTHENUM\\DEV_AABBCCDDEEFF\\1", FriendlyName: "solo", Status: "OK" }) });
    const devices = await listWindowsPairedBluetoothDevices({ exec });
    assert.equal(devices.length, 1);
    assert.equal(devices[0].FriendlyName, "solo");
  }));

test("parseNearbyBluetoothDevices extracts the remote device's own MAC from the trailing part of Id, past names blank correctly", async () => {
  const rawDevices = await loadNearbyFixture();

  const devices = parseNearbyBluetoothDevices(rawDevices);

  assert.deepEqual(devices, [
    { address: "16:CB:19:37:77:7F", friendlyName: undefined, status: undefined },
    { address: "D2:AD:08:F3:F7:AE", friendlyName: "Smart Tank 7300 series", status: undefined },
    { address: "34:55:E5:57:1E:52", friendlyName: "Oven", status: undefined },
    { address: "64:8C:33:DB:E9:CC", friendlyName: undefined, status: undefined },
    { address: "A4:C1:38:70:D9:33", friendlyName: "ATC_70D933", status: undefined },
    { address: "B4:E3:F9:55:0F:57", friendlyName: "Hue bulb", status: undefined },
  ]);
});

test("unclaimedNearbyBluetoothDevices excludes an already-claimed address, falls back to an address-based name when blank", async () => {
  const rawDevices = await loadNearbyFixture();
  const configuredRecords = {
    oven: { transport: "bluetooth", address: "34:55:E5:57:1E:52" },
  };

  const candidates = unclaimedNearbyBluetoothDevices(rawDevices, configuredRecords);

  assert.equal(candidates.length, 5);
  const blankNamed = candidates.find((c) => c.address === "16:CB:19:37:77:7F");
  assert.equal(blankNamed.suggestedName, "bluetooth-16CB1937777F");
  const named = candidates.find((c) => c.address === "D2:AD:08:F3:F7:AE");
  assert.equal(named.suggestedName, "smart-tank-7300-series");
});

test("listWindowsNearbyBluetoothDevices rejects on a non-Windows platform with a clear message", () =>
  withPlatform("linux", () =>
    assert.rejects(() => listWindowsNearbyBluetoothDevices({ exec: async () => ({ stdout: "[]" }) }), /Windows-only/),
  ));

test("listWindowsNearbyBluetoothDevices reports a clear timeout error rather than execFile's generic 'Command failed'", () =>
  withPlatform("win32", () =>
    assert.rejects(
      () =>
        listWindowsNearbyBluetoothDevices({
          exec: async () => {
            throw Object.assign(new Error("Command failed"), { killed: true, signal: "SIGTERM" });
          },
        }),
      /timed out/,
    ),
  ));

// Real process spawns against the real powershell.exe on this machine,
// not mocked exec -- same "real local infrastructure over mocks"
// standard the rest of this project holds to. The paired listing is
// fast (a couple seconds) and runs in the default suite, same tier as
// usb-windows-adapter.js's own real test. The nearby scan is a genuine
// ~30 second real Windows discovery window (measured directly: 30.0-30.3s
// across repeated runs while building this) -- opt-in only
// (METERKAST_TEST_BLE_SCAN=1), not run by default, so it doesn't add a
// permanent 30-second tax to every future `npm test`. Both skipped
// outright on non-Windows, which is what this feature was never meant
// to support.
test(
  "listWindowsPairedBluetoothDevices shells out to the real Get-PnpDevice and returns real paired devices (or none)",
  { skip: process.platform !== "win32" },
  async () => {
    const devices = await listWindowsPairedBluetoothDevices();
    assert.ok(Array.isArray(devices));
    for (const device of devices) {
      assert.ok(typeof device.InstanceId === "string" && device.InstanceId.startsWith("BTHENUM\\DEV_"));
    }
  },
);

test(
  "listWindowsNearbyBluetoothDevices runs a real ~30s scan and returns real nearby devices (or none)",
  { skip: process.platform !== "win32" || process.env.METERKAST_TEST_BLE_SCAN !== "1" },
  async () => {
    const devices = await listWindowsNearbyBluetoothDevices();
    assert.ok(Array.isArray(devices));
    for (const device of devices) {
      assert.ok(typeof device.Id === "string" && device.Id.startsWith("BluetoothLE#"));
    }
  },
);
