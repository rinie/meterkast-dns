import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveServiceUuid } from "../src/adapters/ble-gatt/resolve-service-uuid.js";
import { resolveCharacteristicUuid } from "../src/adapters/ble-gatt/resolve-characteristic-uuid.js";
import { decodeTemperatureMeasurement } from "../src/adapters/ble-gatt/decode-temperature-measurement.js";
import { decodeWeightMeasurement } from "../src/adapters/ble-gatt/decode-weight-measurement.js";
import { decodeBatteryLevel } from "../src/adapters/ble-gatt/decode-battery-level.js";
import { decodeCharacteristic } from "../src/adapters/ble-gatt/decode-characteristic.js";
import { normalizeAddress } from "../src/adapters/ble-gatt/normalize-address.js";
import { groupReadingsByAddress } from "../src/adapters/ble-gatt/group-readings-by-address.js";
import { createAsyncQueue } from "../src/adapters/ble-gatt/create-async-queue.js";
import { readDeviceReadings } from "../src/adapters/ble-gatt/read-device-readings.js";
import { flattenDeviceReadings } from "../src/core/playlist/flatten-device-readings.js";

test("resolveServiceUuid maps known semantic names to SIG UUIDs", () => {
  assert.equal(resolveServiceUuid("health-thermometer"), "1809");
  assert.equal(resolveServiceUuid("weight-scale"), "181d");
});

test("resolveServiceUuid passes through unknown/proprietary values unchanged", () => {
  const proprietary = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  assert.equal(resolveServiceUuid(proprietary), proprietary);
});

test("resolveCharacteristicUuid maps known semantic names to SIG UUIDs", () => {
  assert.equal(resolveCharacteristicUuid("temperature-measurement"), "2a1c");
  assert.equal(resolveCharacteristicUuid("battery-level"), "2a19");
});

test("decodeTemperatureMeasurement decodes a Celsius IEEE-11073 FLOAT value (36.5 C)", () => {
  // mantissa=365, exponent=-1 -> 365 * 10^-1 = 36.5; flags=0x00 (Celsius)
  const buffer = Buffer.from([0x00, 0x6d, 0x01, 0x00, 0xff]);
  assert.deepEqual(decodeTemperatureMeasurement(buffer), { value: 36.5, unit: "celsius" });
});

test("decodeTemperatureMeasurement reports Fahrenheit from the units flag", () => {
  const buffer = Buffer.from([0x01, 0x6d, 0x01, 0x00, 0xff]);
  assert.equal(decodeTemperatureMeasurement(buffer).unit, "fahrenheit");
});

test("decodeWeightMeasurement decodes SI (kg) weight (72.5 kg)", () => {
  // raw=14500, *0.005 = 72.5; flags=0x00 (SI)
  const buffer = Buffer.from([0x00, 0xa4, 0x38]);
  assert.deepEqual(decodeWeightMeasurement(buffer), { value: 72.5, unit: "kg" });
});

test("decodeWeightMeasurement decodes Imperial (lb) weight", () => {
  // same raw=14500, *0.01 = 145; flags bit0=1 -> lb
  const buffer = Buffer.from([0x01, 0xa4, 0x38]);
  assert.deepEqual(decodeWeightMeasurement(buffer), { value: 145, unit: "lb" });
});

test("decodeBatteryLevel decodes a percentage", () => {
  assert.deepEqual(decodeBatteryLevel(Buffer.from([87])), { value: 87, unit: "%" });
});

test("decodeCharacteristic dispatches by semantic characteristic name", () => {
  assert.deepEqual(decodeCharacteristic("battery-level", Buffer.from([50])), {
    value: 50,
    unit: "%",
  });
});

test("decodeCharacteristic returns the raw buffer for an unknown characteristic", () => {
  const raw = Buffer.from([1, 2, 3]);
  assert.equal(decodeCharacteristic("some-proprietary-uuid", raw), raw);
});

test("normalizeAddress lowercases and strips colons", () => {
  assert.equal(normalizeAddress("AA:BB:CC:DD:EE:FF"), "aabbccddeeff");
});

test("groupReadingsByAddress groups bluetooth records by address, ignoring other transports", () => {
  const records = {
    "kitchen-thermometer-temperature": {
      transport: "bluetooth",
      address: "AA:BB:CC:DD:EE:FF",
      service: "health-thermometer",
      characteristic: "temperature-measurement",
    },
    "kitchen-thermometer-battery": {
      transport: "bluetooth",
      address: "AA:BB:CC:DD:EE:FF",
      service: "battery-service",
      characteristic: "battery-level",
    },
    myHpPrinter: { transport: "mdns", address: "printer.local" },
  };
  const grouped = groupReadingsByAddress(records);
  assert.equal(grouped.size, 1);
  assert.equal(grouped.get("AA:BB:CC:DD:EE:FF").length, 2);
});

