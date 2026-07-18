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

Each transport gets its own small adapter process whose *only* job is
absorbing that transport's ceremony and noise into one clean record in the
core store:

- **BLE adapter** — wraps BlueZ (or platform equivalent), does continuous
  background scanning, and once a device is confirmed once by the user it's
  registered under a user-chosen name permanently — the AirPods pattern,
  generalized past a single vendor instead of copied by one.
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

### What already exists and should be reused, not reinvented

This is a composition problem more than an invention problem — most of the
pieces already exist somewhere, just not connected:

- `udev` `by-id` persistent naming (USB)
- Avahi / Bonjour mDNS-SD (the fix MQTT broker discovery already has
  available and doesn't use)
- zigbee2mqtt's `friendly_name` map (Zigbee)
- Home Assistant's entity/device registry, which gets closest to this pattern
  today but is bundled into one large platform rather than exposed as a
  small, standalone resolver anything else could query directly

### Honest limits

- This does not remove the first-contact ceremony — it relocates it to a
  one-time-per-adapter bootstrap step. There is no such thing as a device
  that names itself correctly on first contact with zero human input; the
  claim here is only that the ceremony should happen once, not every time the
  network changes.
- Unlike DNS, there is no existing universal deployment or authority for this
  — it only works if something (the user, or eventually a shared open
  project) actually runs the adapters and the core.
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
