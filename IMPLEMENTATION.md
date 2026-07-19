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

## File convention: one file per function, not one file per layer

Each exported function lives in its own file. No classes, no hidden state —
state is a plain object (a `Map` plus a `Set` of subscribers, for the
registry) passed explicitly into every function that touches it. A "module"
here is a directory of single-purpose files, not a class with methods:

```
src/
  core/
    registry/
      create-registry.js   # {records: Map, subscribers: Set}
      upsert-record.js
      remove-record.js
      get-record.js
      list-records.js
      subscribe.js
      records-as-object.js  # {records: Map} -> {name: record}, for adapters
    naming/
      slugify.js
      suffix-from-ip.js
      suffix-from-counter.js
      suggest-name.js       # composes the three above
    playlist/
      read-playlist.js         # TOML -> records
      write-playlist.js        # records -> TOML, atomic write + snapshot
      watch-playlist.js        # fs.watch wrapper
      flatten-device-readings.js  # [devices.*][.readings] -> flat records
      backup/
        snapshot-playlist.js       # orchestrates the dated-backup decision
        format-backup-date.js      # Date -> "YYYY-MM-DD"
        format-backup-filename.js  # (baseName, date, version) -> filename
        list-backup-versions.js    # existing version numbers for a day
        read-latest-backup.js      # content of the highest version for a day
        is-valid-toml.js           # the "validated" gate
    secrets/
      resolve-secret-env.js    # env var name -> its value, or a clear error
    offsite/
      sync-git-backups.js      # orchestrates: init if needed, commit, push
      run-git.js                # execFile("git", args, {cwd}) wrapper
      is-git-repo.js
      init-git-repo.js
      has-uncommitted-changes.js
      commit-backups.js
      push-backups.js
    server/
      create-server.js         # routes to the three handlers below
      handle-list.js           # GET /devices
      handle-get.js             # GET /devices/:name
      handle-subscribe.js       # GET /events (SSE)
  adapters/
    load-adapters.js            # dynamic import() loader
    static-adapter.js           # example/test adapter, no hardware
    ble-gatt/
      ble-gatt-adapter.js          # noble wiring -- scan/discover UNVERIFIED, see below
      read-device-readings.js      # connect/read/decode/disconnect one device
      group-readings-by-address.js # flat records -> Map<address, readings[]>
      create-async-queue.js        # bridges noble's events to the async generator
      normalize-address.js         # MAC comparison, case/separator-insensitive
      resolve-service-uuid.js      # semantic name -> SIG-assigned UUID
      resolve-characteristic-uuid.js
      known-services.js            # the SIG registry subset backing the above
      known-characteristics.js
      decode-characteristic.js     # dispatches by characteristic name
      decode-temperature-measurement.js  # IEEE-11073 FLOAT, per spec
      decode-weight-measurement.js       # packed weight+flags, per spec
      decode-battery-level.js            # uint8 percentage
bin/
  meterkastd.js                  # entrypoint: loads the playlist, starts the server,
                                  # runs the BLE GATT adapter if any device needs it
  sync-backups.js                 # cron-friendly: pushes backups/ offsite
  scan-ble.js                     # standalone: is noble seeing anything at all?
test/
  registry.test.js
  naming.test.js
  playlist.test.js
  backup.test.js
  secrets.test.js
  offsite.test.js
  ble-gatt.test.js
  run-all.js                     # see "Testing" below
device-playlist.example.toml     # fixture/template, committed
device-playlist.toml             # the real Use-editable data file, gitignored
backups/                         # dated snapshots, written automatically, gitignored
                                  # -- itself its own git repo, pushed offsite
.env                             # real secret values, gitignored, never committed
```

## Library choices, kept minimal on purpose

