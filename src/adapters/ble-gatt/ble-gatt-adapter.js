import { groupReadingsByAddress } from "./group-readings-by-address.js";
import { normalizeAddress } from "./normalize-address.js";
import { readDeviceReadings } from "./read-device-readings.js";
import { createAsyncQueue } from "./create-async-queue.js";

// UNVERIFIED AGAINST REAL HARDWARE. Everything this file calls into
// (readDeviceReadings, the decoders, the resolvers) is real and tested;
// this file's own job -- driving @abandonware/noble's scan/discover events
// -- has not been exercised against an actual BLE radio in this
// environment, and @abandonware/noble is an optionalDependency precisely
// so its absence (or a failed native build) never breaks `npm install` or
// `npm test` for anyone without BLE hardware. Treat this the way
// static-adapter.js documents every other real adapter: a real attempt,
// not a verified one. See IMPLEMENTATION.md "What's actually implemented
// here".
//
// `records` is the flat {name: {transport, address, service,
// characteristic}} slice of the registry -- see flatten-device-readings.js
// for how a nested [devices.*] playlist section becomes this shape.
export default async function* bleGattAdapter(records) {
  const { default: noble } = await import("@abandonware/noble");
  const queue = createAsyncQueue();
  const byAddress = groupReadingsByAddress(records);
  const targets = new Map([...byAddress.keys()].map((address) => [normalizeAddress(address), address]));

  await new Promise((resolve) => {
    if (noble.state === "poweredOn") {
      resolve();
      return;
    }
    noble.once("stateChange", (state) => {
      if (state === "poweredOn") resolve();
    });
  });

  noble.on("discover", (peripheral) => {
    const address = targets.get(normalizeAddress(peripheral.address));
    if (!address) return;
    readDeviceReadings(peripheral, byAddress.get(address))
      .then((readings) => readings.forEach((reading) => queue.push(reading)))
      .catch((error) => queue.push({ error }));
  });

  noble.startScanning([], true);

  while (true) {
    const item = await queue.next();
    if (item.error) throw item.error;
    yield item;
  }
}
