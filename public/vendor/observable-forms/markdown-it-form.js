/**
 * markdown-it-form
 * Observable Framework plugin for CSS grid-based forms.
 *
 * Usage in observablehq.config.js:
 *   import markdownItForm from './src/markdown-it-form.js'
 *   export default { markdownIt: md => { markdownItForm(md) } }
 *
 * Syntax:
 *   :::form
 *   | .classname | 1fr | 2fr | 1fr |
 *   | !First name [firstName] (e.g. Jan) | Last name [lastName] | Age |
 *   | Street address [street] |||
 *   | City || Zip |
 *   | Country [country] >> @countryOptions = NL | Gender > M, F, X |
 *   | Active >  | Status [status] = |
 *   | Locked [locked] > = true ~ | Category > A, B, C ~ |
 *   :::
 */

// ---------------------------------------------------------------------------
// Cell parser
// ---------------------------------------------------------------------------

function deriveFieldName(label) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Parse a single cell string into a field descriptor.
 *
 * Grammar:
 *   [!] label [ [name] ] [ (placeholder) ] [ (> | >>) (opt1,opt2 | @var) [ = default ] [ ~ ] ] [ = ] [ ~ ]
 *
 * `~` marks the field disabled (renders a real, greyed-out interactive
 * control with the HTML `disabled` attribute) - distinct from trailing
 * `=` (readonly), which drops the control entirely in favor of a plain
 * `<span>`. Meaningful on every type except `readonly` itself (already
 * non-interactive): a checkbox/radio/select `~` goes at the very end,
 * after any default value (`> = true ~`, `>> @var = NL ~`); a plain
 * text field's `~` goes where a trailing `=` would (`Label [name] ~`).
 *
 * Returns null for empty/whitespace cells (grid spacers) and for a bare
 * '.' cell - a HARD spacer, reserved for row-padding. The difference
 * matters to parseDataRow: an empty cell (`''`) merges into whichever
 * real cell precedes it (that's how a field's own `:Span` colspan is
 * expressed), but '.'.trim() is non-empty, so it never gets absorbed
 * that way - it always renders as its own independent blank grid cell,
 * which is exactly what's needed to pad a short row out to a fixed
 * column count without silently widening the last real field on that
 * row (useful when a caller renders one grid ROW per source line and
 * wants each such line to be a genuine visual row break).
 */
function parseCell(raw) {
  const src = raw.trim();
  if (!src || src === '.') return null;

  let rest = src;
  const field = {
    label: '',
    name: '',
    required: false,
    disabled: false,
    type: 'text',       // text | radio | select | checkbox | readonly
    placeholder: '',
    options: [],        // string[] for static
    optionsSrc: '',     // @varName for dynamic
    defaultValue: '',
  };

  if (rest.startsWith('!')) {
    field.required = true;
    rest = rest.slice(1).trimStart();
  }

  const nameMatch = rest.match(/\[([^\]]+)\]/);
  if (nameMatch) {
    field.name = nameMatch[1].trim();
    rest = rest.replace(nameMatch[0], '').trim();
  }

  const placeholderMatch = rest.match(/\(([^)]+)\)/);
  if (placeholderMatch) {
    field.placeholder = placeholderMatch[1].trim();
    rest = rest.replace(placeholderMatch[0], '').trim();
  }

  const optMatch = rest.match(/(>>?)(.*)$/);
  if (optMatch) {
    const forced = optMatch[1] === '>>';
    rest = rest.slice(0, optMatch.index).trim();
    let optSrc = optMatch[2].trim();

    if (optSrc.endsWith('~')) {
      field.disabled = true;
      optSrc = optSrc.slice(0, -1).trim();
    }

    const defMatch = optSrc.match(/=\s*([^,]+)$/);
    if (defMatch) {
      field.defaultValue = defMatch[1].trim();
      optSrc = optSrc.slice(0, defMatch.index).trim();
    }

    if (optSrc.startsWith('@')) {
      field.optionsSrc = optSrc.slice(1).trim();
      field.type = 'select';
    } else if (optSrc === '') {
      field.type = 'checkbox';
    } else {
      field.options = optSrc.split(',').map((o) => o.trim()).filter(Boolean);
      field.type = (forced || field.options.length > 3) ? 'select' : 'radio';
    }
  } else if (rest.endsWith('=')) {
    field.type = 'readonly';
    rest = rest.slice(0, -1).trim();
  } else if (rest.endsWith('~')) {
    field.disabled = true;
    rest = rest.slice(0, -1).trim();
  }

  if (rest.endsWith('!')) {
    field.required = true;
    rest = rest.slice(0, -1).trim();
  }

  field.label = rest.trim();
  if (!field.name) field.name = deriveFieldName(field.label);

  return field;
}

