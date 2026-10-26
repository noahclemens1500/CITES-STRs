/* CITES STR Marker Database – client-side search (no server needed; runs on GitHub Pages).
   Data: data/index.json (all genera) + data/genera/<Genus>.json (markers of one genus). */
'use strict';

// ---------------------------------------------------------------- columns
// key = field in the genus JSON; label = column header; also used for CSV export
const COLUMNS = [
  { key: 'marker', label: 'Marker', default: true },
  { key: 'panel', label: 'Type', default: true, render: r => r.panel === 'sex_linked' ? '<span class="tag sex">sex-linked</span>' : '<span class="tag">autosomal</span>' },
  { key: 'chr', label: 'Chr', default: true, sort: 'chr' },
  { key: 'repStart', label: 'Repeat start [bp]', default: true, num: true, fmt: 'int' },
  { key: 'motif', label: 'Motif', default: true },
  { key: 'structure', label: 'Repeat structure', default: false },
  { key: 'allele', label: 'Ref. allele', default: true, num: true, sort: 'allele' },
  { key: 'range', label: 'Allelic range', default: true },
  { key: 'na', label: 'Na', default: true, num: true },
  { key: 'h', label: 'H', default: true, num: true, fmt: 2 },
  { key: 'callRate', label: 'Call rate', default: true, num: true, fmt: 'pct' },
  { key: 'amp', label: 'Amplicon [bp]', default: true, num: true },
  { key: 'fSeq', label: 'Primer forward (5′→3′)', default: true, seq: true },
  { key: 'rSeq', label: 'Primer reverse (5′→3′)', default: true, seq: true },
  { key: 'fTm', label: 'Tm for [°C]', default: true, num: true, fmt: 1 },
  { key: 'rTm', label: 'Tm rev [°C]', default: true, num: true, fmt: 1 },
  { key: 'fGc', label: 'GC for [%]', default: true, num: true, fmt: 1 },
  { key: 'rGc', label: 'GC rev [%]', default: true, num: true, fmt: 1 },
  { key: 'pool', label: 'Pool', default: true, num: true },
  { key: 'pair', label: 'Primer pair name', default: false },
  { key: 'ampStart', label: 'Amplicon start [bp]', default: false, num: true, fmt: 'int' },
  { key: 'ampEnd', label: 'Amplicon end [bp]', default: false, num: true, fmt: 'int' },
  { key: 'repEnd', label: 'Repeat end [bp]', default: false, num: true, fmt: 'int' },
  { key: 'callRateAll', label: 'Call rate (all genomes)', default: false, num: true, fmt: 'pct' },
  { key: 'amplified', label: 'Genomes amplified', default: false },
  { key: 'flankIndel', label: 'Flank indels', default: false },
  { key: 'offTarget', label: 'Off-target products', default: false, num: true },
  { key: 'human', label: 'Human products', default: false, num: true },
  { key: 'shortSsr', label: 'Other STRs in amplicon', default: false, num: true },
  { key: 'overlap', label: 'Overlapping amplicons', default: false },
  { key: 'dimer', label: 'Worst dimer ΔG', default: false, num: true },
  { key: 'ref', label: 'Reference accession', default: false },
  { key: 'refSp', label: 'Reference species', default: false },
  { key: 'alleles', label: 'Alleles per genome', default: false },
  { key: 'id', label: 'Locus ID', default: false },
];
const GLOSSARY = {
  marker: 'GENUSCODE_Chromosome_Position(Mb) of the repeat in the reference genome. Primers: <marker>_P<rank>-for / -rev.',
  panel: 'Autosomal or on a sex chromosome (X, Y, Z, W).',
  allele: 'Repeat units in the reference genome; forensic notation (9.3 = 9 units + 3 bp).',
  range: 'Smallest–largest allele over reference and typed comparison genomes. "(reference only)" = genus with a single genome.',
  na: 'Number of distinct alleles (reference + comparison genomes).',
  h: 'Gene diversity 1 − Σp² over the alleles of all typed genomes.',
  callRate: 'Share of comparison genomes with conserved primer sites and a valid allele, averaged per species.',
  amp: 'PCR product length in the reference genome.',
  pool: 'Suggested multiplex pool (Primer Pooler; overlapping amplicons are never in the same pool).',
  offTarget: 'Additional in-silico PCR products in the reference genome.',
  human: 'In-silico PCR products in the human genome – always 0: markers with human cross-reactivity are excluded.',
  flankIndel: 'Comparison genomes whose amplicon also differs in length outside the repeat.',
  shortSsr: 'Other STRs inside the amplicon – 0 for all markers built since version 2026-10-21 (such primer pairs are excluded).',
  overlap: 'Markers whose amplicon overlaps this one – do not use them in the same panel.',
};

// ---------------------------------------------------------------- state
const S = {
  index: null, meta: null, genus: null, info: null, rows: [], filtered: [],
  sort: { key: 'chr', dir: 1 }, page: 0, pageSize: 100,
  visible: new Set(COLUMNS.filter(c => c.default).map(c => c.key)),
  f: {},
};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = v => typeof v === 'number' && !Number.isNaN(v);
const storage = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};

