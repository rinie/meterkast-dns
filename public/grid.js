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
// appending into a container a later createGrid() call already cleared
// for a different page.
let renderToken = 0;

// columns: [{key, label}] or undefined (defaults to every key on the
// first row). sort/reverse mirror Observable's Inputs.table option names
// (observablehq.com/framework/inputs/table), translated to DataTables'
// own `order` option -- the ```datatable fence block in a page's
// markdown uses those same names, so a page author moving from one to
// the other doesn't have to learn different words for the same thing.
export async function createGrid(container, rows, { onSelect, columns, sort, reverse = false } = {}) {
  container.innerHTML = "";
  const token = ++renderToken;
  if (rows.length === 0) {
    container.textContent = "No rows.";
    return;
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
  if (token !== renderToken) return; // a newer createGrid() call already superseded this one

  const resolvedColumns = resolveColumns(rows, columns);
  const tableEl = document.createElement("table");
  tableEl.style.width = "100%";
  container.append(tableEl);

  const dtColumns = resolvedColumns.map((c) => ({ title: c.label, data: c.key }));
  const sortIndex = sort ? resolvedColumns.findIndex((c) => c.key === sort) : -1;
  // Default page size = every row already fetched, since the bounded
  // scrollport (screens.css's .datatable-grid) is what actually handles
  // a large row count, not DataTables' own pagination. lengthMenu always
  // includes the real count so the dropdown reflects a real, selected
  // value instead of an unlisted number.
  const lengthMenu = [...new Set([100, 500, 1000, rows.length])].sort((a, b) => a - b);

  const table = new DataTable(tableEl, {
    data: rows,
    columns: dtColumns,
    select: "single",
    pageLength: rows.length,
    lengthMenu,
    order: sortIndex === -1 ? [] : [[sortIndex, reverse ? "desc" : "asc"]],
  });

  const notifySelection = () => {
    const selected = table.rows({ selected: true }).data().toArray();
    onSelect?.(selected[0] ?? null);
  };
  table.on("select", notifySelection);
  table.on("deselect", notifySelection);
}
