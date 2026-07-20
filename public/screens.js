// The screens app: a sidebar of hand-authored pages (public/pages/*.md),
// Observable-Framework-style file-based routing (a real page IS the
// content -- nothing here generates markdown from a database, unlike
// C:\wrk\locuswms-web-frontend's Oracle-backed buildFormMarkdown, since
// meterkast-dns has no database), rendered with markdown-it plus the
// vendored observable-forms plugin for the ":::form" detail block. A
// page's own ```datatable fence block (see the custom fence rule below)
// names a live JSON endpoint; the resulting grid's row selection
// populates the ":::form" block above it, the same pattern
// locuswms-web-frontend's app.js already uses.
import { createGrid } from "/grid.js";

// The sidebar/page list -- hand-maintained here, the same way Observable
// Framework's own observablehq.config.js hand-lists its sidebar pages
// rather than discovering them from the filesystem at runtime.
const PAGES = [
  { slug: "resolved", title: "Resolved Names" },
  { slug: "devices", title: "All Devices" },
  { slug: "discover", title: "Discover Devices" },
  { slug: "logs", title: "Log" },
];

// pages/index.md is bare /screens' own real content -- a genuine home
// page (overview + links), not just an alias for whichever page happens
// to be first in PAGES. Deliberately not a PAGES entry itself: real user
// feedback ("you use[d] screens/resolved not base index.htm[l]") was
// that auto-selecting the first sidebar item as the default conflated
// "default landing page" with "first regular page," the way Observable
// Framework's own index.md is distinct from every other page it lists.
const HOME_SLUG = "index";

// markdown-it (a CDN import) is loaded lazily, on first actual use, not as
// a static top-level import -- a real bug found by testing: a module's
// static imports must ALL resolve before ANY of its top-level code runs,
// including renderSidebar() below, which has nothing to do with markdown
// at all. A slow or blocked CDN fetch silently left the sidebar invisible
// with no error shown ("I do not see the sidebar on startup"). Fetched
// once, reused for every page after that.
let mdPromise = null;
function getMarkdownIt() {
  if (!mdPromise) {
    mdPromise = (async () => {
      const [{ default: MarkdownIt }, { default: markdownItForm }] = await Promise.all([
        import("https://cdn.jsdelivr.net/npm/markdown-it@14/+esm"),
        import("/vendor/observable-forms/markdown-it-form.js"),
      ]);
      // html: true -- pages/*.md files are hand-authored by whoever runs
      // this server, the same trust level as any other file in this
      // repo, not arbitrary/remote input; markdown-it's default (false)
      // is meant for untrusted markdown, which doesn't apply here. A
      // real bug found by testing: without this, devices.md's raw
      // <div id="display-fields"> was silently HTML-escaped into visible
      // literal text instead of a real element -- populateDisplayFields
      // below had nothing to render into.
      const md = new MarkdownIt({ html: true });
      markdownItForm(md);

      // ```datatable fence -- the one piece of markdown syntax this app
      // adds beyond observable-forms itself. The block's content is a
      // small JSON config: {endpoint, columns?, header?, sort?,
      // reverse?} -- columns/header/sort/reverse deliberately reuse
      // Observable's own Inputs.table option names
      // (observablehq.com/framework/inputs/table), just expressed as
      // JSON instead of JS, since a fenced block can't safely eval real
      // JS from a hand-authored file without a bigger discussion about
      // trust. Anything with another info string still renders as a
      // normal code block via the default fence renderer.
      //
      // {discover: true, buttonLabel?} switches a block into
      // mountDiscoverGrid's Scan-button flow instead (public/pages/
      // discover.md) -- endpoint is POSTed on click, not GET-fetched on
      // page load, since discovery hits a real API on demand rather than
      // auto-running every page visit.
      const defaultFence = md.renderer.rules.fence.bind(md.renderer.rules);
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        if (token.info.trim() === "datatable") {
          let config;
          try {
            config = JSON.parse(token.content);
          } catch (error) {
            return `<div class="datatable-error">Invalid datatable config: ${error.message}</div>`;
          }
          return `<div class="datatable-grid" data-config='${JSON.stringify(config).replace(/'/g, "&#39;")}'></div>`;
        }
        return defaultFence(tokens, idx, options, env, self);
      };

      return md;
    })();
  }
  return mdPromise;
}