// ---------------------------------------------------------------- helpers
function chrKey(c) {
  const s = String(c).replace(/\s*\(unloc\.\)/, '').trim();
  const m = s.match(/^(?:chr)?(\d+)(.*)$/i);
  if (m) return [0, +m[1], m[2]];
  const sx = s.toUpperCase().match(/^([XYZW])(\d*)$/);
  if (sx) return [1, 'XYZW'.indexOf(sx[1]), sx[2]];
  return [2, 0, s];
}
function cmpArr(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}
const alleleNum = v => { const n = parseFloat(v); return Number.isNaN(n) ? null : n; };
function fmt(v, f) {
  if (v === '' || v === null || v === undefined) return '–';
  if (!isNum(v)) return esc(v);
  if (f === 'pct') return Math.round(v * 100) + ' %';
  if (f === 'int') return v.toLocaleString('en-US');
  if (typeof f === 'number') return v.toFixed(f);
  return String(v);
}
function revcomp(s) {
  const c = { A: 'T', C: 'G', G: 'C', T: 'A' };
  return s.split('').reverse().map(x => c[x] || x).join('');
}
function motifClass(m) { // all rotations of a motif and of its reverse complement
  const out = new Set();
  for (const s of [m, revcomp(m)]) for (let i = 0; i < s.length; i++) out.add(s.slice(i) + s.slice(0, i));
  return out;
}
// interne Kennung je Motiv-Gruppe (alphabetisch erste Schreibweise, wie PERF), z. B. GATA -> AGAT
const motifCanon = m => [...motifClass(String(m).toUpperCase())].sort()[0];
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ---------------------------------------------------------------- filters
// Each filter: id, label, kind, test(row, value) -> bool, isActive(value)
const FILTERS = [
  { id: 'q', label: 'Marker name / locus ID', kind: 'text', placeholder: 'e.g. EQUU_07',
    test: (r, v) => (r.marker + ' ' + r.id + ' ' + r.pair).toLowerCase().includes(v.toLowerCase()) },
  { id: 'panel', label: 'Marker type', kind: 'checks',
    options: [['autosomal', 'Autosomal'], ['sex_linked', 'Sex-linked']], test: (r, v) => v.includes(r.panel) },
  { id: 'chr', label: 'Chromosome', kind: 'chips', value: r => String(r.chr),
    order: (a, b) => cmpArr(chrKey(a), chrKey(b)), show: c => c.replace(/^Un/, 'Un '),
    test: (r, v) => v.includes(String(r.chr)) },
  // Motive werden eingetippt und zu einer Liste hinzugefuegt; jedes umfasst Rotationen + Gegenstrang
  { id: 'motif', label: 'Motif', kind: 'taglist', placeholder: 'e.g. GATA – Enter to add',
    help: 'each motif includes its rotations and the reverse complement (GATA = ATAG = TATC …)',
    test: (r, v) => v.some(m => motifCanon(m) === r.motifClass) },
  { id: 'callRate', label: 'Min. call rate', kind: 'slider', min: 0, max: 1, step: 0.05, pct: true,
    help: 'markers of single-genome genera have no call rate',
    test: (r, v) => isNum(r.callRate) && r.callRate >= v - 1e-9 },
  { id: 'na', label: 'Min. number of alleles (Na)', kind: 'number', min: 1, test: (r, v) => r.na >= v },
  { id: 'h', label: 'Min. gene diversity (H)', kind: 'slider', min: 0, max: 1, step: 0.05,
    test: (r, v) => isNum(r.h) && r.h >= v - 1e-9 },
  { id: 'amp', label: 'Amplicon length [bp]', kind: 'range', field: 'amp' },
  { id: 'allele', label: 'Reference allele [units]', kind: 'range', field: 'allele', get: r => alleleNum(r.allele) },
  { id: 'tm', label: 'Primer Tm [°C]', kind: 'range', fields: ['fTm', 'rTm'], step: 0.1, help: 'both primers' },
  { id: 'gc', label: 'Primer GC content [%]', kind: 'range', fields: ['fGc', 'rGc'], step: 1, help: 'both primers' },
  { id: 'pool', label: 'Multiplex pool', kind: 'select', test: (r, v) => String(r.pool) === v },
  { id: 'quality', label: 'Quality', kind: 'flags', options: [
    ['perfect', 'Simple repeat only (no compound)', r => !/\]\d+.*\[/.test(String(r.structure))],
    ['noOff', 'No off-target products in reference', r => r.offTarget === 0],
    ['noIndel', 'No flank indels', r => /^0\//.test(String(r.flankIndel)) || r.flankIndel === ''],
    ['noOverlap', 'No overlapping amplicons', r => !r.overlap],
  ], test: (r, v, f) => v.every(id => f.options.find(o => o[0] === id)[2](r)) },
];

function defaults() {
  return { q: '', panel: ['autosomal', 'sex_linked'], chr: null, callRate: 0, na: '', h: 0,
           amp: ['', ''], allele: ['', ''], tm: ['', ''], gc: ['', ''], motif: [], pool: '', quality: [] };
}
function active(f, v) {
  switch (f.kind) {
    case 'text': case 'select': return v !== '';
    case 'checks': return v.length < f.options.length;
    case 'chips': return Array.isArray(v);
    case 'slider': return v > 0;
    case 'number': return v !== '' && !Number.isNaN(+v);
    case 'range': return v[0] !== '' || v[1] !== '';
    case 'flags': case 'taglist': return Array.isArray(v) && v.length > 0;
  }
  return false;
}
function testRange(r, f, v) {
  const lo = v[0] === '' ? -Infinity : +v[0], hi = v[1] === '' ? Infinity : +v[1];
  const vals = f.fields ? f.fields.map(k => r[k]) : [f.get ? f.get(r) : r[f.field]];
  return vals.every(x => isNum(x) && x >= lo && x <= hi);
}
function applyFilters() {
  const act = FILTERS.filter(f => active(f, S.f[f.id]));
  S.filtered = S.rows.filter(r => act.every(f => f.kind === 'range' ? testRange(r, f, S.f[f.id]) : f.test(r, S.f[f.id], f)));
  sortRows();
  S.page = 0;
  renderTable();
  writeHash();
}

function buildFilters() {
  const body = $('#filter-body');
  body.innerHTML = '';
  const rows = S.rows;
  const noCall = rows.every(r => !isNum(r.callRate));
  for (const f of FILTERS) {
    const g = document.createElement('div');
    g.className = 'fgroup';
    const v = S.f[f.id];
    const help = f.help ? ` <span class="fhelp">(${esc(f.help)})</span>` : '';
    if (f.kind === 'text') {
      g.innerHTML = `<label for="f-${f.id}">${f.label}</label><input type="text" id="f-${f.id}" placeholder="${esc(f.placeholder || '')}" value="${esc(v)}">`;
      g.querySelector('input').addEventListener('input', debounce(e => { S.f[f.id] = e.target.value.trim(); applyFilters(); }, 200));
    } else if (f.kind === 'checks') {
      g.innerHTML = `<span class="flabel">${f.label}</span>` + f.options.map(([val, lab]) => {
        const n = rows.filter(r => r.panel === val).length;
        return `<label class="check"><input type="checkbox" value="${val}" ${v.includes(val) ? 'checked' : ''}> ${lab} <span class="fhelp">(${n})</span></label>`;
      }).join('');
      g.addEventListener('change', () => { S.f[f.id] = [...g.querySelectorAll('input:checked')].map(i => i.value); applyFilters(); });
    } else if (f.kind === 'chips') {
      // Mehrfachauswahl; nichts ausgewaehlt bzw. alles ausgewaehlt = kein Filter
      const counts = {};
      rows.forEach(r => { const x = f.value(r); counts[x] = (counts[x] || 0) + 1; });
      const vals = Object.keys(counts).sort(f.order);
      const sel = v || [];
      g.innerHTML = `<span class="flabel">${f.label} <span class="fhelp">(${vals.length}${f.help ? '; ' + esc(f.help) : ''})</span></span><div class="chips">` +
        vals.map(c => `<button type="button" class="chip" data-v="${esc(c)}" aria-pressed="${sel.includes(c)}"
          title="${esc((f.title ? f.title(c) + ' – ' : '') + counts[c] + ' markers')}">${esc(f.show(c))}</button>`).join('') +
        `</div><div class="chips-actions"><button type="button" class="link" data-none>clear selection</button></div>`;
      const sync = () => {
        const on = [...g.querySelectorAll('.chip[aria-pressed="true"]')].map(b => b.dataset.v);
        S.f[f.id] = on.length && on.length < vals.length ? on : null;
        applyFilters();
      };
      g.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.v !== undefined) b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true');
        else g.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
        sync();
      });
    } else if (f.kind === 'taglist') {
      // Eingabefeld + Liste: Motiv eintippen, mit Enter/Add hinzufuegen, mit × wieder entfernen
      g.innerHTML = `<label for="f-${f.id}">${f.label}</label>
        <div class="tag-add"><input type="text" id="f-${f.id}" placeholder="${esc(f.placeholder)}" autocomplete="off" spellcheck="false">
        <button type="button" class="btn ghost small">Add</button></div>
        <div class="fhelp tag-msg" aria-live="polite"></div><div class="tags"></div>
        <div class="fhelp">${esc(f.help)}</div>`;
      const inp = g.querySelector('input'), msg = g.querySelector('.tag-msg'), box = g.querySelector('.tags');
      const count = m => rows.filter(r => r.motifClass === motifCanon(m)).length;
      const draw = () => {
        box.innerHTML = (S.f[f.id] || []).map((m, i) =>
          `<span class="tag-item">${esc(m)} <span class="fhelp">(${count(m)})</span><button type="button" data-i="${i}" aria-label="Remove ${esc(m)}">×</button></span>`).join('');
      };
      const add = () => {
        msg.textContent = '';
        const items = inp.value.toUpperCase().split(/[\s,;]+/).filter(Boolean);
        for (const m of items) {
          if (!/^[ACGT]{4}$/.test(m)) { msg.textContent = `"${m}" is not a tetranucleotide motif (4 letters A, C, G, T).`; continue; }
          const list = S.f[f.id] || [];
          if (list.some(x => motifCanon(x) === motifCanon(m))) { msg.textContent = `${m} is already covered by the list.`; continue; }
          S.f[f.id] = [...list, m];
          if (!count(m)) msg.textContent = `No markers with motif ${m} in this genus.`;
        }
        inp.value = '';
        draw();
        applyFilters();
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      g.querySelector('.tag-add button').addEventListener('click', add);
      box.addEventListener('click', e => {
        const b = e.target.closest('button[data-i]');
        if (!b) return;
        S.f[f.id] = S.f[f.id].filter((_, i) => i !== +b.dataset.i);
        draw();
        applyFilters();
      });
      draw();
    } else if (f.kind === 'slider') {
      if (f.id === 'callRate' && noCall) {
        g.innerHTML = `<span class="flabel">${f.label}</span><span class="fhelp">Not available – this genus has only one genome, so variability and call rate cannot be assessed.</span>`;
        body.appendChild(g);
        continue;
      }
      const show = x => f.pct ? Math.round(x * 100) + ' %' : (+x).toFixed(2);
      g.innerHTML = `<label for="f-${f.id}">${f.label}${f.id === 'callRate' ? '' : help}</label>
        <div class="slider-row"><input type="range" id="f-${f.id}" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}"><output>${show(v)}</output></div>`;
      const inp = g.querySelector('input'), out = g.querySelector('output');
      inp.addEventListener('input', () => { out.textContent = show(inp.value); });
      inp.addEventListener('change', () => { S.f[f.id] = +inp.value; applyFilters(); });
    } else if (f.kind === 'number') {
      g.innerHTML = `<label for="f-${f.id}">${f.label}</label><input type="number" id="f-${f.id}" min="${f.min}" step="1" value="${esc(v)}" placeholder="any">`;
      g.querySelector('input').addEventListener('input', debounce(e => { S.f[f.id] = e.target.value; applyFilters(); }, 250));
    } else if (f.kind === 'range') {
      const vals = rows.flatMap(r => f.fields ? f.fields.map(k => r[k]) : [f.get ? f.get(r) : r[f.field]]).filter(isNum);
      const lo = vals.length ? Math.min(...vals) : '', hi = vals.length ? Math.max(...vals) : '';
      const step = f.step || 1;
      g.innerHTML = `<span class="flabel">${f.label}${help}</span><div class="range2">
        <input type="number" step="${step}" placeholder="${lo}" value="${esc(v[0])}" aria-label="${f.label} minimum">
        <span>–</span>
        <input type="number" step="${step}" placeholder="${hi}" value="${esc(v[1])}" aria-label="${f.label} maximum"></div>`;
      const [a, b] = g.querySelectorAll('input');
      const upd = debounce(() => { S.f[f.id] = [a.value, b.value]; applyFilters(); }, 300);
      a.addEventListener('input', upd);
      b.addEventListener('input', upd);
    } else if (f.kind === 'select') {
      const opts = [...new Set(rows.map(r => r.pool).filter(x => x !== ''))].sort((x, y) => x - y);
      if (!opts.length) continue;
      g.innerHTML = `<label for="f-${f.id}">${f.label}</label><select id="f-${f.id}"><option value="">all pools</option>` +
        opts.map(o => `<option value="${o}" ${String(o) === v ? 'selected' : ''}>Pool ${o}</option>`).join('') + '</select>';
      g.querySelector('select').addEventListener('change', e => { S.f[f.id] = e.target.value; applyFilters(); });
    } else if (f.kind === 'flags') {
      g.innerHTML = `<span class="flabel">${f.label}</span>` + f.options.map(([id, lab]) =>
        `<label class="check"><input type="checkbox" value="${id}" ${v.includes(id) ? 'checked' : ''}> ${lab}</label>`).join('');
      g.addEventListener('change', () => { S.f[f.id] = [...g.querySelectorAll('input:checked')].map(i => i.value); applyFilters(); });
    }
    body.appendChild(g);
  }
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ---------------------------------------------------------------- table
function sortRows() {
  const { key, dir } = S.sort;
  const col = COLUMNS.find(c => c.key === key) || {};
  let kf;
  if (key === 'chr') kf = r => [...chrKey(r.chr), r.repStart];
  else if (col.sort === 'allele') kf = r => [alleleNum(r.allele) ?? -1];
  else if (col.num) kf = r => [isNum(r[key]) ? r[key] : -Infinity];
  else kf = r => [String(r[key] ?? '').toLowerCase()];
  const keyed = S.filtered.map(r => [kf(r), r]);
  keyed.sort((a, b) => dir * cmpArr(a[0], b[0]));
  S.filtered = keyed.map(x => x[1]);
}
function renderTable() {
  const cols = COLUMNS.filter(c => S.visible.has(c.key));
  const thead = $('#marker-table thead'), tbody = $('#marker-table tbody');
  thead.innerHTML = '<tr>' + cols.map(c => {
    const arrow = S.sort.key === c.key ? `<span class="arrow">${S.sort.dir > 0 ? '▲' : '▼'}</span>` : '';
    return `<th class="sortable${c.num ? ' num' : ''}" data-key="${c.key}" title="${esc(GLOSSARY[c.key] || '')}">${c.label}${arrow}</th>`;
  }).join('') + '</tr>';
  const n = S.filtered.length, total = S.rows.length;
  $('#count').innerHTML = `<strong>${n.toLocaleString('en-US')}</strong> of ${total.toLocaleString('en-US')} markers`;
  if (!n) {
    tbody.innerHTML = `<tr><td colspan="${cols.length}" class="empty">No markers match these filters.</td></tr>`;
    $('#pager').innerHTML = '';
    return;
  }
  const start = S.page * S.pageSize, page = S.filtered.slice(start, start + S.pageSize);
  tbody.innerHTML = page.map((r, i) => '<tr data-i="' + (start + i) + '">' + cols.map(c => {
    if (c.render) return `<td>${c.render(r)}</td>`;
    let v = c.key === 'range' && /nur Referenz/.test(r.range) ? String(r.range).replace('nur Referenz', 'reference only') : r[c.key];
    const cls = c.num ? 'num' : c.seq ? 'seq' : '';
    if (c.key === 'overlap' && v) v = String(v).split('; ').length + ' marker(s)';
    return `<td class="${cls}">${c.fmt || c.num ? fmt(v, c.fmt) : esc(v === '' ? '–' : v)}</td>`;
  }).join('') + '</tr>').join('');
  const pages = Math.ceil(n / S.pageSize);
  $('#pager').innerHTML = `
    <label>Rows per page <select id="page-size">${[50, 100, 250, 1000].map(x => `<option ${x === S.pageSize ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    <span>${start + 1}–${Math.min(start + S.pageSize, n)} of ${n.toLocaleString('en-US')}</span>
    <button type="button" data-p="prev" ${S.page === 0 ? 'disabled' : ''} aria-label="Previous page">‹</button>
    <button type="button" data-p="next" ${S.page >= pages - 1 ? 'disabled' : ''} aria-label="Next page">›</button>`;
}
function buildColumnMenu() {
  $('#col-menu').innerHTML = COLUMNS.map(c =>
    `<label class="check"><input type="checkbox" value="${c.key}" ${S.visible.has(c.key) ? 'checked' : ''}> ${c.label}</label>`).join('') +
    '<button type="button" id="cols-default">Restore default columns</button>';
}

// ---------------------------------------------------------------- detail drawer
function openDetail(r) {
  const info = S.info;
  const genomes = Object.fromEntries((info.genomes || []).map(g => [g.acc, g]));
  const alleleRows = String(r.alleles || '').split('; ').filter(Boolean).map(x => {
    const [acc, al] = x.split(':');
    const g = genomes[acc] || {};
    const role = acc === r.ref ? 'reference' : 'comparison';
    return `<tr><td>${esc(acc)}</td><td><em>${esc(g.species || '')}</em></td><td>${role}</td><td class="num">${esc(al)}</td></tr>`;
  }).join('');
  const compList = r.comps ? String(r.comps).split('; ') : (info.genomes || []).filter(g => g.role === 'comparison' && g.acc !== r.ref).map(g => g.acc);
  const typed = new Set(String(r.alleles || '').split('; ').map(x => x.split(':')[0]));
  const missing = compList.filter(a => !typed.has(a));
  const kv = (k, v) => `<dt>${k}</dt><dd>${v === '' || v === undefined || v === null ? '–' : v}</dd>`;
  const primer = (name, seq, tm, gc) => `<div class="primer"><div style="flex:1"><span class="pname">${esc(name)} · Tm ${fmt(tm, 1)} °C · GC ${fmt(gc, 1)} %</span><code>${esc(seq)}</code></div><button class="copy" type="button" data-copy="${esc(seq)}">Copy</button></div>`;
  $('#drawer-body').innerHTML = `
    <h2 id="drawer-title">${esc(r.marker)}</h2>
    <p class="taxo">${r.panel === 'sex_linked' ? '<span class="tag sex">sex-linked</span> ' : ''}Chromosome ${esc(r.chr)} · <em>${esc(r.refSp)}</em> ${esc(r.ref)}</p>
    <h3>Primers</h3>
    ${primer(r.pair + '-for', r.fSeq, r.fTm, r.fGc)}
    ${primer(r.pair + '-rev', r.rSeq, r.rTm, r.rGc)}
    <h3>Repeat</h3>
    <dl class="kv">
      ${kv('Motif', esc(r.motif))}
      ${kv('Structure (reference)', `<code>${esc(r.structure)}</code>`)}
      ${kv('Reference allele', esc(r.allele) + ' units')}
      ${kv('Repeat position', `${fmt(r.repStart, 'int')} – ${fmt(r.repEnd, 'int')}`)}
      ${kv('Amplicon', `${fmt(r.amp)} bp (${fmt(r.ampStart, 'int')} – ${fmt(r.ampEnd, 'int')})`)}
    </dl>
    <h3>Variability</h3>
    <dl class="kv">
      ${kv('Observed allelic range', esc(String(r.range).replace('nur Referenz', 'reference only')))}
      ${kv('Number of alleles (Na)', fmt(r.na))}
      ${kv('Gene diversity (H)', fmt(r.h, 3))}
      ${kv('Call rate (per species)', fmt(r.callRate, 'pct'))}
      ${kv('Call rate (all genomes)', fmt(r.callRateAll, 'pct'))}
      ${kv('Genomes with flank indel', esc(r.flankIndel))}
    </dl>
    ${alleleRows ? `<div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Genome</th><th>Species</th><th>Role</th><th class="num">Allele</th></tr></thead><tbody>${alleleRows}</tbody></table></div>` : ''}
    ${missing.length ? `<p class="fhelp" style="margin-top:6px">Not typed in: ${missing.map(esc).join(', ')}</p>` : ''}
    <h3>PCR checks</h3>
    <dl class="kv">
      ${kv('Off-target products (reference)', fmt(r.offTarget))}
      ${kv('Products in human genome', fmt(r.human))}
      ${kv('Short SSRs in amplicon', fmt(r.shortSsr))}
      ${kv('Overlapping amplicons', r.overlap ? esc(r.overlap) : 'none')}
      ${kv('Multiplex pool', fmt(r.pool))}
      ${kv('Worst dimer ΔG in pool', r.dimer === '' ? '–' : esc(r.dimer) + ' kcal/mol')}
      ${kv('Primer3 pair rank', fmt(r.rank))}
      ${kv('Locus ID', esc(r.id))}
    </dl>`;
  $('#drawer').hidden = false;
  $('#drawer .drawer-close').focus();
}
function closeDetail() { $('#drawer').hidden = true; }

// ---------------------------------------------------------------- genus loading
async function loadGenus(name, keepFilters) {
  const entry = S.index.find(g => g.genus.toLowerCase() === name.toLowerCase());
  if (!entry) return;
  $('#genus-input').value = entry.genus;
  closeSuggest();
  $('#count').textContent = 'Loading …';
  let data;
  try {
    // no-cache: beim Server nachfragen, ob es neuere Daten gibt (sonst bis 10 min alte Daten)
    const res = await fetch(`data/genera/${encodeURIComponent(entry.genus)}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch (e) {
    $('#genus-view').hidden = false;
    $('#genus-card').innerHTML = `<p>Could not load data for <em>${esc(entry.genus)}</em> (${esc(e.message)}).</p>`;
    return;
  }
  S.genus = entry.genus;
  S.info = data.info;
  // Genome sind in den Daten nur als Index in info.genomes gespeichert (kleinere Dateien)
  const G = data.info.genomes || [];
  const acc = i => (G[i] || {}).acc || '';
  S.rows = data.rows.map(a => {
    const r = Object.fromEntries(data.columns.map((c, i) => [c, a[i]]));
    const ri = r.ref;
    r.ref = acc(ri);
    r.refSp = (G[ri] || {}).species || '';
    r.alleles = String(r.alleles || '').split(',').filter(Boolean).map(x => { const [i, al] = x.split(':'); return `${acc(+i)}:${al}`; }).join('; ');
    r.comps = String(r.comps || '').split(',').filter(Boolean).map(i => acc(+i)).join('; ');
    r.motifClass = motifCanon(r.motif);
    return r;
  });
  if (!keepFilters) S.f = defaults();
  document.body.classList.add('has-genus');
  $('#genus-view').hidden = false;
  document.title = `${entry.genus} – CITES STR Marker Database`;
  renderGenusCard();
  buildFilters();
  applyFilters();
}
function renderGenusCard() {
  const i = S.info;
  const single = (i.genomes || []).filter(g => g.role === 'comparison').length === 0;
  const G = i.genomes || [];
  const byAcc = Object.fromEntries(G.map(g => [g.acc, g]));
  // Haplotyp-Paare: Assemblies desselben Individuums (z. B. hap1/hap2, mat/pat, primary/alternate)
  const partnerText = g => (g.partner || []).map(p => `${p}${byAcc[p] && byAcc[p].assembly ? ' (' + byAcc[p].assembly + ')' : ''}`).join(', ');
  const nHaplo = G.filter(g => (g.partner || []).length).length;
  const cites = (i.cites || []).map(c => `<span class="badge cites">CITES ${esc(c)}</span>`).join('');
  const genomeRows = G.map(g => `<tr><td>${esc(g.acc)}</td><td>${esc(g.assembly || '')}</td><td><em>${esc(g.species)}</em></td><td>${esc(g.role)}</td><td>${esc(g.level)}</td>
    <td>${(g.partner || []).length ? 'haplotype of the same individual as ' + esc(partnerText(g)) : ''}</td></tr>`).join('');
  $('#genus-card').innerHTML = `
    <div>
      <h2>${esc(i.genus)}</h2>
      <div class="taxo">${[i.class, i.order, i.family].filter(Boolean).map(esc).join(' › ')}</div>
      <div class="badges">${cites}
        ${single ? '<span class="badge warn">single genome – variability not assessable</span>' : ''}
        ${i.version ? `<span class="badge">pipeline ${esc(i.version)}</span>` : ''}</div>
      ${nHaplo ? `<div class="haplo-note">Haplotype assemblies of the same individual (counted as separate genomes): ` +
        G.filter(g => (g.partner || []).length && g.acc < g.partner[0])
          .map(g => esc(`${g.acc}${g.assembly ? ' (' + g.assembly + ')' : ''} + ${partnerText(g)}, ${g.species}`)).join('; ') + '</div>' : ''}
    </div>
    <div class="stats">
      <div class="stat"><strong>${(i.nAuto + i.nSex).toLocaleString('en-US')}</strong><span>markers</span></div>
      <div class="stat"><strong>${i.nGenomes}</strong><span>genomes</span></div>
      <div class="stat"><strong>${i.nSpecies}</strong><span>species with genome</span></div>
    </div>
    <details class="genus-genomes"><summary>Reference: <em>${esc(i.refSpecies)}</em> ${esc(i.reference)} – show all genomes used</summary>
      <div class="table-wrap"><table><thead><tr><th>Accession</th><th>Assembly</th><th>Species</th><th>Role</th><th>Level</th><th>Note</th></tr></thead><tbody>${genomeRows}</tbody></table></div>
    </details>`;
}

// ---------------------------------------------------------------- search suggestions
let sugIdx = -1, sugItems = [];
function matchGenera(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const g of S.index) {
    const gn = g.genus.toLowerCase();
    let s = -1, why = '';
    if (gn === q) s = 0;
    else if (gn.startsWith(q)) s = 1;
    else if (gn.includes(q)) s = 2;
    else if ((g.family || '').toLowerCase().startsWith(q)) { s = 3; why = g.family; }
    else if ((g.order || '').toLowerCase().startsWith(q)) { s = 4; why = g.order; }
    else {
      const sp = (g.species || []).find(x => x.toLowerCase().includes(q));
      if (sp) { s = 5; why = sp; }
    }
    if (s >= 0) scored.push([s, g, why]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].genus.localeCompare(b[1].genus));
  return scored.slice(0, 15);
}
function showSuggest() {
  const q = $('#genus-input').value;
  const ul = $('#suggest');
  sugItems = matchGenera(q);
  sugIdx = sugItems.length ? 0 : -1;
  if (!q.trim()) { closeSuggest(); return; }
  ul.innerHTML = sugItems.length ? sugItems.map(([, g, why], i) => `
    <li role="option" id="sug-${i}" data-genus="${esc(g.genus)}" aria-selected="${i === sugIdx}">
      <div><div class="s-main"><em>${esc(g.genus)}</em></div>
      <div class="s-sub">${esc(why ? why + ' · ' : '')}${esc([g.class, g.family].filter(Boolean).join(' › '))}</div></div>
      <div class="s-count">${(g.nAuto + g.nSex).toLocaleString('en-US')} markers</div></li>`).join('')
    : '<li class="s-empty">No genus found. Only genera with an NCBI genome that have been processed are included.</li>';
  ul.hidden = false;
  $('.search-box').setAttribute('aria-expanded', 'true');
}
function closeSuggest() { $('#suggest').hidden = true; $('.search-box').setAttribute('aria-expanded', 'false'); }
function moveSuggest(d) {
  if (!sugItems.length) return;
  sugIdx = (sugIdx + d + sugItems.length) % sugItems.length;
  document.querySelectorAll('#suggest li').forEach((li, i) => li.setAttribute('aria-selected', i === sugIdx));
  $('#genus-input').setAttribute('aria-activedescendant', 'sug-' + sugIdx);
}

