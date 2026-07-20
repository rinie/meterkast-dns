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
import MarkdownIt from "https://cdn.jsdelivr.net/npm/markdown-it@14/+esm";
import markdownItForm from "/vendor/observable-forms/markdown-it-form.js";
import { createGrid } from "/grid.js";

// The sidebar/page list -- hand-maintained here, the same way Observable
// Framework's own observablehq.config.js hand-lists its sidebar pages
// rather than discovering them from the filesystem at runtime.
const PAGES = [
  { slug: "resolved", title: "Resolved Names" },
  { slug: "devices", title: "All Devices" },
];

const md = new MarkdownIt();
markdownItForm(md);

// ```datatable fence -- the one piece of markdown syntax this app adds
// beyond observable-forms itself. The block's content is a small JSON
// config: {endpoint, columns?, header?, sort?, reverse?} -- columns/
// header/sort/reverse deliberately reuse Observable's own Inputs.table
// option names (observablehq.com/framework/inputs/table), just
// expressed as JSON instead of JS, since a fenced block can't safely
// eval real JS from a hand-authored file without a bigger discussion
// about trust. Anything with another info string still renders as a
// normal code block via the default fence renderer.
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

async function mountDataTables(contentEl) {
  const formEl = contentEl.querySelector(".form-grid");
  for (const el of contentEl.querySelectorAll(".datatable-grid")) {
    const config = JSON.parse(el.dataset.config);
    const rows = await fetch(config.endpoint).then((res) => res.json());
    const columns = config.columns?.map((key) => ({ key, label: config.header?.[key] ?? key }));
    await createGrid(el, rows, {
      columns,
      sort: config.sort,
      reverse: config.reverse,
      onSelect: (row) => populateFormFromRow(formEl, row),
    });
  }
}

function renderSidebar(activeSlug) {
  const nav = document.getElementById("sidebar");
  nav.innerHTML = "";
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
  const contentEl = document.getElementById("content");
  contentEl.innerHTML = "Loading...";
  const res = await fetch(`/pages/${slug}.md`);
  if (!res.ok) {
    contentEl.textContent = `Page not found: ${slug}`;
    return;
  }
  const markdown = await res.text();
  contentEl.innerHTML = md.render(markdown);
  await mountDataTables(contentEl);
}

function slugFromLocation() {
  const match = location.pathname.match(/^\/screens\/([^/]+)/);
  const slug = match?.[1];
  return PAGES.some((p) => p.slug === slug) ? slug : PAGES[0].slug;
}

function navigateTo(slug, push) {
  if (push) history.pushState({ slug }, "", `/screens/${slug}`);
  renderSidebar(slug);
  loadPage(slug);
}

// Normalizes the URL on first load (bare /screens -> /screens/resolved)
// via replaceState rather than pushState, so a bare landing doesn't
// leave an extra, un-bookmarkable entry ahead of the real one in
// history -- same reasoning as public/index.html's own history handling.
const initialSlug = slugFromLocation();
history.replaceState({ slug: initialSlug }, "", `/screens/${initialSlug}`);
renderSidebar(initialSlug);
loadPage(initialSlug);

window.addEventListener("popstate", () => navigateTo(slugFromLocation(), false));
