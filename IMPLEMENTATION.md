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
      read-playlist.js       # TOML -> records
      write-playlist.js      # records -> TOML
      watch-playlist.js      # fs.watch wrapper
    server/
      create-server.js       # routes to the three handlers below
      handle-list.js         # GET /devices
      handle-get.js           # GET /devices/:name
      handle-subscribe.js     # GET /events (SSE)
  adapters/
    load-adapters.js          # dynamic import() loader
    static-adapter.js         # example/test adapter, no hardware
bin/
  meterkastd.js                # entrypoint: loads the playlist, starts the server
test/
  registry.test.js
  naming.test.js
  playlist.test.js
  run-all.js                   # see "Testing" below
device-playlist.toml           # the actual Use-editable data file
```

## Library choices, kept minimal on purpose

- **TOML parsing** — [`smol-toml`](https://www.npmjs.com/package/smol-toml):
  ESM-native, zero dependencies, spec-compliant TOML 1.0. The only runtime
  dependency this package has.
- **Watching the hand-edited file** — native `fs.promises.watch()`, no
  `chokidar`. Its cross-platform quirks (inotify vs FSEvents vs Windows) are
  real; not a concern for the current single-file, single-host use case.
- **The query/subscribe API** — plain `node:http`, no Express. Subscribing
  uses Server-Sent Events, not WebSockets: it's one-directional (the core
  tells clients when a record changed), which is exactly what SSE is for,
  and it needs zero extra dependencies.
- **Adapters as swappable modules** — each adapter is a plain ESM module
  whose default export is an async generator yielding
  `{name, transport, address, meta?}` records, loaded via native dynamic
  `import()`. That is Node's own plugin-loading primitive; no framework
  needed. Whether a given adapter runs in-process or as a separate
  `child_process` (real crash isolation, closer to the LSP model this
  mirrors) is a per-adapter choice, not a framework-wide one.

## What's actually implemented here

The **core** — registry, naming suggestions, playlist read/write, and the
HTTP query/subscribe API — is real and covered by tests. `bin/meterkastd.js`
loads `device-playlist.toml`, serves `GET /devices`, `GET /devices/:name`,
and `GET /events` (SSE).

**Adapters beyond `static-adapter.js` are out of scope for this draft.** Real
BLE (BlueZ), USB (`udev`), Zigbee (a coordinator), MQTT (mDNS/DNS-SD), and
433MHz/IR (RC5/newKaku decoding) adapters need native bindings and, in most
cases, actual hardware to write against meaningfully. `static-adapter.js`
exists only to pin down the adapter contract — a default-exported async
generator yielding records — so a real adapter has a known shape to target.

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
node bin/meterkastd.js        # PORT=8420 by default
curl http://localhost:8420/devices
curl http://localhost:8420/devices/myHpPrinter
curl -N http://localhost:8420/events   # streams SSE change events
```