// ---------------------------------------------------------------------------
// HTML emitters
// ---------------------------------------------------------------------------

function escAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function requiredAttr(field) {
  return field.required ? ' required' : '';
}

function requiredStar(field) {
  return field.required ? '<span class="form-required" aria-hidden="true">*</span>' : '';
}

function disabledAttr(field) {
  return field.disabled ? ' disabled' : '';
}

function disabledClass(field) {
  return field.disabled ? ' form-field--disabled' : '';
}

function emitLabel(field) {
  return `<label for="${escAttr(field.name)}">${escAttr(field.label)}${requiredStar(field)}</label>`;
}

function emitText(field) {
  const placeholderAttr = field.placeholder ? ` placeholder="${escAttr(field.placeholder)}"` : '';
  const valueAttr = field.defaultValue ? ` value="${escAttr(field.defaultValue)}"` : '';
  return `<div class="form-field${disabledClass(field)}">
  ${emitLabel(field)}
  <input type="text" id="${escAttr(field.name)}" name="${escAttr(field.name)}"${placeholderAttr}${valueAttr}${requiredAttr(field)}${disabledAttr(field)}>
</div>`;
}

function emitReadonly(field) {
  return `<div class="form-field form-field--readonly">
  ${emitLabel(field)}
  <span class="form-value" id="${escAttr(field.name)}" data-name="${escAttr(field.name)}">${escAttr(field.defaultValue)}</span>
</div>`;
}

function emitCheckbox(field) {
  const checked = (field.defaultValue === 'true' || field.defaultValue === '1') ? ' checked' : '';
  return `<div class="form-field form-field--checkbox${disabledClass(field)}">
  <input type="checkbox" id="${escAttr(field.name)}" name="${escAttr(field.name)}"${checked}${requiredAttr(field)}${disabledAttr(field)}>
  <label for="${escAttr(field.name)}">${escAttr(field.label)}${requiredStar(field)}</label>
</div>`;
}

function emitRadio(field) {
  const radios = field.options.map((opt) => {
    const id = `${field.name}_${deriveFieldName(opt)}`;
    const checked = field.defaultValue === opt ? ' checked' : '';
    return `  <label class="form-radio-option"><input type="radio" id="${escAttr(id)}" name="${escAttr(field.name)}" value="${escAttr(opt)}"${checked}${requiredAttr(field)}${disabledAttr(field)}> ${escAttr(opt)}</label>`;
  }).join('\n');
  return `<div class="form-field form-field--radio${disabledClass(field)}">
  <span class="form-label">${escAttr(field.label)}${requiredStar(field)}</span>
  <div class="form-radio-group">
${radios}
  </div>
</div>`;
}

function emitSelect(field) {
  const optionsHtml = field.optionsSrc
    ? ''
    : field.options.map((opt) => {
      const selected = field.defaultValue === opt ? ' selected' : '';
      return `  <option value="${escAttr(opt)}"${selected}>${escAttr(opt)}</option>`;
    }).join('\n');

  const dynamicAttrs = field.optionsSrc
    ? ` data-options-src="${escAttr(field.optionsSrc)}"`
    : ` data-options="${escAttr(field.options.join(','))}"`;

  return `<div class="form-field form-field--select${disabledClass(field)}">
  ${emitLabel(field)}
  <select id="${escAttr(field.name)}" name="${escAttr(field.name)}"${dynamicAttrs}${requiredAttr(field)}${disabledAttr(field)}>
${optionsHtml}
  </select>
</div>`;
}

function emitField(field) {
  switch (field.type) {
    case 'readonly': return emitReadonly(field);
    case 'checkbox': return emitCheckbox(field);
    case 'radio':    return emitRadio(field);
    case 'select':   return emitSelect(field);
    default:         return emitText(field);
  }
}

// ---------------------------------------------------------------------------
// Table row / header parser
// ---------------------------------------------------------------------------

function splitRow(line) {
  return line
    .replace(/^\||\|$/g, '')
    .split('|');
}