// Populates a ":::form" detail block from a selected grid row --
// matches by `[name]` (an editable field) or `[data-name]` (a readonly
// field, per markdown-it-form's emitReadonly). Adapted from
// locuswms-web-frontend's app.js, which lowercases the lookup key --
// that compensated for Oracle's own uppercase column names there, which
// doesn't apply here: meterkast-dns's field names (resolvedAddress) are
// genuine camelCase, matched exactly by using the same bracket name in a
// page's own markdown (see pages/resolved.md's [resolvedAddress]) -- an
// unconditional .toLowerCase() would silently break that exact case
// (found by testing: resolvedAddress never populated until this was
// removed). Object-valued fields (device.meta) are shown as their JSON
// text -- the honest fallback also used elsewhere in this project for
// bytes/values with no better display.
function populateFormFromRow(formEl, row) {
  if (!formEl || !row) return;
  for (const [key, value] of Object.entries(row)) {
    const el = formEl.querySelector(`[name="${key}"], [data-name="${key}"]`);
    if (!el) continue;
    const display = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : value;
    if (el.tagName === "SPAN") el.textContent = display;
    else if ("value" in el) el.value = display;
  }
}

function renderDisplayLines(container, lines) {
  container.innerHTML = "";
  for (const { label, display } of lines) {
    const line = document.createElement("div");
    line.className = "display-field-line";
    const strong = document.createElement("strong");
    strong.textContent = `${label}:`;
    line.append(strong, ` ${display}`);
    container.append(line);
  }
}

// A row's `display` -- a few curated, pre-formatted lines from
// display-fields/ (see src/core/display-fields.js), e.g. "Indoor
// Temperature: 23,5 ℃" -- rendered as plain text lines into a page's own
// <div id="display-fields">, not through observable-forms' :::form
// grammar: unlike a form's fixed field set, which lines exist varies by
// transport (an Ecowitt device gets four, a Dirigera one gets none today),
// which doesn't fit a static field list. A transport with no mapping
// configured, or a row with no `display` array at all, just clears the
// container -- not every device has curated lines to show.
//
// `displayHidden` is the same shape, for lines a device's own
// displayFields/excludeDisplayFields playlist filter left out -- real,
// already-formatted values, just set aside (see server.js's withDisplay).
// Rendered into a collapsed <details id="display-fields-hidden-details">
// if the page provides one, so a filtered-out field's live value stays
// checkable (click to expand) without permanently re-enabling it in the
// primary list. A page without that element (or a device with nothing
// hidden) just skips it -- same graceful-degradation as the primary panel.
function populateDisplayFields(contentEl, row) {
  const container = contentEl.querySelector("#display-fields");
  if (container) renderDisplayLines(container, row?.display ?? []);

  const hiddenDetails = contentEl.querySelector("#display-fields-hidden-details");
  const hiddenContainer = contentEl.querySelector("#display-fields-hidden");
  if (!hiddenDetails || !hiddenContainer) return;
  const hiddenLines = row?.displayHidden ?? [];
  hiddenDetails.hidden = hiddenLines.length === 0;
  renderDisplayLines(hiddenContainer, hiddenLines);
}

// Renders the inline "claim a candidate" mini-form into `cellEl` (a
// <td>, mutated directly the same way web-scan.html's own statusEl
// updates a cell without touching DataTables' data model or triggering a
// redraw) -- an editable text input pre-filled with the candidate's own
// suggestedName, since that's only ever a starting point (see
// dirigera-adapter.js's unclaimedDirigeraDevices), not window.prompt():
// a real bug found by testing, not a style preference -- prompt() blocks
// the entire tab's JS execution until dismissed, and this project's own
// browser-automation tooling hung on it outright (a real user could just
// as easily find a blocking native dialog jarring, e.g. it doesn't
// respect this page's own styling and pauses everything else on the tab).
// Enter or the Save button submits; Cancel reverts to the plain button.
function startAddToPlaylist(row, cellEl) {
  cellEl.innerHTML = "";
  const input = document.createElement("input");
  input.type = "text";
  input.value = row.suggestedName ?? "";
  input.className = "add-to-playlist-name";
  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "Save";
  saveButton.className = "scan-action";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  cancelButton.className = "scan-action";
  const statusEl = document.createElement("span");
  statusEl.className = "scan-status";
  cellEl.append(input, saveButton, cancelButton, statusEl);
  input.focus();
  input.select();

  const revertToButton = () => {
    cellEl.innerHTML =
      '<button type="button" data-action="add" class="scan-action">Add to playlist</button><span class="scan-status"></span>';
  };
  cancelButton.addEventListener("click", revertToButton);

  // POSTs to /playlist/devices and reports the real outcome inline:
  // success (with the honest note that polling starts only after the
  // next daemon restart -- device-playlist.toml is a start-time config
  // file, see server.js's handleAddToPlaylist) or a name collision (with
  // the server's own suggestedName, editable in place so a retry is one
  // more Enter press, not starting over).
  const submit = async () => {
    const name = input.value.trim();
    if (!name) {
      statusEl.textContent = "name required";
      return;
    }
    input.disabled = true;
    saveButton.disabled = true;
    const body = { name, transport: row.transport, address: row.address };
    if (row.deviceType) body.deviceType = row.deviceType;
    const res = await fetch("/playlist/devices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      statusEl.textContent = `ERROR: ${json.error}${json.suggestedName ? ` (try "${json.suggestedName}")` : ""}`;
      input.disabled = false;
      saveButton.disabled = false;
      return;
    }
    cellEl.textContent = "Added -- restart meterkastd to start polling this device.";
  };
  const submitAndReportErrors = () => submit().catch((error) => { statusEl.textContent = `ERROR: ${error.message}`; });
  saveButton.addEventListener("click", submitAndReportErrors);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitAndReportErrors();
  });
}

