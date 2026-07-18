import { resolveServiceUuid } from "./resolve-service-uuid.js";
import { resolveCharacteristicUuid } from "./resolve-characteristic-uuid.js";
import { decodeCharacteristic } from "./decode-characteristic.js";

// Connects once, reads and decodes every reading on that device, then
// disconnects. Takes a noble-shaped peripheral (connectAsync,
// discoverSomeServicesAndCharacteristicsAsync, disconnectAsync) -- this is
// the orchestration logic, verified in tests against a fake peripheral
// matching that documented async API. The real @abandonware/noble import
// and its discover/scan wiring live in ble-gatt-adapter.js and have not
// been exercised against real hardware; see IMPLEMENTATION.md.
export async function readDeviceReadings(peripheral, readings) {
  await peripheral.connectAsync();
  const results = [];
  try {
    for (const reading of readings) {
      const serviceUuid = resolveServiceUuid(reading.service);
      const characteristicUuid = resolveCharacteristicUuid(reading.characteristic);
      const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
        [serviceUuid],
        [characteristicUuid],
      );
      const characteristic = characteristics[0];
      if (!characteristic) continue;
      const raw = await characteristic.readAsync();
      results.push({
        name: reading.name,
        transport: reading.transport,
        address: reading.address,
        meta: decodeCharacteristic(reading.characteristic, raw),
      });
    }
  } finally {
    await peripheral.disconnectAsync();
  }
  return results;
}