// ---------------------------------------------------------------- URL state (shareable links)
function writeHash() {
  if (!S.genus) return;
  const p = new URLSearchParams();
  p.set('genus', S.genus);
  const d = defaults();
  for (const f of FILTERS) {
    const v = S.f[f.id];
    if (JSON.stringify(v) !== JSON.stringify(d[f.id]) && active(f, v)) p.set(f.id, JSON.stringify(v));
  }
  if (S.sort.key !== 'chr' || S.sort.dir !== 1) p.set('sort', `${S.sort.key}:${S.sort.dir}`);
  history.replaceState(null, '', '#' + p.toString());
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const genus = p.get('genus');
  if (!genus) return false;
  S.f = defaults();
  for (const f of FILTERS) {
    if (p.has(f.id)) { try { S.f[f.id] = JSON.parse(p.get(f.id)); } catch (e) { /* ignore */ } }
    if (f.kind === 'chips' && !Array.isArray(S.f[f.id])) S.f[f.id] = null;
    if (f.kind === 'taglist' && !Array.isArray(S.f[f.id])) S.f[f.id] = [];  // aeltere Links
  }
  if (p.get('sort')) { const [k, d] = p.get('sort').split(':'); S.sort = { key: k, dir: +d || 1 }; }
  loadGenus(genus, true);
  return true;
}

