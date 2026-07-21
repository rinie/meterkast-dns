// Windows-native Bluetooth discovery, no native Node addon, no
// compilation step -- two real, complementary sources, not one:
// already-paired/bonded devices (Get-PnpDevice, the same shell-out
// pattern as usb-windows-adapter.js, fast -- a couple seconds) and
// nearby *unpaired* devices (a WinRT one-shot async enumeration, a real
// ~30 second discovery window Windows itself runs, not something this
// code controls the duration of). Both give a real MAC address, unlike
// web-scan.html's WebBluetooth-based "Scan for a device": Web Bluetooth
// deliberately never exposes a device's true BD_ADDR to page JS, so
// that flow's device.id is only ever an opaque, origin-scoped
// identifier. This is the first Bluetooth discovery path in this
// project that produces a real Gutenberg MAC address.
//
// The live-scan API a bounded active scan would naturally use
// (BluetoothLEAdvertisementWatcher's own Received event) was tried
// first and ruled out for a real, confirmed reason, not a guess:
// Register-ObjectEvent cannot subscribe to WinRT events at all in
// Windows PowerShell 5.1 -- "Windows PowerShell cannot subscribe to
// Windows RT events" is the exact, unambiguous error this project's own
// machine returns. DeviceInformation.FindAllAsync (a one-shot async
// *operation*, not a continuous event stream) works instead, bridged
// onto a real .NET Task via reflection onto
// WindowsRuntimeSystemExtensions.AsTask<T> -- confirmed by running each
// piece for real against this machine before relying on any of it (see
// IMPLEMENTATION.md), including the real, repeatable ~30 second
// duration and a specific pitfall (the wrong AsTask overload -- the
// non-generic IAsyncAction one -- gets picked unless the search is
// narrowed to IsGenericMethodDefinition with a parameter type name
// starting "IAsyncOperation").
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function macFromHex12(hex12) {
  return hex12.match(/.{1,2}/g).join(":").toUpperCase();
}

// ConvertTo-Json emits a bare object (not a one-element array) when the
// piped collection has exactly one item -- the same real PowerShell
// quirk usb-windows-adapter.js already normalizes for.
function normalizeToArray(parsed) {
  if (parsed === undefined || parsed === null) return [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function claimedBluetoothAddresses(configuredRecords) {
  return new Set(
    Object.values(configuredRecords)
      .filter((record) => record.transport === "bluetooth")
      .map((record) => record.address),
  );
}

// Shared candidate shape both sources below produce -- same fields every
// other transport's unclaimed-candidate function already returns.
// `status` is PnP-specific (paired devices only); a nearby device's
// `meta` simply omits it (JSON.stringify drops an undefined value), not
// a special case either source has to handle.
function toCandidate(device) {
  return {
    transport: "bluetooth",
    address: device.address,
    suggestedName: device.friendlyName ? slugify(device.friendlyName) : `bluetooth-${device.address.replace(/:/g, "")}`,
    meta: { friendlyName: device.friendlyName, status: device.status },
  };
}

// ---- Paired / bonded devices -- fast, Get-PnpDevice ----

// BTHENUM\DEV_<mac> is the parent entry for a real physical paired
// device -- confirmed against this machine's real output: the same
// physical speaker/headset also shows up as several BTHENUM\{<service-uuid>}_...
// child entries too (one per Bluetooth service/profile, the same
// one-entry-per-function shape usb-windows-adapter.js's own composite
// devices have), but those are excluded by prefix alone since this
// query only ever asks for DEV_*. Real output on this machine never
// showed more than one DEV_<mac> entry per physical device, but
// parsePairedBluetoothDevices still dedupes defensively (same Map-by-address
// shape USB's own parsePnpDevices uses) rather than assuming that holds
// on every Windows Bluetooth stack version.
const LIST_PAIRED_BLUETOOTH_SCRIPT =
  "Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'BTHENUM\\DEV_*' } | Select-Object InstanceId, FriendlyName, Status | ConvertTo-Json";

export async function listWindowsPairedBluetoothDevices({ exec = execFileAsync } = {}) {
  if (process.platform !== "win32") {
    throw new Error("Paired Bluetooth device listing via Get-PnpDevice is Windows-only");
  }
  const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", LIST_PAIRED_BLUETOOTH_SCRIPT], {
    timeout: 15000,
  });
  return normalizeToArray(stdout.trim() ? JSON.parse(stdout) : []);
}

function parsePairedMac(instanceId) {
  const match = instanceId.match(/BTHENUM\\DEV_([0-9A-F]{12})/i);
  return match ? macFromHex12(match[1]) : null;
}

