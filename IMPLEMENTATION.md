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
    server.js                   # createServer + every route handler + static-page serving
  adapters/
    load-adapters.js            # dynamic import() loader
    static-adapter.js           # example/test adapter, no hardware
    dirigera-adapter.js          # fetch + parse + match + polling loop, all of it
    ecowitt-adapter.js           # fetch + parse + polling loop, all of it
    smartbridge-adapter.js       # fetch + parse + match + polling loop, all of it
    mdns-adapter.js              # PTR/SRV/A/TXT resolution + polling loop, all of it
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
  run-polling-adapter.test.js
  fixtures/
    test-cert.pem                    # throwaway self-signed cert for HTTPS tests
    test-cert.key
    ecowitt-real-time-response.json  # real response shape, captured live
    smartbridge-sync-response.json   # real response shape, IDs genericized
  run-all.js                     # see "Testing" below
public/
  index.html                     # GET / -- device table, live via SSE, links to web-scan
  web-scan.html                  # WebBLE/WebUSB/WebHID page -- see README.md
device-playlist.example.toml     # fixture/template, committed
device-playlist.toml             # the real Use-editable data file, gitignored
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
- **WebBLE/WebUSB/WebHID — the only BLE/USB/HID path now** — `handleReport`
  (in `src/core/server.js`) adds a generic `POST /devices/:name`,
  deliberately transport-agnostic (it stores whatever record it's given, no
  transport-specific decode logic in core code) so every browser-based
  adapter shares it. `public/web-scan.html` is a self-contained static page
  — no build step, no bundler, no framework — and is where the actual
  `navigator.bluetooth`/`navigator.usb`/`navigator.hid` calls and byte
  decoding happen, client-side, since none of those APIs exist in Node at
  all.
- **One static-page handler for both pages** — `serveStaticPage` (in
  `src/core/server.js`) takes a filename and serves it from `public/`, used
  for both `GET /` (`index.html`) and `GET /web-scan` (`web-scan.html`). A
  second nearly identical function existed briefly when `web-scan.html` was
  the only page; consolidated rather than copy-pasted once a second page
  needed the exact same "read a file, serve as HTML" logic.
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