- **TOML parsing** — [`smol-toml`](https://www.npmjs.com/package/smol-toml):
  ESM-native, zero dependencies, spec-compliant TOML 1.0. The only runtime
  dependency this package has.
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
  it's unset. The real value lives in a gitignored `.env` file, loaded with
  `node --env-file=.env` — native to Node since 20.6, no `dotenv` dependency.
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
- **BLE via an optional native dependency, isolated at install time too** —
  `@abandonware/noble` is an `optionalDependency`, not a regular one:
  `npm install` succeeds whether or not it can build (it's a native addon;
  in this environment its build fails and npm silently skips it, which is
  exactly the scenario this was built for — confirmed by actually running
  `npm install` here). The GATT wiring itself lives behind a dynamic
  `import()` in `ble-gatt-adapter.js`, so its absence never breaks the core,
  the other adapters, or `npm test`.
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
  than the overhead of a separate process would be. The one real reason to
  isolate an adapter is a native binding with genuine crash risk: BLE
  (BlueZ, via a binding like `@abandonware/noble`) and USB (`libusb`/
  `node-usb`) are native C/C++ addons, and a fault in the native library —
  a misbehaving USB device, a BlueZ bug — takes the whole process down with
  it, event loop included, because the failure isn't happening in JS where
  the event loop has any say. A `child_process` contains that: the adapter
  dies, the core and every other adapter keep running. This is
  precautionary, not a response to crashes being common — well-behaved
  native bindings should rarely fail; the isolation exists for the rare
  case, not the typical one.

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

**The BLE GATT adapter is real, in two honestly different senses.** The
UUID resolvers (`resolve-service-uuid.js`, `resolve-characteristic-uuid.js`)
and the characteristic decoders (`decode-temperature-measurement.js` —
IEEE 11073-20601 32-bit FLOAT; `decode-weight-measurement.js` — packed
weight+flags; `decode-battery-level.js`) are genuine, spec-correct
implementations, verified against known-correct byte sequences from the
GATT spec (36.5°C, 72.5 kg, both encoded and decoded by hand to confirm the
math). `read-device-readings.js` — connect once, read and decode every
reading on a device, always disconnect — is verified against a fake
peripheral matching `@abandonware/noble`'s documented async API
(`connectAsync`, `discoverSomeServicesAndCharacteristicsAsync`,
`disconnectAsync`), including the failure path (a read throwing still
disconnects) and the missing-characteristic path. `flatten-device-readings.js`
turns a nested `[devices.name]` + `[devices.name.readings]` playlist section
into flat, independently queryable registry records — verified end-to-end
by starting the real daemon against the example playlist and querying
`GET /devices/kitchen-thermometer-temperature` and `-battery`.

**`ble-gatt-adapter.js` itself — the part that actually calls into
`@abandonware/noble` to scan and discover peripherals — has not been
exercised against real BLE hardware in this environment**, and says so in
its own file comment. Everything it calls is real and tested; its own job
(driving noble's `discover`/`stateChange` events) isn't. USB (`udev`),
Zigbee (a coordinator), MQTT (mDNS/DNS-SD), and 433MHz/IR (RC5/newKaku
decoding) adapters remain out of scope entirely — `static-adapter.js`
still exists to pin down the plain adapter contract for those.

**The adapter is wired into `bin/meterkastd.js`, and the wiring itself is
verified — just not the scan behind it.** On startup, if any playlist entry
has `transport = "bluetooth"`, the daemon runs `bleGattAdapter` in the
background and folds every reading it yields back into the registry via
`upsertRecord`, so a live BLE value updates the same record the HTTP API
and SSE stream already serve. Two things about this were actually run and
confirmed, not just written: with no bluetooth devices in the playlist, the
daemon never attempts to import `@abandonware/noble` at all (no error, no
attempted native load); with a bluetooth device present but the optional
native dependency not installed, the failure is caught and logged
(`BLE GATT adapter stopped: Cannot find package '@abandonware/noble'...`)
and the daemon keeps serving every other device normally — the crash-
isolation behaviour described above under "Adapters as swappable modules"
is not just a design claim here, it was exercised.

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
node --env-file=.env bin/meterkastd.js   # --env-file is optional if you have no secrets yet
curl http://localhost:8420/devices                     # PORT=8420 by default
curl http://localhost:8420/devices/myHpPrinter
curl -N http://localhost:8420/events                    # streams SSE change events
```

Offsite backup, once you've created a private repo yourself (GitHub,
GitLab, self-hosted — anything `git push` can reach):

```sh
echo 'METERKAST_BACKUP_REMOTE=git@github.com:you/meterkast-dns-backups.git' >> .env
node --env-file=.env bin/sync-backups.js
```

BLE, on real hardware — `@abandonware/noble` needs a native build, which
needs different prerequisites per platform:

- **Linux** (best-supported — noble was built against BlueZ):
  `sudo apt install build-essential python3 bluetooth libbluetooth-dev libudev-dev`,
  then after `npm install`, `sudo setcap cap_net_raw+eip $(eval readlink -f \`which node\`)`
  so scanning doesn't need root.
- **macOS**: Xcode Command Line Tools (`xcode-select --install`), then grant
  Bluetooth permission to your terminal app once (System Settings → Privacy
  & Security → Bluetooth).
- **Windows**: Visual Studio Build Tools with the "Desktop development with
  C++" workload, plus Python 3, for `node-gyp`. Uses a WinRT-based backend
  (`noble-winrt`), needs Windows 10+. The least battle-tested of the three —
  theoretical support exists, but it has not been verified working here.

Retry `npm install` on the real machine once those prerequisites are in
place (the native build fails silently and is skipped without them, same
as it did in this environment), then check raw scanning works before
worrying about a specific device's GATT services:

```sh
node bin/scan-ble.js   # lists nearby BLE devices and their MACs for 15s
```
