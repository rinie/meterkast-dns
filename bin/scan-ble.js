#!/usr/bin/env node
// Standalone smoke test -- run this directly to verify @abandonware/noble
// can actually see nearby devices on your hardware, before worrying about
// the full daemon or a specific device's GATT services. Isolates "does
// noble see anything at all" from "does my playlist entry decode
// correctly", which is the more useful first checkpoint. See
// IMPLEMENTATION.md "Running it" for platform prerequisites (Windows/
// Linux/macOS) -- the native build needs a C++ toolchain and, on Linux,
// BlueZ headers plus a capability grant to scan without root.
const { default: noble } = await import("@abandonware/noble");

noble.on("stateChange", (state) => {
  console.log("adapter state:", state);
  if (state === "poweredOn") noble.startScanning([], true);
  else noble.stopScanning();
});

noble.on("discover", (peripheral) => {
  console.log(
    peripheral.address,
    peripheral.advertisement.localName ?? "(no name)",
    "rssi:",
    peripheral.rssi,
  );
});

const scanSeconds = Number(process.env.SCAN_SECONDS ?? 15);
console.log(`Scanning for ${scanSeconds}s...`);
setTimeout(() => process.exit(0), scanSeconds * 1000);