// A ```datatable block with `"discover": true` (public/pages/discover.md)
// is a POST-triggered scan, not the usual GET-on-load: discovery hits a
// real hub/cloud API on demand, once per click, not something to re-run
// automatically every page visit the way a plain device list is. Renders
// a Scan button (empty grid area until clicked) instead of auto-loading;
// each resulting row gets its own "Add to playlist" action -- the same
// per-row-button pattern (grid.js's onAction) web-scan.html's
// Connect/Read buttons already use.
//
// `cidrInput: true` (DNS's own subnet sweep, which has no *universal*
// default the way Dirigera/Smartbridge's own inventory calls do) renders
// a text input next to the Scan button and appends its value as `?cidr=`
// on the endpoint -- every other transport just omits this and scans
// with no query string at all. `cidrDefaultEndpoint`, if set, is fetched
// once to pre-fill that input with a real configured value (see
// server.js's handleDnsDefaultCidr / METERKAST_DNS_CIDR) rather than
// leaving only a placeholder hint -- a real LAN's own subnet doesn't
// change scan to scan, so typing it every time is pure friction once it's
// actually configured. No default set (or the fetch fails) just leaves
// the placeholder as today; this is a convenience, never a requirement.
function mountDiscoverGrid(el, config) {
  let cidrInputEl;
  if (config.cidrInput) {
    cidrInputEl = document.createElement("input");
    cidrInputEl.type = "text";
    cidrInputEl.placeholder = config.cidrPlaceholder ?? "192.168.1.0/24";
    cidrInputEl.className = "add-to-playlist-name";
    el.append(cidrInputEl);
    if (config.cidrDefaultEndpoint) {
      fetch(config.cidrDefaultEndpoint)
        .then((res) => res.json())
        .then(({ cidr }) => {
          if (cidr) cidrInputEl.value = cidr;
        })
        .catch(() => {}); // no configured default, or a transient failure -- the placeholder hint still works
    }
  }
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = config.buttonLabel ?? `Scan ${config.endpoint}`;
  button.className = "scan-action";
  const gridEl = document.createElement("div");
  el.append(button, gridEl);

  button.addEventListener("click", async () => {
    // The CIDR input's placeholder ("192.168.1.0/24") is only a hint, not
    // a real value -- clicking Scan without typing anything sends a blank
    // cidr, which the server correctly rejects but with a message that
    // reads like a bug report rather than "you forgot to type something."
    // Caught here, before the request, so the failure is obvious and
    // immediate rather than a round trip to learn the same thing.
    if (cidrInputEl && !cidrInputEl.value.trim()) {
      gridEl.textContent = "Enter a subnet first, e.g. 192.168.1.0/24.";
      cidrInputEl.focus();
      return;
    }
    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = "Scanning...";
    try {
      const endpoint = cidrInputEl
        ? `${config.endpoint}?cidr=${encodeURIComponent(cidrInputEl.value.trim())}`
        : config.endpoint;
      const res = await fetch(endpoint, { method: "POST" });
      const rows = await res.json();
      if (!res.ok) {
        gridEl.textContent = `ERROR: ${rows.error ?? res.status}`;
        return;
      }
      const columns = config.columns?.map((key) => ({ key, label: config.header?.[key] ?? key }));
      await createGrid(gridEl, rows, {
        columns: columns && [
          ...columns,
          {
            key: null,
            label: "",
            render: () =>
              `<button type="button" data-action="add" class="scan-action">Add to playlist</button><span class="scan-status"></span>`,
          },
        ],
        onAction: (row, action, actionEl) => {
          if (action !== "add") return;
          startAddToPlaylist(row, actionEl.closest("td"));
        },
      });
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
}

// One live EventSource per page load (not per grid -- a page only
// realistically needs one), closed before the next page's content
// replaces this one. `config.live` on a ```datatable block names the SSE
// event to append from (e.g. "log" for GET /events' log-entry events) --
// `true` is shorthand for "log", the only live source that exists today.
let liveEventSource = null;
function closeLiveEventSource() {
  liveEventSource?.close();
  liveEventSource = null;
}

async function mountDataTables(contentEl) {
  const formEl = contentEl.querySelector(".form-grid");
  const liveTargets = [];
  for (const el of contentEl.querySelectorAll(".datatable-grid")) {
    const config = JSON.parse(el.dataset.config);
    if (config.discover) {
      mountDiscoverGrid(el, config);
      continue;
    }
    const rows = await fetch(config.endpoint).then((res) => res.json());
    const columns = config.columns?.map((key) => ({ key, label: config.header?.[key] ?? key }));
    const grid = await createGrid(el, rows, {
      columns,
      sort: config.sort,
      reverse: config.reverse,
      rowClassKey: config.rowClassKey,
      onSelect: (row) => {
        populateFormFromRow(formEl, row);
        populateDisplayFields(contentEl, row);
      },
    });
    if (config.live && grid) {
      liveTargets.push({ liveEvent: config.live === true ? "log" : config.live, grid });
    }
  }
  if (liveTargets.length > 0) {
    liveEventSource = new EventSource("/events");
    for (const { liveEvent, grid } of liveTargets) {
      liveEventSource.addEventListener(liveEvent, (event) => grid.addRow(JSON.parse(event.data)));
    }
  }
}

function renderSidebar(activeSlug) {
  const nav = document.getElementById("sidebar");
  nav.innerHTML = "";

  const home = document.createElement("a");
  home.href = "/screens";
  home.id = "sidebar-home";
  home.textContent = "meterkast-dns";
  home.className = "sidebar-entry" + (activeSlug === HOME_SLUG ? " active" : "");
  home.addEventListener("click", (event) => {
    event.preventDefault();
    navigateTo(HOME_SLUG, true);
  });
  nav.append(home);

  for (const page of PAGES) {
    const a = document.createElement("a");
    a.href = `/screens/${page.slug}`;
    a.textContent = page.title;
    a.className = "sidebar-entry" + (page.slug === activeSlug ? " active" : "");
    a.addEventListener("click", (event) => {
      event.preventDefault();
      navigateTo(page.slug, true);
    });
    nav.append(a);
  }
}

async function loadPage(slug) {
  closeLiveEventSource();
  const contentEl = document.getElementById("content");
  contentEl.innerHTML = "Loading...";
  const [res, md] = await Promise.all([fetch(`/pages/${slug}.md`), getMarkdownIt()]);
  if (!res.ok) {
    contentEl.textContent = `Page not found: ${slug}`;
    return;
  }
  const markdown = await res.text();
  contentEl.innerHTML = md.render(markdown);
  await mountDataTables(contentEl);
}

// Bare /screens (or /, which the server 302s to /screens) resolves to
// HOME_SLUG -- pages/index.md's own content, not a redirect to whichever
// page is first in PAGES.
function slugFromLocation() {
  const match = location.pathname.match(/^\/screens\/([^/]+)/);
  const slug = match?.[1];
  return PAGES.some((p) => p.slug === slug) ? slug : HOME_SLUG;
}

function urlForSlug(slug) {
  return slug === HOME_SLUG ? "/screens" : `/screens/${slug}`;
}

function navigateTo(slug, push) {
  if (push) history.pushState({ slug }, "", urlForSlug(slug));
  renderSidebar(slug);
  loadPage(slug);
}

// Normalizes the URL on first load (e.g. a stale/unknown slug ->
// /screens) via replaceState rather than pushState, so a bare landing
// doesn't leave an extra, un-bookmarkable entry ahead of the real one in
// history -- same reasoning as public/index.html's own history handling.
// A no-op when the path is already canonical (the common case: bare
// /screens, or a real deep link like /screens/logs).
const initialSlug = slugFromLocation();
const initialUrl = urlForSlug(initialSlug);
if (location.pathname !== initialUrl) {
  history.replaceState({ slug: initialSlug }, "", initialUrl);
}
renderSidebar(initialSlug);
loadPage(initialSlug);

window.addEventListener("popstate", () => navigateTo(slugFromLocation(), false));