// ---------------------------------------------------------------- export
function exportRows(sep) {
  const cols = COLUMNS.filter(c => c.key !== 'panel').concat([{ key: 'panel', label: 'Type' }]);
  const q = v => {
    const s = String(v ?? '');
    return sep === ',' && /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s.replace(/[\t\n]/g, ' ');
  };
  const head = ['Genus', ...cols.map(c => c.label)].map(q).join(sep);
  const body = S.filtered.map(r => [S.genus, ...cols.map(c => r[c.key])].map(q).join(sep));
  return [head, ...body].join('\r\n');
}
function exportFasta() {
  return S.filtered.map(r => `>${r.pair}-for\n${r.fSeq}\n>${r.pair}-rev\n${r.rSeq}`).join('\n') + '\n';
}

// ---------------------------------------------------------------- browse
function renderBrowse() {
  const q = $('#browse-q').value.trim().toLowerCase(), cls = $('#browse-class').value, app = $('#browse-cites').value;
  const list = S.index.filter(g =>
    (!cls || g.class === cls) && (!app || (g.cites || []).includes(app)) &&
    (!q || [g.genus, g.family, g.order, g.class, ...(g.species || [])].join(' ').toLowerCase().includes(q)));
  $('#browse-count').textContent = `${list.length} of ${S.index.length} genera`;
  $('#browse-table thead').innerHTML = '<tr><th>Genus</th><th>Class</th><th>Order</th><th>Family</th><th>CITES</th><th class="num">Markers</th><th class="num">Sex-linked</th><th class="num">Genomes</th><th class="num">Species with genome</th></tr>';
  $('#browse-table tbody').innerHTML = list.map(g => `<tr data-genus="${esc(g.genus)}">
    <td>${esc(g.genus)}</td><td>${esc(g.class)}</td><td>${esc(g.order)}</td><td>${esc(g.family)}</td>
    <td>${esc((g.cites || []).join(', '))}</td><td class="num">${g.nAuto.toLocaleString('en-US')}</td><td class="num">${g.nSex}</td>
    <td class="num">${g.nGenomes}</td><td class="num">${g.nSpecies}</td></tr>`).join('')
    || '<tr><td colspan="9" class="empty">No genera match.</td></tr>';
}

