# meterkast-dns

A design proposal for a local, external, Use-Pull resolver for smart-home device
identity — the missing piece that lets Bluetooth, Zigbee, USB, and MQTT devices
be named the way DNS lets hosts be named, instead of being addressed by a
hardcoded Gutenberg identifier that breaks the moment the physical thing moves.

This repo is a design document, not (yet) a running implementation.

---

## 1. Which protocols actually have a resolver

Seven protocols, one recurring question: is there a system, external to the
protocol itself, whose only job is to map a stable name the user chose to the
mutable physical address underneath it — the way DNS maps `gmail.com` to an IP
and stops, or DHCP hands a laptop an address without asking it to prove
anything?

- **TCP/IP** — yes. DNS resolves names to addresses; DHCP resolves "a device
  joined the network" to an address. Neither system needs to know what's
  running on top.
- **DNS** — is the resolver. The reference case every other row is measured
  against.
- **Bluetooth** — no. Devices are identified by MAC address, a pure Gutenberg
  identifier with no built-in name resolution. The OS pairing UI fakes a
  resolver by letting you rename a device locally, but there's no protocol-level
  system doing this — it's a per-OS, per-user patch. The one case where it
  actually feels like DNS (AirPods, appearing instantly as "Rinie's AirPods
  Pro" on every Apple device) works only because Apple owns both the chip and
  the OS and built a resolver that happens to be proprietary and single-vendor.
- **Zigbee** — no. IEEE addresses are the MAC-address problem one layer further
  from the user, and historically fragmented across incompatible profiles
  before Matter tried (and largely failed) to unify them. The closest thing to
  a resolver in the wild is zigbee2mqtt's `friendly_name` mapping — a real
  instance of the pattern, but bolted onto one specific bridge project rather
  than existing as infrastructure anything can query.
- **USB** — no. VID:PID plus a device path is the address; there is no
  DNS/DHCP equivalent at the USB layer at all. (Linux's `udev` "by-id" rules
  are the closest thing that exists today, and are effectively a local,
  unadvertised resolver already — see §4.)
- **MQTT** — no. The broker's address is hardcoded into the device at
  provisioning time. MQTT never adopted the DNS the rest of the network
  already had; when the network topology changes, there is no lookup to
  redirect the device, so the device just stops working and the user becomes
  the resolver by hand.

**One nuance worth naming rather than glossing over: Matter isn't cleanly a
"has a resolver" protocol either.** Matter's commissioning ceremony —
QR codes, numeric pairing codes, fabrics, Thread border routers — looks like
an attempt to build exactly this kind of resolver at the application layer.
But it was designed by a committee of five competing device-and-platform
vendors, each with an incentive to keep their own app and ecosystem as the
"real" naming authority. The result still leaks Gutenberg detail into the
user's lap (which fabric is this device on, is a border router in range,
scan this code) and never became a single, boring, external system the user
never has to think about. It's a third category, distinct from both "has a
Use-Pull resolver" (DNS) and "has no resolver at all" (Bluetooth/Zigbee/USB
raw/MQTT): a **Def-Push resolver that still fails the user**, built by and for
the vendors defining the standard rather than pulled into existence by the
people using it.

So the real dividing line isn't binary. It's:

| Has a Use-Pull resolver | Has no resolver | Has a Def-Push resolver that still fails the user |
|---|---|---|
| TCP/IP, DNS | Bluetooth, Zigbee, USB, MQTT | Matter |

---

## 2. The design: a local, transport-agnostic device resolver

The proposal below reuses patterns that already work elsewhere rather than
inventing new mechanism. Each piece below has a working precedent named next
to it.

### Shape

One small, transport-agnostic **core**: a name → `{transport, address,
last_seen, meta}` record store. Queryable on demand (like a DNS lookup) and
subscribable for change notifications (so a client doesn't have to poll —
it's told when a Def's address moves). This sits at the same conceptual
boundary as a router's NAT/DHCP layer: a demarc between the volatile,
protocol-specific noise on one side and a small set of stable names on the
other. Consumers (a browser page, a home-automation script, a CLI) only ever
see the stable name side.

### Adapters, not one monolith

Each transport gets its own small adapter whose *only* job is absorbing that
transport's ceremony and noise into one clean record in the core store
(whether an adapter runs in-process or gets true OS-level isolation is a
separate question — see IMPLEMENTATION.md):

- **BLE adapter** — a browser page (WebBLE), not a native binding; see
  "WebBLE/WebUSB as the alternative to a native binding" below for why. The
  pairing dialog is the AirPods pattern generalized past a single vendor —
  a one-time gesture, not repeated per reconnect. For devices with more
  than one GATT reading worth exposing (a thermometer's temperature and
  battery, say), also resolves the SIG-standardized service/characteristic
  names to their real UUIDs. See "Extending to BLE GATT characteristics"
  below.
- **USB adapter** — wraps `udev`, maps VID:PID+serial to a stable name that
  survives the device moving to a different physical port. This is close to
  what `udev`'s `by-id` symlinks already do locally and quietly — the adapter
  mainly needs to expose that mapping through the same core interface every
  other transport uses, instead of leaving it as a Linux-only convention
  nobody outside sysadmin circles knows exists.
- **Zigbee adapter** — wraps the coordinator's IEEE-address table. This is
  functionally what zigbee2mqtt's `friendly_name` already provides — the
  adapter's job is exposing that as a transport plugin behind the shared core
  rather than a bespoke feature of one bridge project.
- **MQTT adapter** — publishes and reads an mDNS/DNS-SD record
  (`_mqtt._tcp.local`) for the broker instead of requiring a hardcoded IP at
  provisioning time. This one doesn't need new infrastructure at all — mDNS
  already exists and already solves it; MQTT devices simply never adopted it.
- **433MHz/IR adapter** — decodes structured RF/IR protocols (RC5, newKaku,
  NEC) into `{protocol, address, command}` and stores the address once
  instead of repeating it per button; genuinely undecodable remotes fall back
  to LIRC-style raw pulse capture. See "Extending to 433MHz/IR remotes" below.
- **DNS adapter** — resolves a router-assigned local hostname
  (`raspi3.home`) via regular unicast DNS, not mDNS: most home routers run a
  combined DHCP+DNS server (dnsmasq being the common case) that already
  answers exactly this query, using whatever domain suffix the router
  picked rather than the reserved `.local`. Same shape as the MQTT/mDNS
  adapter above — nothing new to stand up, just a client for a resolver the
  network already runs. See "Extending to router-assigned local DNS names"
  below.

