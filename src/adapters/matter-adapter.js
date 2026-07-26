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
// Real-verified: commissioned an actual IKEA Dirigera hub exposed as a
// Matter bridge (IKEA Home Smart app -> Integrations -> Matter Bridge)
// via a real pairing code, using knownAddress to skip discovery. Full
// PASE handshake, device attestation, NOC install, and an automatic
// subscription to the bridge's endpoint state all completed for real.
//
// One real finding worth keeping in mind: this laptop's own local mDNS
// is firewall-blocked for node.exe (see the meterkast-proxy README) --
// matter.js runs its own internal mDNS, entirely separate from this
// project's mdns-adapter.js/proxy setup, and that got stuck specifically
// on the post-commissioning operational reconnect (which has no
// knownAddress override) when run on this machine. The full flow only
// completed when run from a second machine without that firewall rule.
// discriminator-only discovery (no knownAddress) would likely hit the
// same wall even earlier, at the initial PASE step.
import { Environment } from "@matter/main";
import { ManualPairingCodeCodec } from "@matter/main/types";
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
//
// pairingCode is the 11-digit manual pairing code most apps show you
// (e.g. Dirigera's own "Create Matter Bridge" flow) -- decoded via
// matter.js's own ManualPairingCodeCodec rather than asking a caller to
// split it into discriminator+passcode by hand. Takes precedence over
// separately-provided longDiscriminator/shortDiscriminator/setupPin if
// both are somehow given.
export async function commissionMatterDevice({
  pairingCode,
  longDiscriminator,
  shortDiscriminator,
  setupPin,
  knownAddress,
}) {
  if (pairingCode !== undefined) {
    const decoded = ManualPairingCodeCodec.decode(pairingCode);
    shortDiscriminator = decoded.shortDiscriminator;
    setupPin = decoded.passcode;
  }

  if (longDiscriminator === undefined && shortDiscriminator === undefined) {
    throw new Error("commissionMatterDevice needs a pairingCode, or a longDiscriminator/shortDiscriminator");
  }
  if (setupPin === undefined) {
    throw new Error("commissionMatterDevice needs setupPin (the device's setup passcode) or a pairingCode");
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
