// node --test spawns one child process per file for isolation, which breaks
// under this environment's Git-Bash/MSYS layer (it mis-builds the child
// process command line). Importing the test files directly, in one process,
// sidesteps that: node:test still registers and reports every test the same
// way, it just does not fork a subprocess to do it.
import "./registry.test.js";
import "./naming.test.js";
import "./playlist.test.js";
import "./backup.test.js";
import "./secrets.test.js";
import "./offsite.test.js";
import "./server.test.js";
import "./dirigera.test.js";
import "./ecowitt.test.js";
import "./smartbridge.test.js";
import "./run-polling-adapter.test.js";
import "./mdns.test.js";