Splitting the system this way mirrors the Language Server Protocol / VS Code
extension-process model: a narrow, stable core interface, with all the
vendor- and transport-specific complexity pushed into swappable adapters that
communicate with the core over one clean interface. A consumer asking "where
is kitchen-light" never needs to know or care whether the answer today comes
from the BLE adapter or the Zigbee adapter — only the adapter itself does.
That's also the same test import maps and package registries (npm, cargo)
already pass and Java's bare `import` statement fails: can the Use side
replace the Def with a different implementation without the Use's own code
changing? Here, that means: can you swap which adapter answers for
`kitchen-light` — the bulb gets replaced with a different brand on a
different transport — without touching anything that queries the name.

### Use-Pull, not Def-Push

- **Names are Use-assigned.** `kitchen-light`, not `LE-Bose QC45` or a MAC
  address. The manufacturer's name is metadata, not the primary key.
- **The mapping is Use-editable**, the way a hosts file or a set of git refs
  is — plain enough to hand-edit, no proprietary tooling required to see or
  change what a name currently points to.
- **The pairing/commissioning ceremony happens once, at adapter bootstrap,
  not on every reconnect.** The device's Gutenberg identity is allowed to
  change underneath (BLE re-pairs with a new randomized MAC, USB moves to a
  different port, Zigbee re-joins with a new network address) without the
  name changing, exactly the way an A record can repoint without any
  bookmark breaking.

### Autogenerated name suggestions

The one-time bootstrap ceremony (§ "Use-Pull, not Def-Push" above) still has
to produce *something* before a human renames it. The adapter's suggestion
has two parts:

