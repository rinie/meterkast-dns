// DataTables adapter -- data in, a DOM element appended to `container`,
// onSelect(row | null) called on row selection. Ported from
// C:\wrk\locuswms-web-frontend's grid.js (same CDN-ESM-import pattern,
// same density CSS -- see screens.css), trimmed to the one backend
// meterkast-dns actually uses: DataTables displays denser and nicer than
// Observable's own Inputs.table (confirmed building that other project),
// so there's no second backend to keep in sync here.
const cssLoaded = new Set();
function ensureCss(href) {
  if (cssLoaded.has(href)) return;
  cssLoaded.add(href);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.append(link);
}

function resolveColumns(rows, columns) {
  if (columns) return columns;
  if (rows.length === 0) return [];
  return Object.keys(rows[0]).map((key) => ({ key, label: key }));
}

// Guards against a stale async render (a slow first-time CDN import)
// appending into a container a later createGrid() call already cleared.
// Keyed per container, not a single module-global counter -- a real bug
// hit building web-scan.html's three concurrent grids (BLE/USB/HID,
// none awaited before the next call starts): a global counter meant
// each later call's own increment silently invalidated the *previous*
// container's still-pending render too, not just a genuinely superseded
// render of the same container, so only the last of the three ever
// appeared. The /screens pages never hit this because their own
// mountDataTables loop awaits each createGrid call before starting the
// next one.
const renderTokens = new WeakMap();

// columns: [{key, label, render?}] or undefined (defaults to every key on
// the first row -- only possible when there IS a first row; with zero
// rows and no explicit columns there's genuinely no schema to infer, so
// that combination alone shows a plain empty-state message instead of a
// zero-column table shell). A column's `key` may be `null` for a
// render-only column with no direct data binding (e.g. an action
// button) -- `render` is then required for it, same as DataTables' own
// convention. sort/reverse mirror Observable's Inputs.table option names
// (observablehq.com/framework/inputs/table), translated to DataTables'
// own `order` option -- the ```datatable fence block in a page's
// markdown uses those same names. rowClassKey: a row field (e.g.
// "level") whose value becomes a `row-${value}` CSS class on that <tr> --
// the log screen's error/warn/info/debug color-coding, kept narrowly
// scoped to this one need rather than a generic styling callback (a JSON
// fence config can't carry a real function).
//
// onAction(row, action, el): fired for a click on any `[data-action]`
// element inside a row (a real <button> a column's own `render` produced
// -- see web-scan.html's per-row Connect/Read buttons), resolved via
// DataTables' own `table.row(tr).data()` so it's correct regardless of
// sort/page state, the same approach the original locuswms-web-frontend
// grid.js used for its dblclick-to-drill-in handler.
//
// Returns a handle with `addRow(row)` for live-appending -- used by the
// log screen's SSE-driven updates, not needed by a page that only ever
// loads a static snapshot.
export async function createGrid(container, rows, { onSelect, onAction, columns, sort, reverse = false, rowClassKey } = {}) {
  container.innerHTML = "";
  const token = (renderTokens.get(container) ?? 0) + 1;
  renderTokens.set(container, token);
  const resolvedColumns = resolveColumns(rows, columns);
  if (resolvedColumns.length === 0) {
    container.textContent = "No rows.";
    return null;
  }

  ensureCss("https://cdn.jsdelivr.net/npm/datatables.net-dt@2/css/dataTables.dataTables.min.css");
  ensureCss("https://cdn.jsdelivr.net/npm/datatables.net-select-dt@2/css/select.dataTables.min.css");

  // datatables.net-select-dt re-exports the Select-extended DataTable
  // class as its own default export -- import only that one, not
  // datatables.net-dt separately too. jsDelivr resolves each import
  // independently, so importing both can silently pin two different
  // sub-versions and attach Select to the wrong DataTable instance
  // (clicks do nothing, no error) -- the real bug that was hit building
  // the original locuswms-web-frontend version of this file.
  const { default: DataTable } = await import("https://cdn.jsdelivr.net/npm/datatables.net-select-dt@2/+esm");
  if (renderTokens.get(container) !== token) return null; // a newer createGrid() call for this container already superseded this one

  const tableEl = document.createElement("table");
  tableEl.style.width = "100%";
  container.append(tableEl);

  const dtColumns = resolvedColumns.map((c) => ({ title: c.label, data: c.key ?? null, render: c.render }));
  const sortIndex = sort ? resolvedColumns.findIndex((c) => c.key === sort) : -1;
  // Default page size = every row already fetched, since the bounded
  // scrollport (screens.css's .datatable-grid) is what actually handles
  // a large row count, not DataTables' own pagination. lengthMenu always
  // includes the real count so the dropdown reflects a real, selected
  // value instead of an unlisted number.
  const lengthMenu = [...new Set([100, 500, 1000, rows.length || 1])].sort((a, b) => a - b);

  const table = new DataTable(tableEl, {
    data: rows,
    columns: dtColumns,
    select: "single",
    pageLength: rows.length || 10,
    lengthMenu,
    order: sortIndex === -1 ? [] : [[sortIndex, reverse ? "desc" : "asc"]],
    createdRow: rowClassKey
      ? (tr, rowData) => {
          if (rowData[rowClassKey]) tr.classList.add(`row-${rowData[rowClassKey]}`);
        }
      : undefined,
  });

  const notifySelection = () => {
    const selected = table.rows({ selected: true }).data().toArray();
    onSelect?.(selected[0] ?? null);
  };
  table.on("select", notifySelection);
  table.on("deselect", notifySelection);

  if (onAction) {
    tableEl.addEventListener("click", (event) => {
      const actionEl = event.target.closest("[data-action]");
      if (!actionEl) return;
      const tr = actionEl.closest("tr");
      const rowData = tr && table.row(tr).data();
      if (rowData) onAction(rowData, actionEl.dataset.action, actionEl);
    });
  }

  return {
    addRow(row) {
      table.row.add(row).draw(false);
    },
  };
}
