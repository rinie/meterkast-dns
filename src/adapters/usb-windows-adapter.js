// Windows-native USB device listing -- an lsusb-equivalent without any
// native Node addon (no node-gyp, no C++ build toolchain needed). This
// project's own dev machine has no build toolchain installed (see
// IMPLEMENTATION.md/memory notes on deferring native-addon work like
// `noble` to a second machine that does), so a package like `usb`
// (libusb bindings) is a real, avoidable cost here -- Windows already
// exposes this information through Get-PnpDevice, which this shells out
// to instead. Not a background poller like the other adapters in this
// directory: this only ever runs as an on-demand discovery scan (see
// bin/meterkastd.js's `discover.usb`), the same "hit it when asked, not
// every interval" shape Dirigera/Smartbridge/DNS discovery already use.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// -like 'USB\VID_*' rather than a regex -match, specifically to avoid
// PowerShell's own backslash-escaping rules inside a -Command string --
// backslash isn't a wildcard special character, so no escaping at all is
// needed here. Get-PnpDevice -PresentOnly (not -Class USB) deliberately:
// -Class USB only returns hub/generic-USB-class entries, missing every
// device Windows bound to a more specific class driver (HIDClass,
// Mouse, Keyboard, Camera, Bluetooth, ...) despite still being a real
// USB device -- filtering by InstanceId prefix instead catches all of
// them, the same devices `lsusb` would show regardless of which driver
// claimed them.
const LIST_PNP_USB_DEVICES_SCRIPT =
  "Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'USB\\VID_*' } | Select-Object InstanceId, FriendlyName, Status | ConvertTo-Json";

// ConvertTo-Json emits a bare object (not a one-element array) when the
// piped collection has exactly one item -- a real PowerShell quirk, not
// something to special-case at the call site; normalized here once so
// every caller always gets an array, 0 devices included.
function normalizeToArray(parsed) {
  if (parsed === undefined || parsed === null) return [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

// `exec` is injectable (execFileAsync against the real powershell.exe by
// default) so tests can supply a fake that returns real captured JSON
// instead of depending on whatever's physically plugged into the machine
// running the tests -- same dependency-injection shape as this project's
// other adapters (`fetchDevices`, `resolver`, ...).
export async function listWindowsUsbDevices({ exec = execFileAsync } = {}) {
  if (process.platform !== "win32") {
    throw new Error("USB device listing via Get-PnpDevice is Windows-only");
  }
  const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", LIST_PNP_USB_DEVICES_SCRIPT]);
  return normalizeToArray(stdout.trim() ? JSON.parse(stdout) : []);
}

function parseVidPid(instanceId) {
  const match = instanceId.match(/VID_([0-9A-F]{4})&PID_([0-9A-F]{4})/i);
  if (!match) return null;
  return `${match[1].toLowerCase()}:${match[2].toLowerCase()}`;
}

// One physical USB device shows up as several separate PnP entries --
// once per interface/function, plus its own composite-device parent
// entry -- confirmed against this project's own real machine: a single
// USB receiver produced 3 raw entries ("USB Input Device" x2 +
// "USB Composite Device"), all sharing one VID:PID. Real lsusb shows one
// line per physical device, not one per interface, so entries are
// deduped here the same way -- grouped by the "vvvv:pppp" address (the
// same convention WebUSB already uses in this project's own playlist
// entries), first FriendlyName seen per group kept.
export function parsePnpDevices(pnpDevices) {
  const byAddress = new Map();
  for (const device of pnpDevices) {
    const address = parseVidPid(device.InstanceId);
    if (!address || byAddress.has(address)) continue;
    byAddress.set(address, { address, friendlyName: device.FriendlyName, status: device.Status });
  }
  return [...byAddress.values()];
}

// The inverse of the other adapters' matchConfiguredDevices: every real,
// deduped USB device not already claimed by a `transport: "usb"` playlist
// entry. `suggestedName` comes from the device's own FriendlyName where
// Windows reports one, else falls back to the address itself -- only
// ever a starting point, same as every other transport's unclaimed
// candidates.
//
// Honest limit, stated here rather than left implicit: this lists every
// USB device Windows currently sees, the same real inventory `lsusb`
// shows on Linux -- mice, hubs, printers, everything -- not only the
// subset WebUSB could ever actually talk to. Many of these are claimed
// by their own Windows class driver (HID, storage, printer, ...) and
// WebUSB categorically cannot open them regardless of how the playlist
// entry is configured afterward; this function's only job is telling you
// a device with this VID:PID exists and is currently plugged in.
export function unclaimedWindowsUsbDevices(pnpDevices, configuredRecords) {
  const claimedAddresses = new Set(
    Object.values(configuredRecords)
      .filter((record) => record.transport === "usb")
      .map((record) => record.address),
  );
  return parsePnpDevices(pnpDevices)
    .filter((device) => !claimedAddresses.has(device.address))
    .map((device) => ({
      transport: "usb",
      address: device.address,
      suggestedName: device.friendlyName ? slugify(device.friendlyName) : `usb-${device.address.replace(":", "-")}`,
      meta: { friendlyName: device.friendlyName, status: device.status },
    }));
}