- **Base name** — slugified from whatever the transport already announces
  (mDNS hostname, Tasmota's own advertised name, BLE/Zigbee advertised name),
  lowercased, punctuation stripped.
- **Disambiguating suffix** — the source depends on whether the device is
  IP-reachable:
  - **IP-reachable** (mDNS/DHCP-visible — this covers Tasmota too, since it's
    WiFi): suffix = last octet of the local IPv4 address. `raspberrypi` at
    `192.168.178.54` suggests `raspberrypi54`. This is a strict improvement
    on Tasmota's own default (a hex MAC fragment, e.g. `tasmota-A3F2`): the
    octet is a number the human already sees on the router's client list, so
    recognizing which physical device a name refers to costs nothing —
    Tasmota's hex suffix just moves the lookup, it doesn't remove it.
  - **Non-IP transports** (raw BLE, Zigbee, USB, 433MHz): no natural numeric
    identity exists to borrow, so it falls back to the shortest unused
    counter on collision — the first device with a given base name gets no
    suffix, the next collision gets `2`, then `3` — the plain
    "Copy, Copy 2, Copy 3" pattern.

```toml
# adapter-suggested, not yet renamed by a human
raspberrypi54.transport = "mdns"
raspberrypi54.address   = "192.168.178.54"

tasmota12.transport = "mdns"
tasmota12.address   = "192.168.178.12"

kitchen-light.transport  = "bluetooth"     # first BLE device with this base name
kitchen-light.address    = "AA:BB:CC:DD:EE:FF"

kitchen-light2.transport = "bluetooth"     # second one, no IP to disambiguate with
kitchen-light2.address   = "11:22:33:44:55:66"
```

Honest limit: the octet suffix isn't re-derived on every scan — DHCP can
hand that address to a different device later, so it's a one-time suggestion
at first sight, frozen into the file the moment it's written, same as every
other adapter default in this design. Reserving a fixed/static lease for a
device in the router's DHCP config makes the suggested name durable in
practice, but that's a router-side choice the design doesn't depend on —
the suggestion is a starting guess good enough that most people won't bother
renaming it, not a claim that the address behind it never changes.

### The device-playlist file format

The mapping file itself — the artifact a person actually opens and hand-edits
— is TOML, not YAML or JSON. YAML's indentation sensitivity and implicit
typing (a MAC-looking value getting silently coerced, the classic Norway
problem) is the wrong kind of ambiguity for a file full of hand-typed
physical addresses; JSON has no comments, which defeats the point of a file
meant to carry human annotations ("moved to Dirigera 2026-03"). TOML's
dotted-key and inline-table syntax keep the file flat — one record per name —
closer to a hosts file or a DNS zone file than to a nested config tree:

```toml
myHpPrinter.transport = "mdns"
myHpPrinter.address   = "printer.local"

kitchen-light.transport = "zigbee"
kitchen-light.address   = "0x00124b0018f3a1c2"

car-hands-free.transport = "bluetooth"
car-hands-free.address   = "AA:BB:CC:DD:EE:FF"
```

(JSON5 with Mozilla's `about:config`-style dotted keys reaches the same flat
shape and is worth it if the resolver ever needs to round-trip its config as
an HTTP API response — but TOML's flatness comes from the format's own
culture, the way Cargo.toml and pyproject.toml already use it, rather than
from a convention that has to be separately enforced. That's the deciding
factor here.)

**The naming rule: keys are always Semantic, values are always Gutenberg —
never the reverse.** A key is always a name the Use side chose (`myHpPrinter`,
`kitchen-light`); the value is always whatever the transport actually
resolves to (`printer.local`, a MAC address, an IEEE address) and is treated
as an opaque string, never parsed as structure. Same discipline as the `@`
sign — left side owned by the Use, right side owned by the resolver — made
into an explicit file-format constraint instead of an implicit habit. It also
resolves a subtlety that looked like a real problem earlier: a dotted address
like `printer.local` only collides with TOML's dotted-key syntax if it's used
*as a key*. Used as a value, it's just a string — the rule that values never
become keys is what keeps the format safe.

**Secrets never go in the playlist — not even as a value.** The playlist
holds addresses, never credentials or keys. `device-playlist.example.toml`
in this repo is a fixture for docs and tests; a real, running instance's
actual playlist is named `device-playlist.toml` (gitignored) and should
never be committed anywhere public, since even addresses reveal real home-
network topology. A field that needs a credential — an MQTT broker password,
say — names an environment variable instead of holding the value:

```toml
mqtt-broker.transport    = "mdns"
mqtt-broker.address      = "_mqtt._tcp.local"
mqtt-broker.password_env = "MQTT_BROKER_PASSWORD"
```

The real value lives in a gitignored `.env` file, loaded automatically by
`npm start` via `--env-file-if-exists=.env` (native to Node, no
dependency — a no-op when `.env` doesn't exist, so the same command works
either way). This isn't a special
case of the naming rule above — it's a stronger one: a secret isn't Semantic
*or* Gutenberg, and doesn't belong in the resolver's mapping at all. The
concrete case where this matters most: the Zigbee coordinator-migration idea
below needs to back up a network encryption key, and that key must go
somewhere else entirely — never into this file, committed or not.

### Extending to 433MHz/IR remotes (RC5, newKaku, LIRC)

The same address-once pattern extends past network transports into RF/IR
remotes, because RC5 and newKaku (the KAKU/Klik-Aan-Klik-Uit protocol used by
Domoticz/RFLink-style 433MHz bridges) are both *decomposable* protocols — a
fixed address/system field, plus a per-button command or unit field that's
the only thing that actually varies:

```toml
[remotes.rc5-tv]
protocol = "rc5"
address  = 0                  # RC5 system code, shared by every button

[remotes.rc5-tv.commands]
power      = 12
volume-up  = 16
channel-3  = 3

[remotes.newkaku-livingroom]
protocol = "newkaku"
address  = "0x0139FA2"         # per-transmitter ID, paired once

[remotes.newkaku-livingroom.units]
3.name = "newspaper-reading-lamp"
1.name = "floor-lamp"
```

(TOML syntax note: `[remotes.rc5-tv]` followed by `protocol = "rc5"` and
`remotes.rc5-tv.protocol = "rc5"` written as a dotted key are the same
underlying nested table — `[section]` headers and dotted keys are two
notations for identical data, not two different formats. This doc uses
whichever reads better for the record's shape: dotted keys for the short,
two-field device entries earlier in the file, `[section]` headers here where
each remote has several grouped sub-fields.)

LIRC's `lircd.conf` is the cautionary example here, not the model to imitate.
Its non-raw mode does factor out the shared pulse-timing definition once per
remote, but still stores each button as the *full combined* address+command
code, repeated per button — the address bits are constant but re-baked into
every entry, because the format never splits the two fields apart. That's
the IR-protocol version of `import com.google.gson.Gson`: a constant welded
into every use site instead of factored out once behind a name (see the
[Java post](https://rinie.github.io/2026/07/29/java-reversed-hierarchy-forgot-resolver/)
in §3). LIRC's genuine raw mode — bare pulse/space timing, no protocol decode
at all — stays a legitimate fallback for remotes that really are undecodable
proprietary noise; that complexity is essential, not accidental, because
there's no address to factor out. RC5 and newKaku aren't in that category —
a resolver-style adapter should decode them and store the address exactly
once. (RC5 command codes were also semi-standardized by Philips across TV
brands, so a shared default command table could cover most buttons out of
the box, with per-device entries only for the exceptions — the same
"resolver supplies the default, Use only overrides" shape as an npm semver
range.)

### Extending to BLE GATT characteristics (thermometers, scales)

The same address-once, nested-underneath pattern applies to BLE devices
that expose more than one reading, because a GATT service/characteristic
is structurally the same shape as an RC5 button or a newKaku unit: one
physical thing (the MAC, stored once), several named sub-things underneath
it that vary:

```toml
[devices.kitchen-thermometer]
transport = "bluetooth"
address   = "AA:BB:CC:DD:EE:FF"

[devices.kitchen-thermometer.readings]
temperature = { service = "health-thermometer", characteristic = "temperature-measurement" }
battery     = { service = "battery-service",     characteristic = "battery-level" }

[devices.bathroom-scale]
transport = "bluetooth"
address   = "11:22:33:44:55:66"

[devices.bathroom-scale.readings]
weight  = { service = "weight-scale",    characteristic = "weight-measurement" }
battery = { service = "battery-service", characteristic = "battery-level" }
```

`"health-thermometer"` and `"temperature-measurement"` stand in for the
real values — `0x1809` and `0x2A1C`, 16-bit UUIDs assigned by the
[Bluetooth SIG's Assigned Numbers registry](https://www.bluetooth.com/specifications/assigned-numbers/).
This is a stronger case than RC5's semi-standardization by one company: the
SIG registry is a real, formally maintained, published resolver — Weight
Scale, Battery Service, Heart Rate all have committee-assigned names and
numbers the same way DNS's root zone does. The BLE adapter holds the small
lookup table translating those semantic names to the real UUIDs, the same
move as translating `"power"` to RC5's command byte — a resolver behind the
resolver, never leaking into the file a human edits.

Two things worth keeping separate rather than blurring together:

- **A proprietary GATT service** (a 128-bit vendor UUID, no SIG name) has no
  semantic name to fall back to — the value is just the raw UUID string,
  the same honest fallback as an undecoded IR remote falling back to LIRC's
  raw pulse capture. Not every BLE device gets the semantic treatment; only
  ones using standardized services do.
- **Decoding the actual bytes** a characteristic returns — Temperature
  Measurement is an IEEE-11073 float plus a flags byte; Weight Measurement
  packs weight, flags, and sometimes a timestamp into one blob — is adapter
  code, not playlist content. The TOML only names *which* characteristic to
  read; turning those bytes into an actual number in °C or kg is exactly
  the Def-Push ceremony the adapter exists to absorb, the same way the RC5
  adapter turns pulse timing into a command byte before anything reaches
  the resolver core.

This is implemented, not just designed — see IMPLEMENTATION.md "What's
actually implemented here" for exactly which parts are real and tested
(the UUID resolvers, the decoders, the nested-to-flat playlist loading) and
which one remains unverified against real hardware (the actual BLE scan).

### WebBLE/WebUSB instead of a native binding

An earlier version of this design used `@abandonware/noble`, a native
addon, for BLE. It needed `node-gyp` — a real C++ compiler and Python — to
build at all, on every platform, not just Windows: it ships no prebuilt
binary in its npm package (confirmed by extracting the actual tarball; no
`prebuilds/` directory), so `node-gyp-build` always falls through to
compiling from source. On a machine where installing a compiler isn't an
option — a work laptop with locked-down install permissions, say — that's
a hard stop, not a workaround-able inconvenience. It's gone now, along
with every `node-gyp` prerequisite, and the removal itself is a concrete,
measured improvement, not just a theoretical one: `npm audit` went from 7
high-severity findings (all inside `node-gyp`'s own bundled tooling —
`npmlog`, `gauge`, `are-we-there-yet`, an old `inflight`/`glob`/`tar` —
none of it this project's own code) to 0, and the lockfile shrank from
roughly 1,950 lines to 35.

`navigator.bluetooth` and `navigator.usb` sidestep the problem entirely —
no native addon, no compiler, no `node-gyp`, because the browser already
ships a working BLE/USB stack and exposes it directly to JavaScript. This
is the same move Chrome, the browser, and the router already made
correctly elsewhere in this series: stay close to what's already there
(bytes, an existing stack) instead of adding a semantic-heavy ceremony on
top of it. It's a smaller-scale version of the pattern from
[The Gutenberg/Semantic Model](https://rinie.github.io/2026/05/14/gutenberg-vs-semantic/)
§10 — Java and .NET tried to solve portability by adding more semantics
(bytecode, assemblies, reflection); the browser vendors solved BLE/USB
portability by exposing the bytes directly and letting the page decide what
they mean, the same "Gutenberg guys" move as UTF-8 and git.

**The shape**: since `navigator.bluetooth`/`navigator.usb` only exist in a
browser tab's JS, never in Node, the always-on background-daemon model for
BLE/USB specifically goes away — a browser tab has to be open and connected
for readings to flow. A new generic write endpoint, `POST /devices/:name`,
lets that browser page push a reading across the process boundary into the
registry; the page itself does the actual `requestDevice()` → `connect()`
→ `getCharacteristic()` → `readValue()` flow and decodes the bytes
client-side (`Buffer` isn't available in a browser; `DataView` is what Web
Bluetooth hands back) before posting `{transport, address, service,
characteristic, meta}` — the same `{value, unit}` shape every other reading
in this design carries, so `GET /devices/:name` looks identical regardless
of which adapter produced it.

**The pairing dialog is still the one-time bootstrap ceremony** already
described above — Chrome's device picker instead of an OS pairing prompt.
`characteristic.startNotifications()` keeps live updates flowing after that
first connect without any further click.

**Real, worth stating plainly: Chromium only.** Firefox and Safari have
both declined to implement Web Bluetooth/WebUSB, citing privacy and
fingerprinting concerns. Chrome or Edge, nothing else. The trade this
design makes is explicit: give up the always-on background daemon for
BLE/USB specifically, in exchange for zero native dependencies, anywhere,
for anyone.

**Listed with the same DataTables grid `/screens` uses, not a plain
button list.** `web-scan.html` reuses `public/grid.js` directly — each
transport's playlist entries render as a grid (BLE also shows its
`service`/`characteristic`, USB its `interfaceNumber`/`endpointNumber`),
with a real `<button>` in an action column instead of a detail-form
hookup. Clicking it still counts as a genuine user gesture for
`requestDevice()` — the browser tracks the actual native click that
triggered the JS, not which library dispatched it — so none of the
connect/decode logic above needed to change, only how each row renders
and how its button gets wired.

### Extending to WebUSB and WebHID (raw USB, and HID over either USB or Bluetooth)

Same shape as WebBLE above -- `navigator.usb`/`navigator.hid` in the
`web-scan.html` page, `POST /devices/:name` to cross back into the
registry -- but two different honest limits, for two different reasons.

**Raw USB has no standardized interface to resolve a name against.** BLE's
GATT has published, numbered services and characteristics (Health
Thermometer is always `0x2A1C`, on every conforming device); a vendor's raw
USB interface has no such registry -- the interface number, endpoint
number, and byte layout are whatever that device's own firmware author
chose. So a `usb`-transport entry names `interfaceNumber`/`endpointNumber`
explicitly instead of a resolved name:

```toml
usb-widget.transport       = "usb"
usb-widget.address         = "1a86:7523"   # vendorId:productId, hex
usb-widget.interfaceNumber = 0
usb-widget.endpointNumber  = 1
```

And unlike GATT notifications, raw USB has no generic push mechanism this
code can subscribe to -- so a click performs one `transferIn` read and
reports it, rather than starting a live subscription. Read again by
clicking again. The bytes themselves come back as hex, the same honest
fallback as LIRC's raw pulse capture or Smartbridge's opaque ciphertext:
reporting real bytes this code can't interpret beats guessing at a decoding
it has no basis for.

**WebHID is the only way a browser reaches a *Bluetooth* HID device at
all.** Web Bluetooth's own specification excludes the standard
HID-over-GATT service from `requestDevice()` on purpose (a long-standing,
deliberate security exclusion, not an oversight) -- so "BLE HID" from a
browser never means Web Bluetooth. It means WebHID talking to whatever the
OS already exposed as a HID node, because the OS's own HID driver claims
the device the moment it's paired, over USB or Bluetooth identically, and
WebHID sits on top of that OS-level abstraction rather than either
transport directly. One `address` shape covers both cases -- there's
nothing in a `hid`-transport entry that says which transport the device
actually uses, because from here it doesn't matter:

```toml
game-controller.transport = "hid"
game-controller.address   = "0079:0011"   # vendorId:productId, hex
```

Unlike raw USB, HID does have a generic push mechanism -- the
`inputreport` event -- so a `hid`-transport entry behaves like the BLE
section: one click to connect, live updates after that with no further
click. But HID report *bytes* are exactly as unstandardized as raw USB's
(a report's actual meaning depends on that specific device's own HID
report descriptor, which varies device to device), so they're reported the
same way: hex, keyed by `reportId`, the same honest fallback rather than a
guessed decoding.

### Extending to router-assigned local DNS names

Not every "the router already knows this" case is mDNS. A device with a
DHCP-fixed or DHCP-leased address (`raspi3` at `192.168.1.53`, say) is
usually also reachable as `raspi3.home` (or `.lan`, or whatever domain
suffix the router picked) — but that name isn't resolved by multicast the
way a `.local` name is. It's answered by regular, one-to-one unicast DNS,
sent straight to the DNS server the OS is already configured to use, which
on a typical home LAN is the router itself: most consumer and prosumer
routers run a combined DHCP+DNS server (dnsmasq being the common case
underneath OpenWrt, most ISP routers, and plenty of others) that already
answers exactly this query using its own DHCP lease table. Nothing new to
stand up — the router is already the resolver, the same shape as DNS
itself in §1, just scoped to the LAN instead of the internet.

```toml
raspi3.transport = "dns"
raspi3.address   = "raspi3.home"
```

Deliberately a separate `dns` transport from `mdns` above, not a variant of
it, because the mechanism genuinely differs: one multicast query with no
fixed destination versus one unicast query sent to a specific, known
server. `.local` is reserved for mDNS by [RFC 6762](https://www.rfc-editor.org/rfc/rfc6762);
`.home`/`.lan`/whatever a router uses is a convention, not a reservation,
and only resolves at all because that specific router chooses to answer
it. Node's built-in `dns` module handles this natively — no new dependency
the way `multicast-dns` was needed for the mDNS adapter, since regular
unicast DNS is exactly what `dns.resolve4`/`resolve6` already speak.

### Extending to vendor-hub REST APIs (Dirigera, and Matter by proxy)

§1 named the shape a working resolver takes for smart-home devices: a
single vendor owning both sides of the boundary, the way Apple does for
AirPods. IKEA's Dirigera hub is a second, independent instance of exactly
that pattern — its local REST API (`GET /v1/devices` over HTTPS) already
returns Zigbee *and* Matter/Thread devices as flat, clean JSON:
`isOn`, `lightLevel`, `batteryPercentage`, no protocol detail leaking
through. It doesn't fix Matter's committee-designed commissioning ceremony
described in §1 — it sidesteps it, the same way zigbee2mqtt's
`friendly_name` map (already cited under "What already exists") sidesteps
raw Zigbee. A resolver behind the resolver, bolted onto one vendor's hub
rather than existing as open infrastructure — same honest limit as
zigbee2mqtt, just covering Matter too now.

```toml
kitchen-lamp.transport = "dirigera"
kitchen-lamp.address   = "<dirigera-device-id>"
```

Connection config — the hub's hostname and bearer token — lives in `.env`,
not the playlist: `DIRIGERA_HOSTNAME` and `DIRIGERA_BEARER_TOKEN`. The
hostname isn't a secret, but it's real-instance-specific config that
shouldn't be hardcoded into a committed file either, the same reasoning
`METERKAST_BACKUP_REMOTE` already follows. Unlike BLE/USB this needs no
browser and no native binding at all — it's plain HTTPS with a bearer
token, which Node handles natively, so it runs as a normal polling adapter
in-process, no isolation concern the way a native binding would be.

One detail worth being explicit about rather than quietly working around:
Dirigera's local API uses a self-signed certificate, because there's no
certificate authority for a LAN IP address — normal for this class of
device, not a shortcut. The fix is to skip verification for that one
request specifically, never globally (`NODE_TLS_REJECT_UNAUTHORIZED=0`
would disable certificate checking for every HTTPS call the process makes,
not just this one hub).

See IMPLEMENTATION.md for what's verified here versus BLE's honest gap —
this one goes further, since a self-signed HTTPS server is fully fakeable
in a test without needing the real hardware.

### Extending to cloud vendor APIs (Ecowitt, Smartbridge/ICS2000) — and their honest limits

Worth naming plainly rather than blurring together: these two are a real
step down from Dirigera, not a lateral move. Dirigera is local — a LAN IP,
no internet dependency, the AirPods pattern done properly. Ecowitt
(`api.ecowitt.net`, weather-station readings) and Smartbridge
(`trustsmartcloud2.com`, KlikAanKlikUit's ICS2000 cloud, syncing the same
newKaku devices §2's RF/IR section already covers locally) are both cloud
services — the exact "Alexa, the cloud resolver that moves without asking"
pattern the series criticizes elsewhere. They still fit the same adapter
contract, and they're still worth having, but the resolver here is
borrowed from a third party staying online and compatible, not owned the
way Dirigera's local hub is.

```toml
weather-station.transport = "ecowitt"
weather-station.address   = "<device-mac>"

kaku-plug.transport = "smartbridge"
kaku-plug.address   = "<ics2000-device-id>"
```

Credentials live in `.env` — `ECOWITT_APPLICATION_KEY`/`ECOWITT_API_KEY`,
`SMARTBRIDGE_EMAIL`/`SMARTBRIDGE_MAC`/`SMARTBRIDGE_PASSWORD_HASH` — never
the playlist, same rule as everywhere else. Both are real public cloud
APIs with properly CA-signed certificates, unlike Dirigera's self-signed
local one — cert verification stays on by default here; there's no
legitimate reason to skip it for a service the whole internet also talks to.

**Ecowitt is a clean, well-behaved API**: `real_time` returns readings as
`{time, unit, value}` triples, already labeled, already unit-tagged,
passed through as `meta` the same way Dirigera's `attributes` are. One
real gotcha, confirmed empirically rather than assumed: `temp_unitid`
defaults to `2` (Fahrenheit) when omitted, regardless of any unit
preference set in the Ecowitt account/app — the adapter requests
`temp_unitid=1` (Celsius) explicitly rather than relying on that
default.

**Smartbridge/ICS2000 is the honest-limit case, confirmed against the real
API rather than assumed**: its `sync` endpoint returns each device's
`data` and `status` fields as opaque, encrypted, base64-looking ciphertext
— no documented or publicly known way to decrypt them. Same fallback as an
undecoded 128-bit BLE UUID or LIRC's raw pulse mode: pass the ciphertext
through unchanged rather than guess at it. What *is* usable without
decryption: `version_status` and `version_data` still change whenever the
device's real state changes, which is a genuine "something happened"
signal even without knowing what.

### Browsing the resolver: handcoded markdown screens, not a generated UI

Every adapter above answers "how does a *device* get resolved." This one
is about the *browser* side: how a person actually looks at what the
resolver knows, at `/screens` — the default landing page (`GET /`
redirects there). The original plain live-SSE device table still exists,
just relocated to `/table`, for whoever wants that single always-live
view without the sidebar/markdown-page layer.

`/screens` itself has a real home page — `pages/index.md`, an overview
with links to every regular page plus `/table` and `/web-scan` — rather
than silently auto-selecting whichever page happens to be listed first
in the sidebar. The distinction matters the same way it does in
Observable Framework itself: `index.md` is the landing page, not just
one more entry in the page list.

**The screens are hand-authored `.md` files, not generated.** `public/pages/*.md`
map to `/screens/:slug` the same way
[Observable Framework's own file-based routing](https://observablehq.com/framework/routing)
works — a real markdown file per page, a small hand-maintained sidebar
list (`public/screens.js`'s `PAGES`, mirroring Framework's own
`observablehq.config.js` sidebar config) rather than filesystem
discovery. This is a deliberately different shape from the adapter model
above: there's no database to generate a screen definition *from* —
meterkast-dns's own "database" is the TOML playlist plus the in-memory
registry, not Oracle rows the way an earlier, unrelated prototype
([`locuswms-web-frontend`](https://github.com/rinie), a Locus WMS web
frontend) generates its own screens' markdown from. Here, a page's
markdown *is* the source, the same way any other Observable Framework
page is.

**Rendered with [observable-forms](https://github.com/rinie/observable-forms),
vendored under `public/vendor/observable-forms/`.** Its `:::form` syntax
— a pipe-table grammar, one cell per field, `Label [name] =` for a
readonly field — renders the detail panel above each page's data grid.
Selecting a grid row populates that panel's fields by matching
`[name="key"]`/`[data-name="key"]` against the selected row's own keys,
the same master-detail pattern `locuswms-web-frontend` already validated
— object-valued fields (a device's raw `meta`) are shown as their JSON
text, the same honest-fallback reasoning used everywhere else in this
design for a value with no better display.

**The data grid is [DataTables](https://datatables.net), fed by a small
markdown extension: a fenced `` ```datatable `` block naming a live
JSON endpoint.**

````markdown
```datatable
{"endpoint": "/resolved", "columns": ["name", "transport", "address", "resolvedAddress"], "sort": "name"}
```
````

`columns`/`header`/`sort`/`reverse` deliberately reuse
[Observable's own `Inputs.table` option names](https://observablehq.com/framework/inputs/table)
— DataTables renders denser and, subjectively, nicer than `Inputs.table`
(confirmed building `locuswms-web-frontend`, which implements both), but
a page author moving between the two shouldn't have to learn different
words for the same idea. Expressed as JSON rather than real JS specifically
because a fenced block in a hand-authored file is not a place to `eval`
arbitrary code — `public/screens.js` overrides markdown-it's own `fence`
renderer for exactly this one info-string, so every other fenced block on
a page (a real code sample) still renders normally.

**Zero new dependencies, browser or server.** `markdown-it` and
`datatables.net-select-dt` load from a CDN as ES modules, the same
pattern `web-scan.html` already established for BLE/USB/HID — no
bundler, no build step, no npm package added to `package.json` for any
of this.

**The sidebar itself never waits on that CDN.** `markdown-it` is loaded
lazily, on first actual page render, not as a static top-level `import`
— a static import blocks a module's *entire* top-level code from running
until it resolves, sidebar included, even though rendering a list of
page links has nothing to do with markdown. A slow or unreachable CDN
degrades to "the sidebar works, the page content doesn't load yet,"
never to "nothing appears at all."

**The Log screen (`/screens/logs`) is the same pattern, live.** The
backend keeps a bounded, timestamped record of its own recent activity
— `src/core/log.js`, a Domoticz/Home-Assistant-style rolling log, since
there's no database to persist a real one in. A `` ```datatable `` block's
`live: true` tells `public/screens.js` to also open an `EventSource` on
the existing `/events` connection (a `"log"` named event alongside the
`"change"` events device updates already use — one connection, two event
types, not a second SSE endpoint) and append each new entry to the grid
as it happens, no page reload. `rowClassKey: "level"` colors each row by
severity (error/warn/info/debug), the same at-a-glance distinction those
other dashboards' log views use.

### Flattening nested readings for display

A raw reading is rarely flat — Ecowitt's `real_time` response nests
temperature three levels deep (`outdoor.temperature.{value,unit}`), and
`GET /devices/:name`'s own `meta` shows that whole structure verbatim,
correctly but unreadably. The fix is the same shape as `GET /resolved`'s
`summarizeResolution` (normalize a differing shape into one clean field),
generalized into a hand-editable mapping instead of hardcoded per
transport: `display-fields/`, one TOML file per transport
(`display-fields/ecowitt.toml`, `display-fields/dirigera.toml`, ...) — the
same "one file per chapter" granularity the rest of this project follows,
and specifically to avoid a single shared file collecting merge friction
across independent transports' changes (see "Why one file per transport"
below).

```toml
# display-fields/ecowitt.toml
[[fields]]
label     = "Indoor Temperature"
valuePath = "indoor.temperature.value"
unitPath  = "indoor.temperature.unit"
```

A **few** curated lines, deliberately — mirroring a device's own physical
console (an Ecowitt indoor unit's main screen shows exactly Indoor/
Outdoor Temperature and Humidity, not every field its API returns), not
an attempt to flatten the whole `meta` tree generically. `valuePath`/
`unitPath` are dot-paths into a device's own `meta`; a path that doesn't
resolve for a given reading is skipped rather than shown blank, same
"only show what's real" reasoning as `/resolved` leaving out a
never-resolved entry entirely. Numbers are normalized to a fixed one
decimal place (`23.5`, not a bare `23`) but the decimal separator itself
stays a plain period — programming convention, not locale formatting,
by explicit request: comma is reserved for separating values (CSV,
lists), never doubling as a decimal point the way some locales' Excel
defaults do. `toFixed`, not `toLocaleString`, specifically to avoid
picking up the host's own locale by accident.

Committed, not gitignored, unlike `device-playlist.toml`: a path into a
transport's own known response shape isn't personal network topology,
it's a sensible default for anyone using the same integration. `/screens/devices`'
detail panel renders these lines above the raw `meta`, never instead of
it — the full reading is always one click away.

Ecowitt's API always answers the same shape, so `ecowitt.toml` is a flat
`[[fields]]` array. A hub like Dirigera doesn't — one hub fans out to
structurally different device types (a light's `isOn`/`lightLevel` mean
nothing for a door sensor's `isOpen`), so `dirigera.toml` is instead a
table keyed by `deviceType`, one top-level array per type instead of a
single `fields` key:

```toml
# display-fields/dirigera.toml
[[light]]
label     = "On"
valuePath = "isOn"
format    = "boolean"

[[light]]
label     = "Brightness"
valuePath = "lightLevel"
unit      = "%"
```

`deviceType` (`light`, `outlet`, `motionSensor`, ...) is Dirigera's own
structural classification of the device — `matchConfiguredDevices` in
`dirigera-adapter.js` surfaces it verbatim as `device.deviceType`, a peer
field alongside `meta`, not folded into it. `loadDisplayFields` in
`display-fields.js` reads every `*.toml` file in `display-fields/` and
decides the shape once per file: a top-level `fields` array means flat
(Ecowitt), otherwise every top-level key is a deviceType whose own array
is used directly (Dirigera). `resolveFieldDefs` then looks up the
already-merged, in-memory `{transport: [...] | {deviceType: [...]}}` the
same way regardless of which shape a given transport's file used. Two new
field shapes support the Dirigera case: a literal `unit` string (Dirigera
has no per-reading unit field to point at the way Ecowitt does —
`lightLevel` is always `%`, so it's written directly rather than as a
`unitPath`) and `format = "boolean"` (renders `isOn`/`isOpen`/etc as
`On`/`Off` instead of running them through the numeric formatter). All six
deviceType examples committed (`light`, `outlet`, `motionSensor`,
`openCloseSensor`, `waterSensor`, `environmentSensor`) are verified
against a real Dirigera hub's real attributes, not guessed from API docs
— see IMPLEMENTATION.md.

The key design question was *what* to key the Dirigera table by. The
first draft keyed it by device *name* (`kitchen-lamp`), which collapses
under its own logic: `display-fields/` is committed specifically because
it's generic and shareable, and a device name is neither — it's the same
personal, Use-chosen identifier `device-playlist.toml` already owns.
`deviceType` is a structural, API-provided property instead, so keying by
it keeps the file generic: anyone with a Dirigera hub gets a working
`light` mapping without editing anything, the same way LIRC's own remote
`.conf` files are keyed by remote *model* — a shared, community-maintained
catalog — never by which specific physical remote a user owns.

**Why one file per transport, not one shared `display-fields.toml`:**
this file started out single, and a genuinely useful question came up
while it only had two transports in it — "now you have 2 tomls [(the
playlist and this one)], would 1 toml not be more appropriate?" The answer
for *that* split still holds (trust/commit boundary: personal vs.
generic), but the same underlying friction reappears one layer down as
more transports get added to a single `display-fields.toml`: unrelated
transports' entries sitting in one file means unrelated changes (a new
Ecowitt field, a new Dirigera deviceType, a future third transport)
collide in the same diff for no structural reason. Splitting by transport
— filename *is* the key, so a file's own content never has to repeat it —
removes that friction the same way `device-playlist.toml` vs.
`display-fields/` already removed it at the personal/generic boundary.

**Narrowing the catalog further, per device.** `display-fields/`'s catalog
is transport/deviceType-wide — every light gets the same `On`/`Brightness`
lines. Not every device with the same `deviceType` wants the same lines
shown, though (two lights, only one of which you care about brightness
for), so `device-playlist.toml` supports two optional keys on any device
entry:

```toml
hallway-lamp.transport     = "dirigera"
hallway-lamp.address       = "<dirigera-device-id>"
hallway-lamp.displayFields = ["On"]              # allow-list: only these labels show
```

or, on a different device, a deny-list instead (`excludeDisplayFields`,
"everything except these"). Neither key: every catalog line shows, today's
default. Both set on the same device: the allow-list wins outright, not
merged — "show only X" and "show everything but Y" answer different
questions, so combining them would just be guessing which one was meant.
This lives in `device-playlist.toml`, not `display-fields/`, on purpose:
it's Use-specific ("I don't care about this device's brightness"), the
same personal/generic split the two files already draw everywhere else.

A field narrowed out isn't gone from the response, just moved:
`GET /devices/:name` returns both `display` (the shown lines) and
`displayHidden` (the filtered-out ones, still real, already-formatted
values, not re-fetched or relabeled). `/screens/devices`' detail panel
renders `displayHidden` in a collapsed "Hidden fields" section below the
primary lines — click to check a hidden field's current value without
permanently re-enabling it, useful for confirming a vendor API's shape
hasn't quietly changed underneath a field you stopped watching.

This is a composition problem more than an invention problem — most of the
pieces already exist somewhere, just not connected:

- `udev` `by-id` persistent naming (USB)
- Avahi / Bonjour mDNS-SD (the fix MQTT broker discovery already has
  available and doesn't use)
- zigbee2mqtt's `friendly_name` map (Zigbee)
- Dirigera's own `GET /v1/devices` (Zigbee and Matter/Thread both, already
  flattened to clean JSON — see "Extending to vendor-hub REST APIs" above)
- Home Assistant's entity/device registry, which gets closest to this pattern
  today but is bundled into one large platform rather than exposed as a
  small, standalone resolver anything else could query directly

### Discovering unclaimed devices

Every adapter above only ever reports devices already named in the
playlist. `/screens/discover` answers the opposite question — what's out
there, real, but not yet claimed? For a hub/cloud transport that already
fetches its full inventory every poll cycle (Dirigera, Smartbridge), this
is nearly free: `unclaimedDirigeraDevices`/`unclaimedSmartbridgeDevices`
(in each adapter's own file) are the mirror image of `matchConfiguredDevices`
— every real device whose id *isn't* claimed by a playlist entry, with a
`suggestedName` (from the device's own `customName` where the API
provides one, else `${deviceType}-${id}` — only ever a starting point, not
assumed final).

`POST /discover/:transport` runs one scan on demand — a real hit against
the real hub/cloud API, triggered by clicking "Scan," never a background
poll. `POST /playlist/devices` claims a candidate under a real name:
`addPlaylistEntry` (in `playlist.js`) writes it into
`device-playlist.toml` through the same `writePlaylist` backup +
atomic-write path any hand-edit already uses, rejecting a name collision
with `409` and a `suggestedName` rather than silently overwriting or
guessing. The claimed device shows up in `GET /devices` immediately (it's
upserted into the live registry too) — but its adapter only starts
*polling* it after the next `meterkastd` restart, since
`device-playlist.toml` is read once at startup (`runPollingAdapter`
snapshots the registry into each adapter generator a single time; see
`run-polling-adapter.js`). The UI states this plainly rather than implying
live data appears immediately.

Plain DNS has no protocol-level "browse" the way mDNS's `_services.
_dns-sd._udp.local` meta-query does, so its own discovery mechanism is
different: `scanSubnet` (in `dns-adapter.js`) reverse-PTR-queries every
host address in a user-supplied CIDR (capped at `/22`..`/32` — 1024
addresses at most, so a typo can't turn into a sweep of a much larger
range), and `unclaimedDnsCandidates` filters out any hostname already
claimed by a `transport: "dns"` entry. Most addresses on a real LAN have
no PTR record at all; that's the expected, normal outcome for most of a
scan, not an error (same `ENOTFOUND`/`ENODATA` treatment
`resolveDnsHostname` already gives those two codes).

Unlike the hub transports, there's no *universal* default for "which
subnet" — three tiers, most-specific wins: the request's own `cidr` query
param (a one-off scan of somewhere else), `METERKAST_DNS_CIDR` in `.env`
(real, instance-specific config the user set explicitly, same reasoning
`DIRIGERA_HOSTNAME` already follows — not a secret, shouldn't be
hardcoded into a committed file either), or `detectLocalCidr`'s own
auto-detection from this machine's real network interfaces as a last
resort. A real laptop often has more than one active non-internal
interface at once — this project's own dev machine runs a corporate VPN
client (`Centric Azure VPN`) alongside its real Wi-Fi adapter — so
auto-detection prefers the first interface whose name doesn't look
VPN-like (a best-effort, name-based heuristic; there's no OS-portable API
flag for "this is a VPN"), falling back to whatever's there if every
candidate looks VPN-like rather than finding nothing at all.

`/screens/discover`'s DNS panel pre-fills its input from
`GET /discover/dns/default-cidr` whenever any tier resolved something,
and labels *which* tier right next to the field (`(METERKAST_DNS_CIDR)`
or `(auto-detected from "Wi-Fi")`) — an auto-detected value is never a
silent guess, and the field stays editable either way for a one-off scan
of somewhere else. Nothing resolved at all just leaves the plain
placeholder hint, same as before any of this existed. Clicking Scan with
neither a typed value nor anything resolved throws a clear message rather
than guessing — caught client-side too, before the request, after a real
report of the error reading like a bug rather than "you forgot to type
something."

Bluetooth is the odd one out: Web Bluetooth has no server-side inventory
to scan at all — its whole security model is a real user gesture picking
one specific device from the browser's own chooser, not something a
background process can enumerate on someone's behalf. So BLE discovery
lives entirely client-side, in `web-scan.html` (not `/screens/discover`,
which is backed by real server-side scans): a "Scan for a device" button
calling `navigator.bluetooth.requestDevice({acceptAllDevices: true})` —
the standards-track, no-flag API — one real device per click, accumulated
across multiple clicks in that page's own memory (deduplicated by
address), each with the same "Add to playlist" inline-input flow the
other three transports use. `POST /playlist/devices` needed no changes at
all to support this — it was already fully transport-agnostic. Web
Bluetooth also never exposes a device's real MAC to page JS — `device.id`
is an opaque, origin-scoped identifier instead, stable for one browser
profile but not the same real Gutenberg address the native `noble`
adapter's own MAC is; worth stating plainly since this is the *sole*
identifier a freshly-discovered BLE playlist entry gets.

mDNS discovery (browsing for arbitrary LAN devices advertising over
Bonjour, rather than resolving an already-configured hostname) is the one
piece deliberately not built here — parked on this project's own
development machine specifically, since its Windows Firewall only allows
mDNS for `svchost.exe`, not `node.exe`, so there's no way to real-verify a
browse pass the way every other piece of this project has been verified
before shipping. Can be added the same way once warranted (or once
verified from a different host), without changing anything documented
here.

### Honest limits

- This does not remove the first-contact ceremony — it relocates it to a
  one-time-per-adapter bootstrap step. There is no such thing as a device
  that names itself correctly on first contact with zero human input; the
  claim here is only that the ceremony should happen once, not every time the
  network changes.
- Unlike DNS, there is no existing universal deployment or authority for this
  — it only works if something (the user, or eventually a shared open
  project) actually runs the adapters and the core.
- **A programmatic write to `device-playlist.toml` (currently only
  `addPlaylistEntry`, via "Add to playlist") strips every comment and
  reformats the whole file.** `writePlaylist` round-trips the entire
  playlist through `smol-toml`'s `parse`+`stringify`, which has no concept
  of comments at all — a real, confirmed-live cost, not a hypothetical
  one. Nothing is destroyed (the same write's own pre-write
  `snapshotPlaylist` backup captures the prior, comment-intact file first,
  the same safety net every hand-edit already gets), but a user who wants
  their explanatory comments back after an "Add to playlist" click has to
  restore them from that backup by hand. A real fix would need a
  comment-preserving TOML writer, which `smol-toml` doesn't provide —
  not attempted here.
- This is a proposal that extends the logic already established in the
  Gutenberg/Semantic series, not a report of something that already exists in
  this composed form. Where individual pieces already exist (udev, mDNS,
  zigbee2mqtt, Home Assistant), that's noted explicitly above rather than
  implied to be new.

---

## 3. Relationship to the Gutenberg/Semantic series

This design grew directly out of the "Gutenberg/Semantic" blog series at
[rinie.github.io](https://rinie.github.io), specifically:

- [The Gutenberg/Semantic Model](https://rinie.github.io/2026/05/14/gutenberg-vs-semantic/) — the foundational resolver table, and the line that started this thread: *"USB, Bluetooth, Ethernet — hardware identifiers... are hardcoded Gutenberg addresses... no equivalent exists for USB device paths."*
- [Your Lights Don't Know Your Name](https://rinie.github.io/2026/06/03/bluetooth-matter-rdf-naming/) — Bluetooth MAC addresses, Matter's commissioning ceremony as a Def-Push resolver attempt, AirPods as the one working case.
- [WiFi, the Browser and the Router Just Evolve](https://rinie.github.io/2026/07/17/wifi-browser-router-evolve/) — the MQTT hardcoded-broker-address argument in full, and the "correct model" (DHCP, mDNS, local HTTP/WebSocket) this design tries to generalize.
- [URL, DNS and the @ Sign](https://rinie.github.io/2026/07/28/at-sign-layer-boundary/) — the clean semantic/Gutenberg boundary template.
- [com.google.gson Goes Nowhere](https://rinie.github.io/2026/07/29/java-reversed-hierarchy-forgot-resolver/) — the modularity test ("can the Use replace the Def without touching Use code") and the ES6 import-map precedent.
- [Borg's Arrogance](https://rinie.github.io/2026/07/30/resolver-hardens-or-atrophies/) — when a resolver is and isn't worth building.
- [The Meterkast Pattern](https://rinie.github.io/2026/08/03/the-meterkast-pattern/) — the router/NAT/DHCP demarc this repo's name and core architecture borrow directly.

The series' own working notes (`CONTEXT-handover.md` in `rinie.github.io`,
copied verbatim into [`series-notes/CONTEXT-handover.md`](series-notes/CONTEXT-handover.md)
in this repo for provenance) list a queued, undrafted seed note titled
`note-reflection-external-resolver.md`. This repo folds in the *spirit*
implied by that title — this write-up has **not** seen that note's actual
contents (it lives in an external `outputs/` folder that wasn't shared with
this session) — so treat this as a fresh design inspired by the queue entry,
not a merge of existing text. If the original note exists and says something
different, that should take precedence.
