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
      create-server.js         # routes to the handlers below
      handle-list.js           # GET /devices
      handle-get.js             # GET /devices/:name
      handle-subscribe.js       # GET /events (SSE)
      handle-report.js          # POST /devices/:name -- generic write path
      serve-static-page.js      # GET / and GET /web-scan -- serves public/*.html
  adapters/
    load-adapters.js            # dynamic import() loader
    static-adapter.js           # example/test adapter, no hardware
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
  run-all.js                     # see "Testing" below
public/
  index.html                     # GET / -- device table, live via SSE, links to web-scan
  web-scan.html                  # WebBLE/WebUSB page -- see README.md
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
- **WebBLE/WebUSB — the only BLE/USB path now** — `handle-report.js` adds a
  generic `POST /devices/:name`, deliberately transport-agnostic (it stores
  whatever record it's given, no BLE-specific decode logic in core code) so
  any future push-based adapter can reuse it. `public/web-scan.html` is a
  self-contained static page — no build step, no bundler, no framework —
  and is where the actual `navigator.bluetooth`/`navigator.usb` calls and
  byte decoding happen, client-side, since those APIs don't exist in Node
  at all.
- **One static-page handler for both pages** — `serve-static-page.js`
  takes a filename and serves it from `public/`, used for both `GET /`
  (`index.html`) and `GET /web-scan` (`web-scan.html`). A second nearly
  identical file existed briefly when `web-scan.html` was the only page;
  consolidated rather than copy-pasted once a second page needed the exact
  same "read a file, serve as HTML" logic.
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
browser, not just Node.** `handle-report.js` and `serve-static-page.js`
have unit tests (a fake request/response, no server needed). End-to-end:
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

**USB (`udev`), Zigbee (a coordinator), MQTT (mDNS/DNS-SD), and 433MHz/IR
(RC5/newKaku decoding) adapters remain out of scope entirely** —
`static-adapter.js` still exists to pin down the plain adapter contract for
whichever of those gets built next.

**`GET /` (`public/index.html`) was verified end-to-end for real, including
the live-update path, not just loaded and eyeballed.** With the daemon
running and the page open, a `POST /devices/kitchen-thermometer-battery`
sent from a separate terminal appeared in the table with no page reload —
confirming the SSE wiring end to end: the client listens for the `change`
event specifically (`handle-subscribe.js` sends a named event, not the SSE
default `message` event, which is easy to get wrong and was checked
against the actual source rather than assumed).

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
npm start                       # or: npm run start:env, if you have a .env with secrets
curl http://localhost:8420/devices                     # PORT=8420 by default
curl http://localhost:8420/devices/myHpPrinter
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
