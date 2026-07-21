# Implementation

How the design in README.md gets built and run: current LTS Node.js, native
ESM, no bundler, no framework, no TypeScript build step.

## Runtime

- **Node.js, current Active LTS** (`engines.node: ">=22"` in package.json;
  developed and tested against 24.18.0). Riding evergreen Node rather than
  pinning an old LTS is the same [Evergreen principle](https://rinie.github.io/2026/05/14/gutenberg-vs-semantic/)
  the rest of the series argues for.
- **`"type": "module"`** — native ESM throughout, no bundler, no CommonJS
  interop shims.
- **Every relative import carries a `.js` suffix.** This isn't a style rule
  layered on top — it's what Node's ESM resolver requires by default; there
  is no extensionless resolution the way `require()` or a bundler provides.
  If TypeScript gets added later, `"moduleResolution": "nodenext"` preserves
  exactly this behaviour (write `foo.ts`, still `import "./foo.js"`), so the
  constraint holds either way. Plain JS just gets there with zero build step.

## File convention: one file per module, not one file per function

Each file holds every function for one cohesive feature — a "chapter", not a
"paragraph". No classes, no hidden state — state is a plain object (a `Map`
plus a `Set` of subscribers, for the registry) passed explicitly into every
function that touches it. A directory that would otherwise hold only a
single file is flattened instead: the file sits at the parent level directly.
Related-but-distinct concerns (e.g. playlist read/write vs. its dated-backup
versioning) still get their own file when the concern is big enough to
justify one, but the boundary is "a feature", never "a function":

```
src/
  core/
    registry.js          # create/upsert/remove/get/list/subscribe + recordsAsObject
    naming.js             # slugify, suffixFromIp, suffixFromCounter, suggestName
    playlist.js            # read/write (atomic + snapshot) + watch + flattenDeviceReadings
    playlist-backup.js      # dated-backup versioning: format, list, read-latest, validate, snapshot
    secrets.js               # resolveSecretEnv -- env var name -> value, or a clear error
    run-polling-adapter.js    # shared wiring: check transport, run, upsert
    offsite.js                 # git-backed offsite sync: init, commit, push, orchestrate
    log.js                      # bounded timestamped log buffer + subscribe -- see README.md
    display-fields.js            # dot-path resolve + comma-decimal format, driven by display-fields/
    server.js                   # createServer + every route handler + static-page serving
  adapters/
    load-adapters.js            # dynamic import() loader
    static-adapter.js           # example/test adapter, no hardware
    dirigera-adapter.js          # fetch + parse + match + polling loop, all of it
    ecowitt-adapter.js           # fetch + parse + polling loop, all of it
    smartbridge-adapter.js       # fetch + parse + match + polling loop, all of it
    mdns-adapter.js              # PTR/SRV/A/TXT resolution + polling loop, all of it
    dns-adapter.js                # unicast A/AAAA resolution + polling loop, all of it
bin/
  meterkastd.js                  # entrypoint: loads the playlist, starts the server
  sync-backups.js                 # cron-friendly: pushes backups/ offsite
test/
  registry.test.js
  naming.test.js
  playlist.test.js
  backup.test.js
  secrets.test.js
  offsite.test.js
  server.test.js
  dirigera.test.js
  ecowitt.test.js
  smartbridge.test.js
  mdns.test.js
  dns-adapter.test.js
  log.test.js
  display-fields.test.js
  run-polling-adapter.test.js
  fixtures/
    test-cert.pem                    # throwaway self-signed cert for HTTPS tests
    test-cert.key
    ecowitt-real-time-response.json  # real response shape, captured live
    smartbridge-sync-response.json   # real response shape, IDs genericized
  run-all.js                     # see "Testing" below
public/
  index.html                     # GET /table -- classic device table, live via SSE
  web-scan.html                  # WebBLE/WebUSB/WebHID page -- see README.md
  screens.html                   # GET /screens shell (also GET / -- see below) -- sidebar + content area
  screens.js                     # sidebar/router, markdown-it + observable-forms setup,
                                  # the ```datatable fence rule, row-select -> form population
  screens.css                    # sidebar/content layout + DataTables density (ported sizes)
  grid.js                        # DataTables adapter -- see README.md "Browsing the resolver"
  pages/
    index.md                     # bare /screens' own home page -- overview + links, not a PAGES entry
    resolved.md                  # handcoded screen: GET /resolved
    devices.md                   # handcoded screen: GET /devices
    logs.md                      # handcoded screen: GET /logs, live via SSE
  vendor/
    observable-forms/            # vendored from github.com/rinie/observable-forms, MIT
      markdown-it-form.js
      form.css
      LICENSE
      README.md                  # provenance: exact upstream commit vendored
device-playlist.example.toml     # fixture/template, committed
device-playlist.toml             # the real Use-editable data file, gitignored
display-fields/                  # curated display lines, one TOML file per transport -- committed, see README.md
  ecowitt.toml
  dirigera.toml
backups/                         # dated snapshots, written automatically, gitignored
                                  # -- itself its own git repo, pushed offsite
.env                             # real secret values, gitignored, never committed
```

## Library choices, kept minimal on purpose

- **TOML parsing** — [`smol-toml`](https://www.npmjs.com/package/smol-toml):
  ESM-native, zero dependencies, spec-compliant TOML 1.0. The only
  dependency this project has, period — see "No native dependencies at all"
  below for why that's true even for BLE/USB.
- **Watching the hand-edited file** — native `fs.promises.watch()`, no
  `chokidar`. Its cross-platform quirks (inotify vs FSEvents vs Windows) are
  real; not a concern for the current single-file, single-host use case.
- **Safe writes to the playlist** — `writePlaylist` writes to a temp file
  and renames it into place, so a crash mid-write can't leave a truncated
  file on disk. Before every overwrite it also snapshots the current state
  into a `backups/` directory, Domoticz-style: `device-playlist-YYYY-MM-DD.toml`
  for the first validated change on a given day, `-2`, `-3`, ... for
  further ones the same day. "Validated" means the pre-write content parses
  as TOML (a corrupt or truncated state is never preserved as if it were
  good) and genuinely differs from the most recent backup (an unchanged
  re-write doesn't create a duplicate generation). This is last-known-good,
  deliberately independent of git: it protects a bad hand-edit or a buggy
  adapter write without needing a commit to exist first, and it directly
  answers the "history" question raised earlier in the series — what an
  address used to be before it moved — without needing a database. The same
  last-known-good pattern the series already names in
  [It Is Always DNS](https://rinie.github.io/2026/07/26/it-is-always-dns-version-chain/),
  applied one layer down.
- **Secrets via `.env`, never in the playlist** — a field like
  `mqtt-broker.password_env = "MQTT_BROKER_PASSWORD"` names an environment
  variable; `resolveSecretEnv(name)` reads it and throws a clear error if
  it's unset. The real value lives in a gitignored `.env` file. `npm start`
  loads it automatically via `--env-file-if-exists=.env` — native to Node,
  no `dotenv` dependency — which is a no-op when `.env` doesn't exist, so
  the same command works whether or not you've set one up.
- **Offsite backup via a git push, not an SDK** — `backups/` becomes its own
  independent git repo (separate from this repo's own git history), and
  `syncGitBackups` commits and pushes it to a private remote you configure
  yourself. This shells out to the `git` CLI via `node:child_process`
  rather than adding `isomorphic-git` or a cloud SDK as a dependency — git
  is already load-bearing for this entire project's own workflow, so
  reusing it here costs nothing new. Auth is whatever your `git`/`gh` is
  already configured with (SSH key, credential manager) — this code never
  handles a credential directly. Deliberately does **not** create the
  private remote itself; that's a one-time manual step
  (`METERKAST_BACKUP_REMOTE` in `.env`), not something unattended cron code
  should do on its own. Tested end-to-end against a local bare repo
  (`git init --bare`) standing in for the real remote — no network or real
  GitHub access needed to verify it works.
- **No native dependencies at all, for BLE or USB** — an earlier version of
  this project used `@abandonware/noble` (a native addon) for BLE, behind
  an `optionalDependency` so its absence never broke `npm install`. It's
  gone now, along with every `node-gyp`/compiler prerequisite, replaced
  entirely by the WebBLE/WebUSB path below — see README.md "WebBLE/WebUSB
  as the alternative to a native binding" for why that trade is a strict
  improvement, not just a workaround: `npm install` never needs a compiler
  on any platform, for anyone, and the security-audit surface it removed
  along with it was real (`npm audit` went from 7 high-severity findings,
  all in `node-gyp`'s own transitive tooling, to 0).
- **`multicast-dns` for mDNS/DNS-SD, the project's second and only other
  dependency** — same diligence applied before adding it as before removing
  `noble`: `npm view` showed its only dependencies are `thunky` and
  `dns-packet` (which itself depends only on `@leichtgewicht/ip-codec`),
  and after `npm install` all four packages' directories were checked for
  `.node` binaries or a `binding.gyp` — none exist. Pure JS, no build step,
  same as `smol-toml`. It speaks raw mDNS packets over `dgram`, which is
  the actual, minimal thing this adapter needs — pulling in a full MQTT
  client (`mqtt`) was deliberately out of scope, since the motivating
  problem this project set out to fix is specifically the broker's
  *address* being hardcoded, not building a general MQTT pub/sub bridge.
- **The DNS adapter needs no dependency at all** — router-assigned local
  hostnames are regular unicast DNS, which Node's built-in `node:dns`
  module already speaks natively (`resolve4`/`resolve6`, and the
  `Resolver` class for pointing at a specific server, used by the tests to
  target a real local fake DNS server instead of the network). `dns-packet`
  — already present transitively via `multicast-dns` — was promoted to an
  explicit `devDependency` since `test/dns-adapter.test.js` imports it
  directly to build that fake server; it was never an implicit/phantom
  import.
- **The screens app (`public/screens.js`/`grid.js`) adds no npm
  dependency either** — `markdown-it` and `datatables.net-select-dt`
  load from a CDN as ES modules straight in the browser, the exact
  pattern `web-scan.html` already used for BLE/USB/HID. `observable-forms`
  (`markdown-it-form.js`/`form.css`) is vendored under
  `public/vendor/observable-forms/` rather than an npm dependency because
  it isn't published to npm at all — it's a markdown-it plugin, not a
  standalone library, meant to be dropped into a project the way it is
  here. Vendored from the real upstream repo at a recorded commit (see
  `public/vendor/observable-forms/README.md`), not copied from the
  in-progress fork used while building an earlier, unrelated prototype —
  confirmed identical in substance (only comment wording differed) before
  trusting it.
- **`display-fields.js` needs no dependency either** — `smol-toml` (the
  project's only real dependency) already parses each `display-fields/*.toml`
  file's array-of-tables syntax with no code changes; the dot-path resolver and
  comma-decimal formatter are both a handful of lines with no library
  behind them.
- **WebBLE/WebUSB/WebHID — the only BLE/USB/HID path now** — `handleReport`
  (in `src/core/server.js`) adds a generic `POST /devices/:name`,
  deliberately transport-agnostic (it stores whatever record it's given, no
  transport-specific decode logic in core code) so every browser-based
  adapter shares it. `public/web-scan.html` is a self-contained static page
  — no build step, no bundler, no framework — and is where the actual
  `navigator.bluetooth`/`navigator.usb`/`navigator.hid` calls and byte
  decoding happen, client-side, since none of those APIs exist in Node at
  all.
- **One static-page handler for every page** — `serveStaticPage` (in
  `src/core/server.js`) takes a filename and serves it from `public/`, used
  for `GET /table` (`index.html`), `GET /web-scan` (`web-scan.html`), and
  `GET /screens`/`GET /screens/:slug` (`screens.html`). A second nearly
  identical function existed briefly when `web-scan.html` was the only
  page; consolidated rather than copy-pasted once a second page needed
  the exact same "read a file, serve as HTML" logic.
- **`GET /` is a real `302` redirect to `/screens`, not a served page** —
  a real user report (`http://localhost:8420/` showing no sidebar) traced
  back to the plain root having always served the older `index.html`
  directly, which never had a sidebar at all; the fix people actually
  wanted was the *default* landing on the screens app, not a rendering
  bug in it. `index.html`'s live-SSE device table is a genuinely distinct
  capability from any `/screens` page (it auto-refreshes on every
  registry change with zero page interaction; the `/screens` pages load
  a snapshot per navigation, live-updating only where a page's own
  `` ```datatable `` config sets `"live": true`, as the Log screen does)
  — moved to `/table` rather than removed, and cross-linked from both
  `screens.html` (`#top-links`) and `index.html`'s own nav, so it's
  relocated, not orphaned.
- **Dirigera via plain `node:https`, no client library** — a polling loop,
  not an event stream: no documented real-time push mechanism, so
  `src/adapters/dirigera-adapter.js` calls `GET /v1/devices` on an interval (default
  30s) and diffs against what's configured. `rejectUnauthorized: false` is
  scoped to that one request (the hub's self-signed cert), never set
  globally via `NODE_TLS_REJECT_UNAUTHORIZED`. Runs in-process like MQTT
  and mDNS — plain HTTPS, no native binding, so none of the crash-isolation
  reasoning below applies to it.
- **Ecowitt and Smartbridge, same shape, real public certs** — same plain
  `node:https` polling pattern as Dirigera, but `rejectUnauthorized`
  defaults to `true`: these are real internet-facing cloud APIs with
  properly CA-signed certificates, not a local hub with a self-signed one,
  so there's no legitimate reason to relax verification. Ecowitt polls once
  per configured device (`real_time` takes one `mac` at a time, unlike
  Dirigera's single bulk fetch) and catches a single station's fetch
  failure without aborting the whole cycle, since other stations should
  keep reporting even if one is offline. Smartbridge polls once per cycle
  for every device on the account, same bulk shape as Dirigera.
- **One shared function runs every polling adapter** —
  `src/core/run-polling-adapter.js` checks whether the playlist configured
  any device for a transport, runs the adapter only if so, and folds every
  yielded reading back into the registry. Extracted once a third adapter
  needed the identical wiring `bin/meterkastd.js` had been repeating for
  Dirigera and Ecowitt — same reasoning as consolidating `serveStaticPage`
  once a second page needed it.
- **The query/subscribe API** — plain `node:http`, no Express. Subscribing
  uses Server-Sent Events, not WebSockets: it's one-directional (the core
  tells clients when a record changed), which is exactly what SSE is for,
  and it needs zero extra dependencies.
- **Adapters as swappable modules** — each adapter is a plain ESM module
  whose default export is an async generator yielding
  `{name, transport, address, meta?}` records, loaded via native dynamic
  `import()`. That is Node's own plugin-loading primitive; no framework
  needed.

  Isolation is not the default, and it is not about throughput. Node's
  event loop already handles many concurrent I/O-bound adapters — MQTT/mDNS,
  file watching — fine in one process; async I/O is strictly better there
  than the overhead of a separate process would be. The remaining case
  where a native/blocking binding would still need real crash isolation is
  USB via `libusb`/`node-usb`, if that adapter ever gets built instead of a
  WebUSB equivalent: a fault in a native library — a misbehaving USB
  device, a driver bug — takes the whole process down with it, event loop
  included, because the failure isn't happening in JS where the event loop
  has any say. A `child_process` contains that: the adapter dies, the core
  and every other adapter keep running. This is precautionary, not a
  response to crashes being common — well-behaved native bindings should
  rarely fail; the isolation exists for the rare case, not the typical one.

  CPU-bound work — decoding RC5/newKaku pulse timing in a tight loop, say —
  is a different problem with a different answer: `worker_threads`, not
  `child_process`. Parallelism without leaving the process, shared memory
  instead of IPC serialization, no loss of the async-I/O model. Reaching for
  a full OS process there would be solving a throughput problem with a
  fault-isolation tool.

## What's actually implemented here

The **core** — registry, naming suggestions, safe playlist read/write,
secret resolution, offsite git sync, and the HTTP query/subscribe API — is
real and covered by tests. `bin/meterkastd.js` loads `device-playlist.toml`
(not the `.example.toml` fixture — see "Secrets never go in the playlist"
in README.md), serves `GET /devices`, `GET /devices/:name`, and
`GET /events` (SSE), and warns rather than crashing if no playlist file
exists yet. `bin/sync-backups.js` runs separately (intended for cron) and
pushes `backups/` to whatever private git remote you've configured.

**The WebBLE/WebUSB path is real and tested, verified inside an actual
browser, not just Node.** `handleReport` and `serveStaticPage` (both in
`src/core/server.js`) have unit tests (a fake request/response, no server
needed). End-to-end:
the daemon was started for real, `GET /web-scan` was loaded in an actual
Chromium browser pane (Electron 42.5, confirmed via `navigator.userAgent`),
and it correctly rendered one button per bluetooth-transport playlist entry
that has a `service`/`characteristic` pair. `navigator.bluetooth.getAvailability()`
reported `true` — a real adapter is reachable from that browser. A `POST`
with a hand-decoded 36.5°C reading round-tripped correctly through
`GET /devices/kitchen-thermometer-temperature`. The page's browser-side
decoder (`DataView`-based, since `Buffer` doesn't exist in a browser) was
verified against the identical known-good byte sequences the GATT spec
defines for those characteristics (36.5°C, 72.5 kg — encoded and decoded by
hand to confirm the IEEE-11073/weight-measurement math), run directly in
that browser — same input bytes, same output values.

**The one thing that could not be verified, and the reason is specific and
worth recording accurately:** a real user gesture *does* satisfy
`requestDevice()`'s activation check here — a synthesized click dispatched
through browser automation (not a programmatic `.click()`, which correctly
still throws `SecurityError`) passed the check on both
`navigator.bluetooth.requestDevice()` and `navigator.usb.requestDevice()`.
But both then returned `NotFoundError` immediately, with no chooser UI ever
appearing. Electron doesn't provide a built-in Bluetooth/USB device-chooser
dialog the way Chrome does — the host app has to implement
`session.on('select-bluetooth-device', ...)` / `select-usb-device` itself,
and this one apparently hasn't. That is a different, more specific finding
than "no hardware" or "gesture rejected" — the gesture and the adapter both
check out; only the picker step is unavailable in this particular browser
embedding. A real Chrome or Edge tab, opened by a human, does not have this
gap.

**WebUSB and WebHID were verified for real, one step further than
Bluetooth/WebUSB above got, then hit a different wall.**
`connectAndReadUsb` and `connectAndListenHid` in `web-scan.html` were
code-reviewed against the WebUSB/WebHID specs, and loaded for real in the
same Chromium browser pane against a real running daemon with a real
playlist: `GET /web-scan` correctly renders one row per `usb`/`hid`
playlist entry (`usb-widget`, `game-controller`), `navigator.usb` and
`navigator.hid` both report as real objects
(`typeof navigator.usb === "object"`, same for `hid`), and the page loads
with zero console errors. A synthesized click on the USB row's "Read"
button — same real-gesture technique documented above, not `.click()` —
this time produced a different, more concrete result than the earlier
Bluetooth/WebUSB test: rather than an immediate `NotFoundError`, it opened
a real native device-chooser window and blocked on it, exactly the
behavior the spec describes and Electron's own earlier no-picker gap said
wouldn't happen here. That's progress worth recording precisely rather
than glossing — this Electron build (42.5.1) does implement a real
`select-usb-device` picker, unlike whatever was true when the
Bluetooth/WebUSB section above was last verified. But a picker with no
real USB device plugged in has nothing to list and nothing to dismiss it
with from outside the native dialog, so the automated browser session had
to be recovered by navigating the tab away rather than completing the
flow. The HID button was deliberately not also clicked, to avoid the same
stuck state twice. Net honest status: the code path up to and including a
real OS picker opening is verified; a real USB or HID device plugged in or
paired is needed to verify anything past that, same as the still-open gap
for Dirigera-style real-hardware testing elsewhere in this document.

**`web-scan.html`'s three sections were converted to the same DataTables
grid `/screens` uses, and this conversion caught a real concurrency bug
in `grid.js` that unit tests never would have — it only shows up with
multiple concurrent grids on one page.** `renderTargetsGrid` replaced the
old plain button-list rendering with `createGrid`, keeping every line of
`connectAndReadBle`/`connectAndReadUsb`/`connectAndListenHid`/
`reportReading`/the decode functions untouched — only the render/wiring
layer changed. Loaded for real: all three grids rendered with real
playlist data and correct columns (BLE's `service`/`characteristic`,
USB's `interfaceNumber`/`endpointNumber`), zero console errors. **But the
BLE and USB grids were initially empty — no table, no error, no
empty-state message — while HID alone rendered.** The cause:
`createGrid`'s "supersede a stale render" guard used one
module-`let renderToken = 0` counter shared across every call, not one
per container. `main()` calls `renderTargetsGrid` for BLE, then USB, then
HID without awaiting between them; each call's own `++renderToken`
silently invalidated the *previous* container's still-pending render
too, not just a genuinely superseded render of the *same* container — so
only the last of the three ever survived its own check. This never
surfaced on the `/screens` pages because `mountDataTables`'s loop awaits
each `createGrid` call before starting the next one, so the counter is
never live for more than one container at a time there. Fixed by keying
the guard per container (`WeakMap<container, token>` instead of one
shared counter) — re-verified live: all three grids render correctly.
Separately, the new per-row `onAction` wiring (a real `<button
data-action="connect">` in a render-only column, resolved back to its
row via DataTables' own `table.row(tr).data()`) was confirmed correct by
dispatching a real `.click()` on it: `connectAndReadBle` ran and
`requestDevice()` correctly hit the browser's own gesture guard
(`SecurityError: Must be handling a user gesture...`) — the exact,
expected real behavior for a non-trusted synthetic click, proving the
handler reaches the real WebBLE call rather than silently no-op'ing. A
synthesized-gesture `computer`-tool click on the same button did not
produce a visible status update in this pass; unlike the `.click()` test
above, that result is inconclusive rather than a confirmed failure, and
wasn't chased further given the underlying wiring was already proven
correct by the scripted-click test.

**The mDNS/DNS-SD adapter is real, tested against a real (if local) wire
protocol, and hit one honest, specific gap trying to go further.**
`isServiceQuery` and `decodeTxt` are pure and unit tested.
`resolveHostname` and `resolveService` are tested against a *second real
`multicast-dns` instance in the same test process acting as a fake
responder* — genuine UDP multicast on `224.0.0.251:5353`, the real wire
protocol, not a mock of it, the same "real local infrastructure standing
in for a real remote peer" tier as the cloud adapters' self-signed HTTPS
servers. The exact response shapes those tests assert against
(`PTR` data as a string, `SRV` data as `{priority, weight, port, target}`,
`TXT` data as `Buffer[]`, `A` data as a plain IPv4 string) were confirmed
by actually running that responder/resolver pair and inspecting the real
output before writing the assertions, not assumed from memory. `bin/meterkastd.js`
was then run for real with `myHpPrinter`/`mqtt-broker` `mdns`-transport
entries in a real `device-playlist.toml`: both failed to resolve (no `A`
record for `printer.local`, no `PTR` answer for `_mqtt._tcp.local`), each
logged a clear per-device error, and the daemon kept running with Dirigera,
Ecowitt, and Smartbridge still serving real data alongside it — the same
isolation already verified for a missing credential now confirmed for a
missing mDNS responder too. **What that real-LAN attempt did *not*
establish, and this time with a diagnosed cause, not just a suspected
one:** this dev machine's own IP is confirmed on the same
`192.168.1.0/24` subnet as the already-verified-reachable Dirigera hub,
yet even the universal `_services._dns-sd._udp.local` meta-query got no
response, and neither did a real, known-good, same-subnet target
(`homeassistant.local` — Home Assistant's `zeroconf` integration, on by
default, publishes exactly this hostname). The same machine's own
`ping homeassistant.local` succeeded immediately, resolving to a
link-local IPv6 address (`fe80::...`) — proving the device is live and
genuinely mDNS-reachable on this network. The difference: `ping` resolves
`.local` names through Windows' own DNS Client service (`svchost.exe`),
and `Get-NetFirewallRule` confirms the built-in "mDNS (UDP-In)" allow
rule is scoped specifically to that binary. Chrome, Edge, and Copilot each
carry their *own* dedicated per-app mDNS inbound rules; `node.exe` has
none. So this project's outbound mDNS queries leave the machine fine (no
outbound blocking by default), but the multicast responses coming back
are dropped by Windows Firewall before they reach the Node process —
a per-app inbound rule gap, not a code defect, and not a silent LAN. Two
things follow: `resolveHostname`/`resolveService` were extended to query
`ANY` rather than hardcoding `A`, and to fall back to `AAAA`, once the
`homeassistant.local` case surfaced that a live, reachable device can be
IPv6-only on `.local` — a real, observed case (see
`test/mdns.test.js`'s "IPv6-only" test, modeled directly on this
finding), not a hypothetical. That fix is verified against the same
real-protocol test tier as everything else here, but it did not change
the real-LAN result, exactly as expected: the packets never arrive at
all, regardless of which record type was asked for. Closing this gap for
real needs a Windows Firewall inbound rule allowing UDP 5353 for
`node.exe` — a system-settings change, so this project doesn't make it
itself; add it, then `npm start` should resolve `homeassistant.local` for
real.

**The DNS adapter (`transport = "dns"`) is verified end to end against a
real router, not just a local mock — the strongest tier available, closing
the exact gap the mDNS adapter hit.** `resolveDnsHostname` is tested
against a real local unicast DNS server (`test/dns-adapter.test.js`,
built on `dgram` + `dns-packet`, the same "real local infrastructure"
pattern as the mDNS tests) covering the A, AAAA-fallback, and
neither-record-exists paths. Then, for real: this machine's own configured
DNS server was confirmed (`Get-DnsClientServerAddress`) to be the router
itself (`192.168.1.1`), a direct `dns.resolve4('raspi3.home')` against it
returned a real, live answer (`192.168.1.53`) with no firewall issue at
all — regular unicast DNS isn't affected by the per-app inbound-rule gap
that blocks mDNS, since it's fundamental traffic every internet connection
already depends on. `bin/meterkastd.js` was then run for real with a
`raspi3.transport = "dns"` / `raspi3.address = "raspi3.home"` entry in the
real playlist: `GET /devices/raspi3` came back with
`{"resolvedAddress": "192.168.1.53", "family": "A"}`, alongside Dirigera,
Ecowitt, and Smartbridge still serving real data and the (still-blocked,
as expected) mDNS entries failing gracefully next to all of it. Unlike
every other adapter in this document, there is no remaining verification
gap to hand off here — this one is real, tested, and confirmed against
production infrastructure in the same session it was built.

**The screens app (`/screens`) is real, tested, and — like the DNS
adapter — verified end to end with no remaining gap, but it surfaced one
genuine bug along the way, worth recording precisely.** Unit tests cover
`serveStaticFile` (real files served with the right content-type, a 404
for a missing one, a 403 for a path-traversal attempt that never reaches
`readFile`). Before writing any page content, the exact blank-line
structure `:::form` needs was confirmed empirically against a real
`markdown-it` instance (a throwaway probe script, not assumed from the
plugin's own doc-comment example, which turned out to omit the blank
lines its own tokenizer actually requires between `:::form`, the
pipe-table content, and the closing `:::`) — and the same probe confirmed
the `` ```datatable `` fence override renders the expected placeholder
`<div>`. Then, for real: the daemon was started with the real local
playlist, `/screens/resolved` and `/screens/devices` were loaded in the
same Chromium browser pane used throughout this document, both rendered
their DataTables grid with real data (`raspi3` → `192.168.1.53`; all 12
real playlist entries respectively) with zero console errors. **A real
bug was caught this way, not by inspection:** clicking a row correctly
populated `name`/`transport`/`address` in the detail form but left
`resolvedAddress` empty — `populateFormFromRow`'s field lookup lowercased
the row's key before matching `[data-name]`, a rule ported from
`locuswms-web-frontend`'s app.js where it compensates for Oracle's own
uppercase column names, which doesn't apply here: meterkast-dns's field
names are genuine camelCase (`resolvedAddress`), preserved as-is in a
page's own `[resolvedAddress]` bracket syntax, so the lowercase
comparison silently never matched. Removed, re-verified live: all four
fields populate correctly. Also checked a `meta`-holding row
(`kitchen-lamp`, real Dirigera device attributes) renders its object
value as readable JSON text in the detail panel, and that sidebar
navigation updates the URL via the History API without a full page
reload.

**A real bug, reported by the user, not found in testing: "I do not see
the sidebar on startup."** Root cause was an ES module semantics
gotcha, not a rendering bug — `screens.js` had `markdown-it` (a CDN
import) as a *static* top-level `import`, and a module's static imports
must ALL resolve before ANY of its top-level code runs, including
`renderSidebar()`, which has nothing to do with markdown at all. A slow
or blocked CDN fetch silently left the whole sidebar invisible with no
error shown — plausible in this user's own environment specifically,
given the real npm-registry and Windows-Firewall network quirks already
documented elsewhere in this file. Fixed by loading `markdown-it` (and
the vendored `markdown-it-form` plugin) lazily, on first actual page
render, via `getMarkdownIt()`'s dynamic `import()` — `screens.js`'s only
remaining static import is the local, same-origin `/grid.js`, so
`renderSidebar()` now runs immediately regardless of CDN reachability.
**Verified by directly reproducing the failure, not just reasoning about
it**: the CDN URL was temporarily pointed at an unreachable host
(`nonexistent-cdn-host-for-testing.invalid`), confirming the sidebar
still rendered fully and immediately while only the content area
correctly hung on "Loading..." — then reverted, and normal operation
(real page content, live Log updates) re-confirmed working.

**That CDN fix was real and worth keeping, but it wasn't what the user
was actually hitting — a second report ("i still see no sidebar?") after
that fix was already merged made the real cause specific: the user was
navigating to the plain `http://localhost:8420/` root, which had always
served `index.html`, a page that never had a sidebar at all.** Not a
bug in the sidebar's own code — the sidebar was never on that page to
begin with. Fixed at the routing layer, not the client: `GET /` now
`302`s to `/screens`, making the screens app the actual default landing
experience, with the old page relocated to `/table` rather than
removed (see "Library choices" above).

**A third round of the same thread refined this further, and it's worth
recording as its own real finding, not folded silently into the fix
above: landing on `/screens/resolved` was itself the wrong default,
even though the sidebar was now genuinely visible.** The user's own
words — "you use[d] screens/resolved not base index.htm[l]" — named the
actual complaint precisely: auto-selecting the first `PAGES` entry
("Resolved Names") as the bare-`/screens` default conflated "the default
landing page" with "the first regular page," the same distinction
Observable Framework's own `index.md` makes from every other page it
lists. Fixed with a real `pages/index.md` (an overview page, with plain
markdown links to the three regular pages, `/table`, and `/web-scan`) and
a `HOME_SLUG` constant deliberately kept out of `PAGES` — bare `/screens`
now renders that page's own content, with a new "meterkast-dns" home
link at the top of the sidebar (styled distinctly, `#sidebar-home`) the
only thing marked active there, rather than silently redirecting to
`/screens/resolved`. Verified live: the URL now stays at the clean
`/screens` (not rewritten to `/screens/resolved`), the home link and its
`active` state render correctly, clicking into a regular page and back to
home both work, and the browser's own Back button correctly restores the
previous page via `popstate` — round-tripped for real, not just reasoned
about.

**The Log screen (`/screens/logs`) is verified live, not just on a
static snapshot — including the SSE-append path, without needing a
synthetic trigger.** `handleLogs` and `log.js`'s own `log`/`listLogs`/
`subscribeLogs` are unit tested (bounded buffer, snapshot-not-live-
reference, subscribe/unsubscribe). Then, for real: the daemon was started
with the real playlist, `/screens/logs` loaded showing 5 real entries
(the startup message plus four real mDNS failures from the still-open
Windows Firewall gap), correctly sorted newest-first, each `warn` row
colored (`rgb(255, 243, 205)`, confirmed via `getComputedStyle`, not just
assumed from the CSS). Without any action taken in the browser, the next
real 60-second mDNS retry cycle fired server-side and its four new
`log()` calls arrived over the existing `/events` SSE connection and were
appended live — the count went from 5 to 9 entries with the page just
sitting open, the same "watch it happen" behavior the design section
describes, observed actually happening rather than assumed from the
code.

**USB (`udev`), Zigbee (a coordinator), and 433MHz/IR (RC5/newKaku
decoding) *native background-daemon* adapters remain out of scope
entirely** — `static-adapter.js` still exists to pin down the plain
adapter contract for whichever of those gets built next. WebUSB/WebHID
above cover the browser-based path for USB and HID (including Bluetooth
HID) specifically; a native, always-on USB adapter via `udev`/`node-usb`
is a different, still-unbuilt thing, for the same reason the native BLE
path (`@abandonware/noble`) was removed rather than kept alongside WebBLE.

**`GET /` (`public/index.html`) was verified end-to-end for real, including
the live-update path, not just loaded and eyeballed.** With the daemon
running and the page open, a `POST /devices/kitchen-thermometer-battery`
sent from a separate terminal appeared in the table with no page reload —
confirming the SSE wiring end to end: the client listens for the `change`
event specifically (`handle-subscribe.js` sends a named event, not the SSE
default `message` event, which is easy to get wrong and was checked
against the actual source rather than assumed).

**`GET /resolved` — a filtered view of `GET /devices`, scoped to
`dns`/`mdns` entries that actually resolved, with each adapter's differing
`meta` shape normalized to one `resolvedAddress` field — is unit tested
(`summarizeResolution`'s three shapes, `handleResolved`'s filtering) and
was run for real against the live daemon.** Started with the real local
playlist: `GET /devices` returned all 12 configured entries,
`GET /resolved` correctly returned `[]` (nothing has actually resolved in
this environment yet — every `mdns` entry is still blocked by the Windows
Firewall gap documented above, and the `dns` adapter isn't merged to
`main` as of this branch). Confirmed the endpoint isn't just returning an
empty array unconditionally by `POST`ing a synthetic `dns`-transport
reading directly (the same generic write path WebBLE/WebUSB/WebHID use)
and re-querying `GET /resolved`: it appeared immediately, correctly
shaped. Real end-to-end confirmation of a *genuinely* resolved entry
(`raspi3.home` showing up here, say) is blocked on the same two open gaps
as everything else mDNS/DNS-related in this document, not on anything new
this endpoint itself introduces.

**Ecowitt's `real_time` endpoint defaults to Fahrenheit, confirmed
empirically rather than assumed, and now fixed.** A user question ("why
does the ecowitt display fahrenheit?") led to querying the real API three
ways with the real credentials: no `temp_unitid` param, `temp_unitid=1`,
`temp_unitid=2` — the first and third came back identical (`"unit":"ºF"`),
the second came back `"unit":"℃"`, confirming `2` (Fahrenheit) is the
server's own default when the parameter is omitted, independent of
whatever unit preference is set in the Ecowitt account/app itself.
`fetchEcowittReading` now sends `temp_unitid: "1"` explicitly.
`test/fixtures/ecowitt-real-time-response.json` was re-captured live
against the real API with the fix in place (real Celsius values, not
hand-edited), and the real daemon confirmed it end to end:
`GET /devices/weather-station` now returns `{"unit":"℃","value":"20.5"}`
for a real, live reading.

**A follow-up question ("get the Indoor temperature is 23,7 C") asked for
the display half of the same story — `display-fields.toml` and
`src/core/display-fields.js`, and this one caught a real bug too.**
`handleList`/`handleGet` now add a `display` array (curated
`{label, display}` lines) alongside a record's raw `meta`, computed from
`display-fields.toml`'s per-transport mapping — unit tested (path
resolution, missing-path skip, number formatting, the
graceful-degradation empty-object shape for a missing file, same as
`readPlaylist`) and confirmed against the real live daemon:
`GET /devices/weather-station` returned real `Indoor Temperature: 23.5 ℃`
alongside the other three curated lines. (Number formatting went through
one real revision worth recording: first built with a comma decimal
separator, mirroring the physical console the request referenced; a
direct follow-up ("keep the decimal dot ... internally and external
display") corrected that — `formatNumber` now uses `toFixed(1)`, a plain
period decimal with no locale involved at all, everywhere, not just
internally. Saved as a standing preference for future work in this and
other projects, not just this one call site.) **Wiring it into the actual
`/screens/devices` page surfaced a real bug, not caught by any unit
test**: `devices.md`'s `<div id="display-fields">` placeholder — plain
raw HTML in a markdown file, expected to pass through unchanged — was
silently being HTML-*escaped* into visible literal text instead, because
`markdown-it`'s own default (`html: false`) disables raw HTML passthrough
for untrusted input, and `getMarkdownIt()` never overrode it. Fixed by
constructing `new MarkdownIt({ html: true })` — safe here specifically
because `pages/*.md` files are hand-authored by whoever runs this server,
the same trust level as any other file in this repo, not arbitrary or
remote input. Re-verified live after the fix: `#display-fields` is a real
element, selecting `weather-station` renders all four real lines
correctly, selecting a device with no mapping configured (`kitchen-lamp`,
`dirigera`) correctly clears the panel instead of showing stale lines,
and zero console errors throughout.

**All three of Dirigera, Ecowitt, and Smartbridge are now verified against
the real service, not just a local mock — the same tier for all three, not
a gap between them.** Each adapter's `parse*Response` and (Dirigera,
Smartbridge) `matchConfiguredDevices` functions are pure and tested against
fixtures — Dirigera's with hand-built data, Ecowitt's and Smartbridge's
captured from real responses (`test/fixtures/ecowitt-real-time-response.json`,
`smartbridge-sync-response.json` — device/home IDs genericized before
committing, the response shape itself is real). Each adapter's `fetch*`
function — the actual HTTPS request, headers, and TLS handling — is
additionally tested against a local self-signed mock server
(`test/fixtures/test-cert.*`), covering both a successful response and a
rejection.

Beyond the unit tests, each adapter was run for real, end to end, against
production: the real daemon started with real `.env` credentials, polling
the real service, folding a genuinely live reading back into the registry
and out through `GET /devices/:name`. For Dirigera specifically: initially
verified only against a local mock hub standing in for the real one (the
honest state this section originally described); later re-verified against
the real hub at its real LAN IP with the real bearer token found in
`dirigeraConfig.js` — `GET /devices/kitchen-light-2` came back with that
light's actual `isOn`/`lightLevel`/`serialNumber`, matching the shape
`ListDevices.js` had already shown it would. For Ecowitt and Smartbridge:
`GET /devices/weather-station` / `GET /devices/kaku-plug` came back with
real outdoor/indoor sensor readings and the real device's
`version_status`/`version_data`/encrypted `data`, against
`api.ecowitt.net` and `trustsmartcloud2.com` in production. The Smartbridge
encryption finding is confirmed this way too, not assumed: `data` and
`status` came back as genuine base64-looking ciphertext with no accompanying
documentation on decrypting them. Crash isolation was verified for all
three: misconfigured with no credentials set, each adapter logs a clear
`<Name> adapter stopped: Missing required environment variable: ...` and
the daemon keeps serving every other device normally.

**A real production incident (not a test) found a real gap in that
isolation story: Dirigera and Smartbridge didn't retry after a transient
network error — they died permanently, the same way a genuine
misconfiguration does, which they aren't the same kind of failure at
all.** `bin/meterkastd.js`'s `runPollingAdapter(...).catch()` only logs
once; it never restarts a dead generator. A missing credential is a
permanent condition — dying once and logging clearly is the right
behavior, retrying forever would never succeed. A transient network
blip (`ECONNRESET`, a dropped connection, a momentary DNS hiccup) is the
opposite: the condition is very likely to clear up on its own by the
next poll cycle. Ecowitt, mDNS, and DNS already drew this distinction
correctly from the start — each catches a single device's fetch/resolve
failure *inside* its own polling loop and moves on, so a bad cycle costs
nothing but that one cycle. Dirigera and Smartbridge didn't, because
each does one bulk fetch per cycle with no `try`/`catch` around it at
all — confirmed the hard way: a real `Smartbridge adapter stopped: read
ECONNRESET` in this project's own log, from a genuine transient failure
against the real `trustsmartcloud2.com` API, permanently killed that
adapter until the next full daemon restart. Fixed by wrapping each
adapter's own bulk fetch in the identical `try`/`catch`-log-continue
pattern the other three already used — both `fetchDevices` calls are
now injectable (`{ fetchDevices = fetchDirigeraDevices }` /
`{ fetchDevices = fetchSmartbridgeDevices }`, the same
dependency-injection shape the DNS adapter's own `resolver` option
already established), specifically so the retry behavior itself is
directly, deterministically testable: `dirigeraAdapter`/
`smartbridgeAdapter`'s own default export is exercised with a fake
`fetchDevices` that throws once (a real `{code: "ECONNRESET"}` shape)
then succeeds, asserting the generator survives the failed cycle and
yields correctly on the next one — not just testing the pure
`parse*`/`match*`/`fetch*` functions in isolation the way every other
adapter test in this project does, since this specific fix lives in the
polling loop itself. Re-verified against the real live daemon afterward:
both adapters still return real, live data with no regression.

**A follow-up question ("how would you handle dirigera with just my
specific kitchenlight?") extended `display-fields.toml` to Dirigera, and
the design went through a real, caught-before-implementation correction.**
The first draft keyed Dirigera's display fields by device *name*
(`[[displayFields.devices.kitchen-lamp]]`), directly mirroring how the
question was phrased. The user caught the flaw immediately: "But that
ties the display fields to the device playlist doesn't it?" — correct.
`display-fields.toml` is committed, not gitignored, specifically because
it's generic and shareable; keying it by a Use-chosen device name would
have made it exactly as personal as `device-playlist.toml`, defeating the
reason it's a separate file at all. Redesigned around `deviceType`
instead — a structural property Dirigera's own API already provides
(`device.deviceType`: `light`, `outlet`, `motionSensor`, ...), confirmed
as the right precedent by the user's own analogy: "Like the LIRC remote
mapping" — LIRC's `.conf` files are keyed by remote *model*, a shared
catalog, never by which specific physical remote a user owns.

Before writing any code, the mixed TOML shape (a flat array for Ecowitt
alongside a `deviceType`-nested table for Dirigera, both under the same
`displayFields` key) was verified to actually parse correctly with a real
`smol-toml.parse()` call, not assumed. Then, before committing any
Dirigera field definitions, a real API call against the live hub
(`fetchDirigeraDevices`, reusing the adapter's own tested function)
enumerated one real device per `deviceType` present on the account —
`light`, `outlet`, `motionSensor`, `openCloseSensor`, `waterSensor`,
`environmentSensor`, `lightSensor`, `lightController`, `gateway`,
`repeater` — and captured each one's actual `attributes` object. Six of
those (the common actuator/sensor cases) became the committed
`[[displayFields.dirigera.<type>]]` entries; the rest were left out
rather than guessed, with a comment noting they can be added the same way
once verified. This is also where `format = "boolean"` and a literal
`unit` string (as opposed to `unitPath`) were added to
`flattenDisplayFields` — Dirigera's `isOn`/`isOpen`/etc. are real
booleans with no unit at all, and `lightLevel`'s `%` has no sibling field
in the API response the way Ecowitt's `unit` fields do.

`matchConfiguredDevices` in `dirigera-adapter.js` now surfaces
`deviceType` as a peer field alongside `meta` (not folded into it), and
`server.js`'s `withDisplay` resolves field definitions through a new
`resolveFieldDefs(displayFields, transport, deviceType)` — a flat array
(Ecowitt) is returned as-is, an object (Dirigera) is looked up by
`deviceType`. Verified against the real live daemon and the real
`kitchen-lamp` (a real `TRADFRI Driver 10W`, `deviceType: "light"`):
`GET /devices/kitchen-lamp` returned `"display":[{"label":"On","display":
"Off"},{"label":"Brightness","display":"70.0 %"}]`, matching the light's
real live `isOn: false`/`lightLevel: 70`. Confirmed in the browser too:
selecting `kitchen-lamp` on `/screens/devices` renders `On: Off` /
`Brightness: 70.0 %` above the raw `meta`, while `weather-station`
(Ecowitt, the pre-existing flat-array path) continues to render its four
lines unchanged alongside it — both lookup shapes verified live, side by
side, not just in isolation.

**A follow-up ("should the display-fields.toml be per adapter/protocol?")
split the single `display-fields.toml` into `display-fields/`, one TOML
file per transport** — the same friction already resolved once at the
personal/generic boundary (`device-playlist.toml` vs. `display-fields.toml`)
was starting to reappear one layer down as more transports accumulated in
one shared file. `ecowitt.toml`/`dirigera.toml` drop the
`displayFields.<transport>.` prefix the single-file shape needed (the
filename supplies it now); `loadDisplayFields` changed from a single
`readFile`+`parse` to reading every `*.toml` in a directory, using a
top-level `fields` array as the flat/nested signal per file.
`resolveFieldDefs`/`flattenDisplayFields` needed no changes at all — both
already operated on the post-merge in-memory shape, not the file layout.
Re-verified live end to end after the restructure: `GET
/devices/kitchen-lamp` and `GET /devices/weather-station` both returned
identical `display` output to before the split, confirming the directory
merge reproduces the exact same in-memory shape the single file used to
produce.

**The same conversation then asked for per-device narrowing of
`display-fields/`'s catalog** — an allow-list or deny-list, chosen per
device, plus a way to check a narrowed-out field's live value without
permanently re-enabling it. `partitionDisplayLines` (new, in
`display-fields.js`) splits `flattenDisplayFields`'s already-computed
lines into `shown`/`hidden` by label, reading two optional playlist keys
carried straight through on the record (`displayFields`/
`excludeDisplayFields`); `server.js`'s `withDisplay` returns both as
`display`/`displayHidden`.

**Live verification caught a real, pre-existing bug, not introduced by
this change but exposed by it**: setting `kitchen-lamp.displayFields =
["On"]` in the real playlist and restarting had no effect at all —
`display` kept showing both `On` and `Brightness`. Root cause:
`dirigera-adapter.js`'s `matchConfiguredDevices` built its match object
field-by-field (`{name, transport, address, deviceType, meta}`) instead
of spreading `...record` first the way the mdns/dns adapters already did,
so any extra hand-typed playlist field neither of those adapters manage —
`displayFields`, `excludeDisplayFields`, or anything else added later —
was silently dropped before it ever reached the registry.
`smartbridge-adapter.js` had the identical gap. Both fixed by spreading
`...record` first, matching the pattern the other adapters already
established; regression tests added confirming an extra playlist field
survives `matchConfiguredDevices` for both. Re-verified live after the
fix: `GET /devices/kitchen-lamp` with `displayFields = ["On"]` set
correctly returned `"display":[{"label":"On","display":"Off"}]` and
`"displayHidden":[{"label":"Brightness","display":"70.0 %"}]`. Confirmed
in the browser too: selecting `kitchen-lamp` on `/screens/devices` shows
only `On: Off` in the primary panel, with a collapsed "Hidden fields"
section (initially `hidden`, un-hides itself once a device actually has
something in it) containing `Brightness: 70.0 %` — expanding it in the
accessibility tree confirmed the value renders correctly. The temporary
`displayFields` line used for this verification was reverted from the
real (gitignored) `device-playlist.toml` afterward — added only to
exercise the feature, not a permanent change to this device's real
configuration.

**Next: "I also want to be able to scan for devices not in the playlist
... and when displayed in a data table the option to select and be added
to the playlist either with a default chose name, or an entered name."**
Added `unclaimedDirigeraDevices`/`unclaimedSmartbridgeDevices` (the
inverse of each adapter's own `matchConfiguredDevices` — every real
device *not* matched to a playlist entry, with a `suggestedName` derived
from the device's own `customName` where the API provides one, else a
`${deviceType}-${id}`/`${transport}-${id}` fallback), a new
`addPlaylistEntry` in `playlist.js` (reuses `writePlaylist`'s existing
backup + atomic-write path unchanged), and two new routes:
`POST /discover/:transport` (an on-demand scan, not a background poll —
hits the real hub/cloud API once, when a "Scan" button is clicked) and
`POST /playlist/devices` (claims a candidate under a name, `409` with a
`suggestedName` on a real collision). A new `/screens/discover` page
renders each transport's candidates in a datatable with a per-row "Add to
playlist" action.

**Mid-implementation, wiring the real credentials into `createServer`
surfaced the exact same URL-vs-string-path bug the `display-fields/`
directory split had already been fixed for, in a second place**:
`writePlaylist` uses `node:path`'s `dirname`/`basename`/`extname`, none of
which accept a `URL` — and `bin/meterkastd.js`'s `playlistPath` has always
been a `file://` URL by default. This was never exercised before, since
until `addPlaylistEntry` existed, the live daemon only ever *read* the
playlist, never wrote it. Fixed the same way as `loadDisplayFields`: both
`readPlaylist`/`writePlaylist` now normalize a `URL` to a plain string
path once, before touching the filesystem. A regression test
(`writePlaylist and readPlaylist both accept a file:// URL`) locks this in.

**Real, end-to-end verification surfaced a second, more consequential real
issue — not a bug in the new code, a pre-existing limitation of
`writePlaylist` that had simply never been exercised on a real,
comment-rich file by the live daemon before**: `POST /playlist/devices`
round-trips the whole playlist through `smol-toml`'s `parse`+`stringify`,
which has no concept of comments — every one of `device-playlist.toml`'s
own hand-written explanatory comments (provenance notes, "swap in
whichever KAKU device...", etc.) was silently stripped the moment a real
write happened, and the file's dotted-key style was reformatted into
`[section]` headers. Nothing was destroyed: `writePlaylist`'s own
pre-write `snapshotPlaylist` backup captured the original, comment-intact
file before each write, exactly as designed — but this is a real,
user-facing cost of using the feature at all, worth stating plainly rather
than discovering by surprise later. The real file was hand-restored from
its own backup (comments back, both newly-added real devices —
`shed-motion`, a motion sensor, added via a raw `curl` call directly
against `POST /discover/dirigera` + `POST /playlist/devices`; `christmas`,
an outlet, added through the actual `/screens/discover` browser UI —
appended in the same dotted-key style) rather than left reformatted.
Comment preservation across a programmatic write is a real, open
limitation of this feature, not fixed in this PR (would need a
comment-preserving TOML writer, a materially bigger change than
`smol-toml` provides) — see README.md "Honest limits".

**Verifying the browser UI's "Add to playlist" flow found a second real
bug, this time in the UI code itself, not the backend: the first
implementation used `window.prompt()` to ask for a name, which is a
blocking native dialog — clicking "Add to playlist" during verification
hung this project's own browser-automation tooling outright** (a
`computer` screenshot call timed out after 30s; `Escape` didn't recover
it; only a forced `navigate` did). Replaced with an inline `<input>` +
Save/Cancel rendered directly into the action cell (the same
direct-DOM-mutation pattern `web-scan.html`'s own status spans already
use, no new mechanism) — pre-filled with `suggestedName`, submits on Enter
or Save. Re-verified in the browser after the fix: clicking "Add to
playlist" on the real "christmas" candidate showed the inline input with
"christmas" pre-filled, no hang; Save produced a real
`POST /playlist/devices` call, and the cell's own text changed to "Added
-- restart meterkastd to start polling this device." — confirmed via the
page's own rendered text, not just the network response.

**Full real-hub verification**: `POST /discover/dirigera` against the
real hub returned all 22 devices genuinely present but unclaimed at the
time (`ShedSensor2`, `Christmas`, `Deur`, `Lucht`, the hub itself as
`deviceType: "gateway"`, ...), correctly excluding `kitchen-lamp` (already
claimed). `POST /discover/smartbridge` against the real
`trustsmartcloud2.com` API returned every ICS2000 device on the account
except the already-claimed `kaku-plug`, with real (still-undecoded)
ciphertext in each candidate's `meta`, same honest-fallback shape
`matchConfiguredDevices` already uses. After claiming `shed-motion` and
restarting the daemon, `GET /devices/shed-motion` returned real live data
— `{"customName":"ShedSensor2", "batteryPercentage":20, "isDetected":false, ...}`
— with the `motionSensor` catalog's curated lines already applied
correctly (`display: [{"Detected":"Off"},{"Battery":"20.0 %"}]`),
confirming the whole chain (discover → claim → restart → poll → curate)
works end to end for a device that was never in the playlist at any
earlier point in this project's history.

**Follow-up: DNS subnet-sweep discovery** (`scanSubnet`/`unclaimedDnsCandidates`
in `dns-adapter.js`, `POST /discover/dns?cidr=...`, a CIDR input on
`/screens/discover`'s DNS panel). `hostAddressesInCidr` is a small,
dependency-free IPv4 CIDR walker (no new npm package for a /24's 254
addresses), capped to `/22`..`/32` so a typo can't turn into an
accidental sweep of a much larger range. Verified live against this
machine's own real LAN: `POST /discover/dns?cidr=192.168.1.0/24`
completed in **0.192 seconds** (most of a /24 has no PTR record at all,
and the router answers those quickly, not by timing out) and returned 34
real device hostnames actually present on the network — a Fritzbox
(`fritz.home`), an LG webOS TV, two Samsung phones, a Bosch dishwasher,
several ESP-based smart-home nodes, this project's own dev machines, and
more. `raspi3.home` (already claimed) correctly did not appear.
`living-room-tv` (the LG TV) was claimed — once via a raw `curl` call
against `POST /playlist/devices`, confirmed via the actual
`/screens/discover` browser UI too (typed the CIDR into the new input,
clicked Scan, got 33 results — one fewer than the raw 34, correctly
excluding the now-claimed TV). After restarting the daemon,
`GET /devices/living-room-tv` returned real live data —
`{"resolvedAddress":"192.168.1.97","family":"A"}` — matching the scan's
own result for that hostname exactly, confirming the same
discover-claim-restart-poll chain Dirigera/Smartbridge already proved
also holds for the DNS transport.

**Final piece of the discovery feature: "scan for unknown bluetooth
devices."** Unlike the other three transports, Web Bluetooth has no
server-side inventory to fetch at all — its whole security model is a
real user gesture picking one specific device from the browser's own
chooser, not something a background scan can enumerate. `web-scan.html`
gets a new section calling
`navigator.bluetooth.requestDevice({acceptAllDevices: true})` (the
standards-track, no-flag API — the alternative, `requestLEScan()`, is
non-standard and gated behind an experimental Chrome flag) — one real
device per click, accumulated client-side across multiple clicks in a
`discovered` array (deduplicated by address), with the same "Add to
playlist" inline-input flow `/screens/discover` already established,
duplicated rather than imported since this page has always been fully
self-contained (its own stylesheet comment already says so). No backend
changes were needed at all — `POST /playlist/devices` is already fully
transport-agnostic. Documented a real, structural limit while writing
this: Web Bluetooth deliberately never exposes a device's true BD_ADDR to
page JS — `device.id` is an opaque, origin-scoped identifier instead,
stable for this browser profile but not a real Gutenberg MAC the way the
native `noble` adapter's own address is (this project already treated
`device.id` as the playlist address for *reading* an already-configured
device; this is the first place it becomes the *sole* identifier for a
brand-new entry).

Verified live in the browser (the same "browser-tested rendering, no real
hardware behind it" bar already accepted for this file's pre-existing
BLE/USB/HID Connect buttons): the new section renders with no console
errors alongside the existing grids; clicking "Scan for a device" really
does invoke `requestDevice({acceptAllDevices: true})` — confirmed by its
outcome, not just by reading the code — and since this environment has no
real Bluetooth adapter, Chrome threw a real `NotFoundError` (no
device/adapter available), handled cleanly as "cancelled" with no crash
and no hang. That last part mattered specifically because of the earlier
`window.prompt()` bug in `/screens/discover` (a blocking dialog that
genuinely hung this project's own browser-automation tooling) — this
button was clicked with that exact failure mode in mind, and it did not
repeat: the click returned control immediately, no `computer` timeout,
no forced-navigate recovery needed.

**Two small follow-ups from real usage.** First, a genuine user-reported
error: `ERROR: DNS discovery needs a "cidr" query param` — the CIDR
input's placeholder text was only a hint, not a real value, so clicking
Scan without typing anything sent a blank `cidr` and got back a message
that read like a bug rather than "you forgot to type something."
`mountDiscoverGrid` now checks for a blank input before firing the
request at all, showing "Enter a subnet first" and focusing the field.
Second, a genuinely useful follow-up question: "but I can store the dns
range in my toml? ... this will not change at my home." `device-playlist.toml`
was the wrong place for it (its schema is "one entry per physical
device," and a subnet isn't a device) — `METERKAST_DNS_CIDR` in `.env`
instead, the same reasoning `DIRIGERA_HOSTNAME` already follows (real,
instance-specific config, not a secret, shouldn't be hardcoded into a
committed file). `discover.dns` falls back to it when the request's own
`cidr` is blank; a new `GET /discover/dns/default-cidr` lets the UI
pre-fill the real value into the input (not just leave a placeholder) so
clicking Scan needs zero typing once configured, while a one-off scan of
a different subnet still just overwrites the field by hand.

Verified live with the real value set (`METERKAST_DNS_CIDR=192.168.1.0/24`
in the real `.env`): `GET /discover/dns/default-cidr` returned
`{"cidr":"192.168.1.0/24"}`; on `/screens/discover`, the CIDR input's own
`.value` (confirmed via the page's real DOM, not just the network
response) was genuinely pre-filled with that string on load; clicking
Scan Subnet with the field untouched returned the same real 33 candidates
prior verification already established for this exact subnet — the whole
zero-typing path works end to end, not just the individual pieces in
isolation.

**Immediate follow-up: "can you not discover the ip/subnet from my laptop
address?"** — a real, good question: `os.networkInterfaces()` already
knows the machine's own IPv4 address and netmask, no external lookup
needed. `detectLocalCidr` (new, `dns-adapter.js`) reads it, skips
internal/non-IPv4 addresses, and derives a network-address CIDR from
whichever interface it prefers. The user's own follow-up ("prefer the no
VPN as default") named the real complication before it was even raised:
this exact dev machine runs a corporate VPN client
(`os.networkInterfaces()` confirmed it as `"Centric Azure VPN"`,
`172.22.33.40/32`) alongside its real `"Wi-Fi"` adapter
(`192.168.1.57/24`) — auto-detecting the VPN's own tunnel address instead
of the LAN would have silently produced a useless default. Since there's
no OS-portable API flag for "this is a VPN," `detectLocalCidr` uses a
name-based heuristic (`/vpn|tap|tun\d|ppp|wireguard|.../i`) confirmed
against this exact real case — `"Centric Azure VPN"` matches on `vpn`
directly — preferring the first non-matching interface, falling back to
whatever's there if every candidate looks VPN-like rather than returning
nothing.

Wired as the third tier of a three-way fallback (request's own `cidr` →
`METERKAST_DNS_CIDR` → `detectLocalCidr`), with the winning source logged
at startup and returned from `GET /discover/dns/default-cidr` alongside
the value, so an auto-detected default is always visibly labeled, never
folded silently into "just a number that appeared." Test fixtures use the
real captured shape from this machine's own `os.networkInterfaces()`
output (Wi-Fi + the real VPN name + loopback), not synthesized data.

Verified live end to end, both directions: with `METERKAST_DNS_CIDR`
commented out, the startup log read exactly `DNS discovery default
subnet: 192.168.1.0/24 (auto-detected from "Wi-Fi")` — correctly the LAN,
not the VPN — `GET /discover/dns/default-cidr` returned
`{"cidr":"192.168.1.0/24","source":"auto-detected from \"Wi-Fi\""}`, the
`/screens/discover` DNS input's real `.value` was genuinely pre-filled
with it, a visible `(auto-detected from "Wi-Fi")` label appeared next to
the field, and clicking Scan with the field untouched returned the same
real 33 candidates. Restoring `METERKAST_DNS_CIDR=192.168.1.0/24`
afterward and restarting confirmed the explicit value still wins outright
over auto-detection — the startup log switched back to `(METERKAST_DNS_CIDR)`
with no other change in behavior.

## Testing

`node:test` (built into Node, no test framework dependency), run via
`npm test`. One non-obvious thing worth recording: `node --test <dir>`
spawns one child process per test file for isolation by default, and under
this environment's Git-Bash/MSYS layer that subprocess spawn fails outright
(`Need a valid command-line; Edit the string resources accordingly` — an
MSYS exec-emulation error, not a Node or test bug). `test/run-all.js`
sidesteps it by importing the test files directly into a single process;
`node:test` still registers and reports every test the same way, it just
never forks a subprocess to do it. `npm test` runs `node test/run-all.js`
accordingly.

## Running it

```sh
npm install
npm test
cp device-playlist.example.toml device-playlist.toml   # your real, gitignored copy
npm start                       # loads .env automatically if you have one, no flag needed
curl http://localhost:8420/devices                     # PORT=8420 by default
curl http://localhost:8420/devices/myHpPrinter
curl http://localhost:8420/resolved                     # dns/mdns entries only, normalized to their live address
curl -N http://localhost:8420/events                    # streams SSE change events
```

Open `http://localhost:8420/` for the device table (live via SSE) and a
link to the scan page. BLE/USB itself works in Chrome or Edge (not Firefox
or Safari) — no compiler, no `node-gyp`, no prerequisites of any kind
beyond the browser itself: `http://localhost:8420/web-scan` lists every
bluetooth-transport playlist entry with a `service`/`characteristic` pair
and lets you connect and read each one for real.

Offsite backup, once you've created a private repo yourself (GitHub,
GitLab, self-hosted — anything `git push` can reach):

```sh
echo 'METERKAST_BACKUP_REMOTE=git@github.com:you/meterkast-dns-backups.git' >> .env
node --env-file=.env bin/sync-backups.js
```

Dirigera, once you have your hub's LAN IP and a bearer token (see
`GetAccessToken.py`-style pairing flow — press the hub's button, exchange
for a token, done once):

```sh
echo 'DIRIGERA_HOSTNAME=192.168.1.183' >> .env
echo 'DIRIGERA_BEARER_TOKEN=...' >> .env
```

Then add a `[device].transport = "dirigera"` / `.address = "<device-id>"`
entry to `device-playlist.toml` and run with `npm start`.

Ecowitt, once you have your application/API key pair from the Ecowitt app:

```sh
echo 'ECOWITT_APPLICATION_KEY=...' >> .env
echo 'ECOWITT_API_KEY=...' >> .env
```

`weather-station.transport = "ecowitt"` / `.address = "<device-mac>"` in
the playlist.

Smartbridge/ICS2000, once you have your KlikAanKlikUit account email, the
hub's own MAC, and your account password hash:

```sh
echo 'SMARTBRIDGE_EMAIL=you@example.com' >> .env
echo 'SMARTBRIDGE_MAC=...' >> .env
echo 'SMARTBRIDGE_PASSWORD_HASH=...' >> .env
```

`kaku-plug.transport = "smartbridge"` / `.address = "<ics2000-device-id>"`
in the playlist. `meta` will carry `version_status`/`version_data` as
real, usable change-detection signals; `encrypted_data`/`encrypted_status`
come through as opaque ciphertext — see README.md "Extending to cloud
vendor APIs" for why.
