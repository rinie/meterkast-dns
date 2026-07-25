// Direct matter.js Matter controller -- deliberately independent of
// Dirigera, which can also bridge third-party Matter devices onto its own
// REST API (see dirigera-adapter.js's own "why this beats speaking
// Matter/Zigbee directly" note). The point here isn't device coverage,
// it's comparing the real complexity of matter.js's own controller API
// against Dirigera's much simpler local REST API firsthand -- so this
// intentionally does NOT route commissioning through Dirigera.
//
// BLE is never used. @matter/nodejs-ble wraps @abandonware/noble + bleno
// -- the exact native node-gyp binding this project already tore out
// once (see the WebBluetooth/WebUSB adapters' own history). Confirmed
// against the real installed @project-chip/matter.js source (not
// assumed): CommissioningController.commissionNode's discovery options
// support a plain knownAddress {ip, port, type: "udp"} or
// identifierData {longDiscriminator}/{shortDiscriminator} + passcode,
// with discoveryCapabilities.ble simply left false -- no BLE package
// needs to be installed or imported at all.
//
// UNVERIFIED as of this commit: written and grounded against the real
// installed matter.js source (types, method signatures, dependency
// versions all confirmed live, not guessed), but not yet commissioned
// against a real owned Matter device -- no such device was available at
// the time this was written. Real-verify before relying on this, the
// same "unverified sketch" treatment meterkast-proxy's firmware once
// had.
import { Environment } from "@matter/main";
import { CommissioningController } from "@project-chip/matter.js";

let controllerPromise;

// One CommissioningController for the whole daemon (one fabric, matching
// this project's single-process model) -- created lazily on first use so
// importing this file has no side effects (no storage/network touched)
// until something actually calls commissionMatterDevice.
function getController() {
  if (!controllerPromise) {
    controllerPromise = (async () => {
      const controller = new CommissioningController({
        environment: { environment: Environment.default, id: "meterkast-dns" },
        autoConnect: false,
        adminFabricLabel: "meterkast-dns",
      });
      await controller.start();
      return controller;
    })();
  }
  return controllerPromise;
}

// discoveryCapabilities.ble is hardcoded false -- not exposed as an
// option on this function at all, so there's no call site that could
// accidentally turn BLE on.
export async function commissionMatterDevice({ longDiscriminator, shortDiscriminator, setupPin, knownAddress }) {
  if (longDiscriminator === undefined && shortDiscriminator === undefined) {
    throw new Error("commissionMatterDevice needs a longDiscriminator or a shortDiscriminator");
  }
  if (setupPin === undefined) {
    throw new Error("commissionMatterDevice needs setupPin (the device's setup passcode)");
  }

  const controller = await getController();
  const nodeId = await controller.commissionNode({
    commissioning: {},
    discovery: {
      identifierData: longDiscriminator !== undefined ? { longDiscriminator } : { shortDiscriminator },
      discoveryCapabilities: { ble: false },
      knownAddress,
    },
    passcode: setupPin,
  });
  return nodeId;
}