export function parsePairedBluetoothDevices(pnpDevices) {
  const byAddress = new Map();
  for (const device of pnpDevices) {
    const address = parsePairedMac(device.InstanceId);
    if (!address || byAddress.has(address)) continue;
    byAddress.set(address, { address, friendlyName: device.FriendlyName, status: device.Status });
  }
  return [...byAddress.values()];
}

export function unclaimedPairedBluetoothDevices(pnpDevices, configuredRecords) {
  const claimed = claimedBluetoothAddresses(configuredRecords);
  return parsePairedBluetoothDevices(pnpDevices)
    .filter((device) => !claimed.has(device.address))
    .map(toCandidate);
}

// ---- Nearby unpaired devices -- a real ~30s scan, WinRT ----

// Written as one big -Command string, same shell-out shape as every
// other script in this file -- just longer. GetDeviceSelectorFromPairingState(false)
// asks specifically for devices NOT already paired, so this never
// overlaps with the paired listing above -- two clean, non-duplicating
// sources, not one source split awkwardly in two.
const LIST_NEARBY_BLUETOOTH_SCRIPT = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
function Await-Op($op, [type]$resultType) {
  $m = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and
    $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*'
  } | Select-Object -First 1).MakeGenericMethod($resultType)
  $task = $m.Invoke($null, @($op))
  if (-not $task.Wait(35000)) { throw "BLE scan timed out after 35s" }
  return $task.Result
}
[Windows.Devices.Enumeration.DeviceInformation,Windows.Devices.Enumeration,ContentType=WindowsRuntime] | Out-Null
[Windows.Devices.Bluetooth.BluetoothLEDevice,Windows.Devices.Bluetooth,ContentType=WindowsRuntime] | Out-Null
$selector = [Windows.Devices.Bluetooth.BluetoothLEDevice]::GetDeviceSelectorFromPairingState($false)
$op = [Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($selector)
$result = Await-Op $op ([Windows.Devices.Enumeration.DeviceInformationCollection])
$result | ForEach-Object { [PSCustomObject]@{ Id = $_.Id; Name = $_.Name } } | ConvertTo-Json
`.trim();

// `timeout: 45000` on the Node side is defense-in-depth above the
// script's own internal 35s .Wait() bound -- two independent layers, so
// neither a hung child process nor a hung .NET Task can block an HTTP
// request indefinitely (the same class of failure the earlier
// window.prompt() bug caused in the browser, avoided here on the
// backend before it could ever ship). `error.killed` is checked
// explicitly so a real timeout reads as "scan timed out," not the
// default, uninformative "Command failed" execFile produces on its own.
export async function listWindowsNearbyBluetoothDevices({ exec = execFileAsync } = {}) {
  if (process.platform !== "win32") {
    throw new Error("Nearby Bluetooth device scanning is Windows-only");
  }
  let stdout;
  try {
    ({ stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", LIST_NEARBY_BLUETOOTH_SCRIPT], {
      timeout: 45000,
    }));
  } catch (error) {
    if (error.killed) throw new Error("Bluetooth nearby-device scan timed out");
    throw error;
  }
  return normalizeToArray(stdout.trim() ? JSON.parse(stdout) : []);
}

// A nearby device's Id looks like
// "BluetoothLE#BluetoothLE<local-adapter-mac>-<remote-device-mac>" --
// confirmed against this machine's real output; the remote device's own
// MAC is the part after the dash.
function parseNearbyMac(id) {
  const match = id?.match(/-([0-9a-f]{2}(?::[0-9a-f]{2}){5})$/i);
  return match ? match[1].toUpperCase() : null;
}

export function parseNearbyBluetoothDevices(rawDevices) {
  const byAddress = new Map();
  for (const device of rawDevices) {
    const address = parseNearbyMac(device.Id);
    if (!address || byAddress.has(address)) continue;
    // A blank Name is common and real (confirmed live: most nearby
    // devices don't advertise one) -- normalized to undefined so
    // toCandidate's own `device.friendlyName ? ... : ...` fallback
    // triggers correctly instead of slugifying an empty string into "".
    byAddress.set(address, { address, friendlyName: device.Name || undefined, status: undefined });
  }
  return [...byAddress.values()];
}

export function unclaimedNearbyBluetoothDevices(rawDevices, configuredRecords) {
  const claimed = claimedBluetoothAddresses(configuredRecords);
  return parseNearbyBluetoothDevices(rawDevices)
    .filter((device) => !claimed.has(device.address))
    .map(toCandidate);
}