test("createAsyncQueue delivers pushed items in order, waiting when empty", async () => {
  const queue = createAsyncQueue();
  const pending = queue.next();
  queue.push("a");
  assert.equal(await pending, "a");

  queue.push("b");
  queue.push("c");
  assert.equal(await queue.next(), "b");
  assert.equal(await queue.next(), "c");
});

test("flattenDeviceReadings turns nested devices+readings into flat records", () => {
  const devices = {
    "kitchen-thermometer": {
      transport: "bluetooth",
      address: "AA:BB:CC:DD:EE:FF",
      readings: {
        temperature: { service: "health-thermometer", characteristic: "temperature-measurement" },
        battery: { service: "battery-service", characteristic: "battery-level" },
      },
    },
  };
  const flat = flattenDeviceReadings(devices);
  assert.deepEqual(flat["kitchen-thermometer-temperature"], {
    transport: "bluetooth",
    address: "AA:BB:CC:DD:EE:FF",
    service: "health-thermometer",
    characteristic: "temperature-measurement",
  });
  assert.deepEqual(flat["kitchen-thermometer-battery"], {
    transport: "bluetooth",
    address: "AA:BB:CC:DD:EE:FF",
    service: "battery-service",
    characteristic: "battery-level",
  });
});

test("flattenDeviceReadings returns an empty object for an empty/missing devices section", () => {
  assert.deepEqual(flattenDeviceReadings(), {});
  assert.deepEqual(flattenDeviceReadings({}), {});
});

// readDeviceReadings against a fake peripheral matching noble's documented
// async API (connectAsync / discoverSomeServicesAndCharacteristicsAsync /
// disconnectAsync, characteristic.readAsync). This verifies the real
// orchestration logic -- connect once, read+decode each reading, always
// disconnect -- without needing actual BLE hardware.
function fakePeripheral(characteristicsByUuid) {
  const calls = [];
  return {
    calls,
    connectAsync: async () => {
      calls.push("connect");
    },
    disconnectAsync: async () => {
      calls.push("disconnect");
    },
    discoverSomeServicesAndCharacteristicsAsync: async (serviceUuids, characteristicUuids) => {
      calls.push(["discover", serviceUuids, characteristicUuids]);
      const characteristics = characteristicUuids
        .map((uuid) => characteristicsByUuid[uuid])
        .filter(Boolean);
      return { characteristics };
    },
  };
}

test("readDeviceReadings connects once, reads and decodes each reading, then disconnects", async () => {
  const peripheral = fakePeripheral({
    "2a19": { readAsync: async () => Buffer.from([87]) }, // battery-level, 87%
    "2a1c": { readAsync: async () => Buffer.from([0x00, 0x6d, 0x01, 0x00, 0xff]) }, // 36.5 C
  });
  const readings = [
    {
      name: "kitchen-thermometer-battery",
      transport: "bluetooth",
      address: "AA:BB:CC:DD:EE:FF",
      service: "battery-service",
      characteristic: "battery-level",
    },
    {
      name: "kitchen-thermometer-temperature",
      transport: "bluetooth",
      address: "AA:BB:CC:DD:EE:FF",
      service: "health-thermometer",
      characteristic: "temperature-measurement",
    },
  ];

  const results = await readDeviceReadings(peripheral, readings);

  assert.deepEqual(results, [
    {
      name: "kitchen-thermometer-battery",
      transport: "bluetooth",
      address: "AA:BB:CC:DD:EE:FF",
      meta: { value: 87, unit: "%" },
    },
    {
      name: "kitchen-thermometer-temperature",
      transport: "bluetooth",
      address: "AA:BB:CC:DD:EE:FF",
      meta: { value: 36.5, unit: "celsius" },
    },
  ]);
  assert.equal(peripheral.calls[0], "connect");
  assert.equal(peripheral.calls.at(-1), "disconnect");
});

test("readDeviceReadings still disconnects if a read fails partway through", async () => {
  const peripheral = fakePeripheral({
    "2a19": {
      readAsync: async () => {
        throw new Error("simulated read failure");
      },
    },
  });
  const readings = [
    {
      name: "kitchen-thermometer-battery",
      transport: "bluetooth",
      address: "AA:BB:CC:DD:EE:FF",
      service: "battery-service",
      characteristic: "battery-level",
    },
  ];

  await assert.rejects(() => readDeviceReadings(peripheral, readings), /simulated read failure/);
  assert.equal(peripheral.calls.at(-1), "disconnect");
});

test("readDeviceReadings skips a reading whose characteristic isn't found", async () => {
  const peripheral = fakePeripheral({}); // nothing discoverable
  const readings = [
    {
      name: "kitchen-thermometer-battery",
      transport: "bluetooth",
      address: "AA:BB:CC:DD:EE:FF",
      service: "battery-service",
      characteristic: "battery-level",
    },
  ];

  assert.deepEqual(await readDeviceReadings(peripheral, readings), []);
});
