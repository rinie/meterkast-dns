// The adapter contract: a default export that is an async generator function
// yielding {name, transport, address, meta?} records. Real adapters (BLE via
// BlueZ, USB via udev, Zigbee via a coordinator, MQTT via mDNS, 433MHz/IR via
// a decoder) keep scanning and `yield` again whenever a device is seen or its
// address changes. This one is a stand-in for tests and local experimentation:
// it yields a fixed list once and stops, with no hardware or native deps.
export default async function* staticAdapter(records = []) {
  for (const record of records) {
    yield record;
  }
}