// ---------------------------------------------------------------- navigation
function nav(view) {
  for (const v of ['search', 'browse']) {
    $('#view-' + v).hidden = v !== view;
    document.querySelector(`.tabs button[data-nav="${v}"]`).classList.toggle('active', v === view);
  }
  if (view === 'browse') renderBrowse();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- init
async function init() {
  const saved = storage.get('cites-str-columns');
  if (Array.isArray(saved) && saved.length) S.visible = new Set(saved.filter(k => COLUMNS.some(c => c.key === k)));
  S.pageSize = storage.get('cites-str-pagesize') || 100;
  S.f = defaults();
  buildColumnMenu();

  try {
    const res = await fetch('data/index.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    const idx = await res.json();
    S.index = idx.genera;
    S.meta = idx.meta;
  } catch (e) {
    $('#db-stats').textContent = 'The database could not be loaded. (Opened as a local file? Use a web server – see README.)';
    return;
  }
  const m = S.meta;
  $('#db-stats').textContent = `${m.nGenera.toLocaleString('en-US')} genera · ${m.nMarkers.toLocaleString('en-US')} markers · updated ${m.generated}`;
  $('#footer-meta').textContent = `pipeline version ${m.pipelineVersion || '–'}, generated ${m.generated}`;
  const classes = [...new Set(S.index.map(g => g.class).filter(Boolean))].sort();
  $('#browse-class').innerHTML += classes.map(c => `<option>${esc(c)}</option>`).join('');

  // search box
  const inp = $('#genus-input');
  inp.addEventListener('input', showSuggest);
  inp.addEventListener('focus', () => { if (inp.value && inp.value !== S.genus) showSuggest(); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggest(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggest(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (sugIdx >= 0) loadGenus(sugItems[sugIdx][1].genus); }
    else if (e.key === 'Escape') closeSuggest();
  });
  $('#suggest').addEventListener('mousedown', e => {
    const li = e.target.closest('li[data-genus]');
    if (li) { e.preventDefault(); loadGenus(li.dataset.genus); }
  });
  inp.addEventListener('blur', () => setTimeout(closeSuggest, 120));

  // table
  $('#marker-table thead').addEventListener('click', e => {
    const th = e.target.closest('th[data-key]');
    if (!th) return;
    const k = th.dataset.key;
    S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : (COLUMNS.find(c => c.key === k).num && k !== 'repStart' ? -1 : 1) };
    sortRows(); S.page = 0; renderTable(); writeHash();
  });
  $('#marker-table tbody').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-i]');
    if (tr) openDetail(S.filtered[+tr.dataset.i]);
  });
  $('#pager').addEventListener('click', e => {
    const b = e.target.closest('button[data-p]');
    if (!b) return;
    S.page += b.dataset.p === 'next' ? 1 : -1;
    renderTable();
    $('.results').scrollIntoView({ block: 'start' });
  });
  $('#pager').addEventListener('change', e => {
    if (e.target.id !== 'page-size') return;
    S.pageSize = +e.target.value; S.page = 0; storage.set('cites-str-pagesize', S.pageSize); renderTable();
  });
  $('#col-menu').addEventListener('change', e => {
    const k = e.target.value;
    if (e.target.checked) S.visible.add(k); else S.visible.delete(k);
    storage.set('cites-str-columns', [...S.visible]);
    renderTable();
  });
  $('#col-menu').addEventListener('click', e => {
    if (e.target.id !== 'cols-default') return;
    S.visible = new Set(COLUMNS.filter(c => c.default).map(c => c.key));
    storage.set('cites-str-columns', [...S.visible]);
    buildColumnMenu(); renderTable();
  });
  $('#reset-filters').addEventListener('click', () => { S.f = defaults(); buildFilters(); applyFilters(); });
  $('#toggle-filters').addEventListener('click', e => {
    const open = $('#filters').classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', open);
  });

  // downloads
  const stamp = () => `${S.genus}_STR_markers_${S.filtered.length}`;
  $('#dl-csv').addEventListener('click', () => download(stamp() + '.csv', '﻿' + exportRows(','), 'text/csv'));
  $('#dl-tsv').addEventListener('click', () => download(stamp() + '.tsv', '﻿' + exportRows('\t'), 'text/tab-separated-values'));
  $('#dl-fasta').addEventListener('click', () => download(stamp() + '_primers.fasta', exportFasta(), 'text/plain'));
  document.querySelectorAll('details.menu').forEach(d => d.addEventListener('click', e => {
    if (e.target.closest('.menu-pop button') && e.target.id !== 'cols-default') d.open = false;
  }));
  document.addEventListener('click', e => {
    document.querySelectorAll('details.menu[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; });
  });

  // drawer
  $('#drawer').addEventListener('click', async e => {
    if (e.target.closest('[data-close]')) closeDetail();
    const c = e.target.closest('[data-copy]');
    if (c) {
      try { await navigator.clipboard.writeText(c.dataset.copy); c.textContent = 'Copied'; } catch (err) { c.textContent = 'Select manually'; }
      setTimeout(() => { c.textContent = 'Copy'; }, 1500);
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#drawer').hidden) closeDetail(); });

  // navigation
  document.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', e => {
    e.preventDefault();
    nav(b.dataset.nav);
  }));
  ['input', 'change'].forEach(ev => {
    $('#browse-q').addEventListener(ev, renderBrowse);
    $('#browse-class').addEventListener(ev, renderBrowse);
    $('#browse-cites').addEventListener(ev, renderBrowse);
  });
  $('#browse-table tbody').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-genus]');
    if (tr) { nav('search'); loadGenus(tr.dataset.genus); }
  });

  if (!readHash()) inp.focus();
}
init();