function parseHeader(cells) {
  const columns = [];
  let cssClass = '';
  for (const cell of cells) {
    const c = cell.trim();
    if (c.startsWith('.')) {
      cssClass = c.slice(1).trim();
    } else {
      columns.push(c || '1fr');
    }
  }
  return { cssClass, columns };
}

function parseDataRow(cells) {
  const result = [];
  let i = 0;
  while (i < cells.length) {
    let colspan = 1;
    let j = i + 1;
    while (j < cells.length && cells[j].trim() === '') {
      colspan += 1;
      j += 1;
    }
    result.push({ raw: cells[i], colspan });
    i = j;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

function renderFormBlock(content) {
  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  if (!lines.length) return '<div class="form-grid"></div>';

  const headerCells = splitRow(lines[0]);
  const { cssClass, columns } = parseHeader(headerCells);

  const gridStyle = `grid-template-columns: ${columns.join(' ')}`;
  const classAttr = cssClass
    ? `class="form-grid ${escAttr(cssClass)}"`
    : 'class="form-grid"';

  let html = `<div ${classAttr} style="${gridStyle}">\n`;

  for (let li = 1; li < lines.length; li += 1) {
    const cells = splitRow(lines[li]);
    const parsed = parseDataRow(cells);

    for (const { raw, colspan } of parsed) {
      const field = parseCell(raw);
      const spanStyle = colspan > 1 ? ` style="grid-column: span ${colspan}"` : '';
      const spanClass = colspan > 1 ? ` form-cell--span-${colspan}` : '';

      if (!field) {
        html += `  <div class="form-cell form-cell--empty"${spanStyle}></div>\n`;
      } else {
        html += `  <div class="form-cell${spanClass}"${spanStyle}>\n`;
        html += `${emitField(field).split('\n').map((l) => `    ${l}`).join('\n')}\n`;
        html += `  </div>\n`;
      }
    }
  }

  html += `</div>\n`;
  return html;
}

// ---------------------------------------------------------------------------
// Observable Framework runtime stub (emitted once per page)
// ---------------------------------------------------------------------------

const RUNTIME_SCRIPT = `
<script type="module">
(function() {
  function bindDynamicSelects() {
    document.querySelectorAll('select[data-options-src]').forEach(sel => {
      const src = sel.dataset.optionsSrc
      if (typeof window.__observableRuntime !== 'undefined') {
        window.__observableRuntime.observe(src, values => {
          replaceOptions(sel, values)
        })
      }
    })
  }

  window.replaceOptions = function(sel, values) {
    const current = sel.value
    sel.innerHTML = ''
    values.forEach(v => {
      const opt = document.createElement('option')
      opt.value = v
      opt.textContent = v
      if (v === current) opt.selected = true
      sel.appendChild(opt)
    })
  }

  window.formSetOptions = function(name, values) {
    document.querySelectorAll('select[name="' + name + '"]').forEach(sel => {
      window.replaceOptions(sel, values)
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindDynamicSelects)
  } else {
    bindDynamicSelects()
  }
})()
</script>
`;

// ---------------------------------------------------------------------------
// markdown-it container registration
// ---------------------------------------------------------------------------

export default function markdownItForm(md) {
  let runtimeEmitted = false;

  md.use((instance) => {
    const OPEN_RE = /^:::\s*form\s*$/;
    const CLOSE_RE = /^:::\s*$/;

    instance.core.ruler.push('form_container', (state) => {
      const { tokens } = state;
      let i = 0;
      while (i < tokens.length) {
        const tok = tokens[i];
        if (tok.type === 'inline' && OPEN_RE.test(tok.content.trim())) {
          let j = i + 1;
          const contentLines = [];
          while (j < tokens.length) {
            const t = tokens[j];
            if (t.type === 'inline' && CLOSE_RE.test(t.content.trim())) break;
            if (t.type === 'inline') contentLines.push(t.content);
            j += 1;
          }
          const formHtml = renderFormBlock(contentLines.join('\n'));
          let runtime = '';
          if (!runtimeEmitted) {
            runtime = RUNTIME_SCRIPT;
            runtimeEmitted = true;
          }
          const token = new state.Token('html_block', '', 0);
          token.content = runtime + formHtml;
          tokens.splice(i, j - i + 1, token);
        }
        i += 1;
      }
    });
  });
}

export {
  parseCell,
  parseHeader,
  parseDataRow,
  renderFormBlock,
  deriveFieldName,
};
