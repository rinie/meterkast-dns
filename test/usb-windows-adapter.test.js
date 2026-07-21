import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  listWindowsUsbDevices,
  parsePnpDevices,
  unclaimedWindowsUsbDevices,
} from "../src/adapters/usb-windows-adapter.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

async function loadFixture() {
  return JSON.parse(await readFile(join(FIXTURES_DIR, "pnp-usb-devices.json"), "utf8"));
}

test("parsePnpDevices dedupes multiple interface/composite entries down to one per physical VID:PID device", async () => {
  const pnpDevices = await loadFixture();

  const devices = parsePnpDevices(pnpDevices);

  assert.deepEqual(devices, [
    { address: "046d:c534", friendlyName: "USB Input Device", status: "OK" },
    { address: "1bcf:2ba5", friendlyName: "APP Mode", status: "OK" },
    { address: "8087:0033", friendlyName: "Intel(R) Wireless Bluetooth(R)", status: "OK" },
  ]);
});

test("parsePnpDevices skips an entry with no VID/PID in its InstanceId", () => {
  const devices = parsePnpDevices([{ InstanceId: "HID\\SOMETHING\\1", FriendlyName: "not usb", Status: "OK" }]);
  assert.deepEqual(devices, []);
});

test("unclaimedWindowsUsbDevices excludes already-claimed addresses, suggests a slugified name from FriendlyName", async () => {
  const pnpDevices = await loadFixture();
  const configuredRecords = {
    "logitech-receiver": { transport: "usb", address: "046d:c534" },
    "kitchen-lamp": { transport: "dirigera", address: "dev-1" },
  };

  const candidates = unclaimedWindowsUsbDevices(pnpDevices, configuredRecords);

  assert.deepEqual(candidates, [
    {
      transport: "usb",
      address: "1bcf:2ba5",
      suggestedName: "app-mode",
      meta: { friendlyName: "APP Mode", status: "OK" },
    },
    {
      transport: "usb",
      address: "8087:0033",
      suggestedName: "intel-r-wireless-bluetooth-r",
      meta: { friendlyName: "Intel(R) Wireless Bluetooth(R)", status: "OK" },
    },
  ]);
});

test("unclaimedWindowsUsbDevices falls back to the address itself when FriendlyName is missing", () => {
  const candidates = unclaimedWindowsUsbDevices([{ InstanceId: "USB\\VID_1A86&PID_7523\\1", Status: "OK" }], {});
  assert.equal(candidates[0].suggestedName, "usb-1a86-7523");
});

// Real process spawn against the real powershell.exe on this machine,
// not a mocked exec -- same "real local infrastructure over mocks"
// standard the rest of this project holds to (the self-signed HTTPS
// servers, the real local DNS responder, ...). Only meaningful on
// Windows, which is what this project actually runs on; skipped
// elsewhere rather than failing for an environment this feature was
// never meant to support.
test("listWindowsUsbDevices shells out to the real Get-PnpDevice and returns real, currently-plugged-in devices", { skip: process.platform !== "win32" }, async () => {
  const pnpDevices = await listWindowsUsbDevices();
  assert.ok(Array.isArray(pnpDevices));
  assert.ok(pnpDevices.length > 0, "expected at least one real USB device on this machine");
  for (const device of pnpDevices) {
    assert.ok(typeof device.InstanceId === "string" && device.InstanceId.startsWith("USB\\VID_"));
  }
});

test("listWindowsUsbDevices normalizes a single-object result (PowerShell's own ConvertTo-Json quirk) into a one-element array", async () => {
  const exec = async () => ({ stdout: JSON.stringify({ InstanceId: "USB\\VID_1A86&PID_7523\\1", FriendlyName: "solo", Status: "OK" }) });
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "win32" });
  try {
    const devices = await listWindowsUsbDevices({ exec });
    assert.equal(devices.length, 1);
    assert.equal(devices[0].FriendlyName, "solo");
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  }
});

test("listWindowsUsbDevices rejects on a non-Windows platform with a clear message", async () => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "linux" });
  try {
    await assert.rejects(() => listWindowsUsbDevices({ exec: async () => ({ stdout: "[]" }) }), /Windows-only/);
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  }
});
