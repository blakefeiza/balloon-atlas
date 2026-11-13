/* Lineage view: maker families -> naming series -> models, drawn as a tree over build years */
A.Lineage = (function () {
  let root, built = false, curMax = 1, curTree = null, curFam = null;
  const st = { fam: null, mkey: null, open: false };
  const ROW = 24, HEAD = 30, TOP = 34; let LABEL = 178;

  const seriesOf = (b) => {
    const m = b.model; if (!m) return 'Other';
    if (b.fam === 'Other makers') return b.mfr || 'Other';
    const a = m.match(/^([A-Za-z]+)(?=[\s\-\d]|$)/); if (a) return a[1].toUpperCase() + ' series';
    return /^\d/.test(m) ? 'Numbered models' : 'Other';
  };
  const median = arr => { const a = arr.filter(Boolean).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };

  function families() {
    const m = new Map();
    for (const b of A.B) { if (b.fam === 'Unknown') continue; (m.get(b.fam) || m.set(b.fam, []).get(b.fam)).push(b); }
    return [...m].map(([fam, list]) => ({ fam, list })).sort((a, b) => (a.fam === 'Other makers') - (b.fam === 'Other makers') || b.list.length - a.list.length);
  }

  function spark(list, color) {
    const y0 = A.meta.built[0], n = A.meta.now - y0 + 1, c = Array(n).fill(0);
    for (const b of list) if (b.built) c[b.built - y0]++;
    const mx = Math.max(...c), w = 190;
    let d = `M0 22`; c.forEach((v, i) => d += ` L${(i / (n - 1) * w).toFixed(1)} ${(22 - v / mx * 20).toFixed(1)}`); d += ` L${w} 22Z`;
    return `<svg viewBox="0 0 ${w} 22" preserveAspectRatio="none"><path d="${d}" fill="${color}" opacity=".55"/></svg>`;
  }

  function buildModels(list) {
    const models = new Map();
    for (const b of list) { if (!b.model) continue; const k = A.mkey(b); (models.get(k) || models.set(k, { key: k, model: b.model, mfr: b.mfr, series: seriesOf(b), list: [] }).get(k)).list.push(b); }
    const out = [...models.values()];
    for (const m of out) {
      const ys = m.list.map(b => b.built).filter(Boolean);
      m.n = m.list.length; m.y0 = ys.length ? Math.min(...ys) : null; m.y1 = ys.length ? Math.max(...ys) : null;
      m.byYear = new Map(); for (const b of m.list) if (b.built) { const e = m.byYear.get(b.built) || [0, 0]; e[0]++; if (b.status === 'in') e[1]++; m.byYear.set(b.built, e); }
    }
    return out.filter(m => m.y0 !== null);
  }

  function renderTree(fam, list) {
    const color = A.FAM_COLORS[fam] || A.UNK; LABEL = root.clientWidth < 760 ? 96 : 178;
    let models = buildModels(list).filter(m => m.n >= 3);
    const bySeries = new Map();
    for (const m of models) (bySeries.get(m.series) || bySeries.set(m.series, []).get(m.series)).push(m);
    // fold tiny series into "Other"
    const series = [];
    for (const [name, ms] of bySeries) series.push({ name, ms, n: ms.reduce((a, m) => a + m.n, 0) });
    let other = series.filter(s => s.n < 12 && s.name !== 'Other');
    let main = series.filter(s => !other.includes(s));
    if (other.length) { const ex = main.find(s => s.name === 'Other'); const ms = other.flatMap(s => s.ms); if (ex) ex.ms.push(...ms); else main.push({ name: 'Other', ms, n: ms.reduce((a, m) => a + m.n, 0) }); }
    for (const s of main) { s.ms.sort((a, b) => a.y0 - b.y0 || b.n - a.n); s.y0 = Math.min(...s.ms.map(m => m.y0)); s.y1 = Math.max(...s.ms.map(m => m.y1)); s.n = s.ms.reduce((a, m) => a + m.n, 0); }
    main.sort((a, b) => a.y0 - b.y0 || b.n - a.n);
    if (!main.length) return { svg: '<p style="color:var(--ink3);padding:20px 0">Not enough model data for this maker.</p>', models: [] };

    const allY0 = Math.floor(Math.min(...main.map(s => s.y0)) / 10) * 10, yEnd = A.meta.now + 1;
    const wTotal = Math.max(root.clientWidth < 760 ? 560 : 640, root.clientWidth - (root.clientWidth > 760 ? 230 : 0) - 60 - (root.clientWidth > 1050 ? 340 : 0));
    const X = y => LABEL + 18 + (y - allY0) / (yEnd - allY0) * (wTotal - LABEL - 40);
    const maxC = Math.max(...main.flatMap(s => s.ms.flatMap(m => [...m.byYear.values()].map(e => e[0]))));
    curMax = maxC;
    let y = TOP, rows = [], svg = '';
    for (const s of main) {
      const yh = y + HEAD / 2; s.yh = yh; y += HEAD;
      for (const m of s.ms) { m.yy = y + ROW / 2; y += ROW; rows.push(m); }
      y += 6;
    }
    const H = y + 20, trunkX = 14;
    svg += `<svg class="tree" width="${wTotal}" height="${H}" viewBox="0 0 ${wTotal} ${H}">`;
    // axis
    svg += `<g class="axis">`;
    for (let yr = Math.ceil(allY0 / 10) * 10; yr <= 2020; yr += 10) svg += `<line x1="${X(yr)}" x2="${X(yr)}" y1="${TOP - 8}" y2="${H - 10}"/><text x="${X(yr)}" y="${TOP - 14}" text-anchor="middle">${yr}</text>`;
    svg += `</g>`;
    // trunk
    svg += `<path d="M${trunkX} ${TOP - 8} V${main[main.length - 1].yh}" stroke="${color}" stroke-width="3" opacity=".8" fill="none" stroke-linecap="round"/>`;
    svg += `<text x="${trunkX}" y="12" fill="${color}" font-size="11" font-weight="700" style="fill:${color}">${A.esc(fam)}</text>`;
    for (const s of main) {
      const xs = X(s.y0), xe = X(s.y1 + 1);
      svg += `<path d="M${trunkX} ${s.yh} Q${trunkX + 10} ${s.yh} ${trunkX + 20} ${s.yh} H${xs}" stroke="${color}" stroke-width="2" fill="none" opacity=".7"/>`;
      svg += `<circle cx="${xs}" cy="${s.yh}" r="4.5" fill="${color}"/>`;
      svg += `<text class="sname" x="${trunkX + 26}" y="${s.yh + 4}">${A.esc(s.name)}</text><text x="${LABEL + 6 > xs + 10 ? LABEL + 6 : xs + 10}" y="${s.yh + 4}" font-size="11" style="fill:var(--ink3)">${A.int(s.n)} balloons · ${s.y0}–${s.y1}</text>`;
      for (const m of s.ms) {
        const xm = X(m.y0), ym = m.yy;
        svg += `<path d="M${xs} ${s.yh} V${ym - 7} Q${xs} ${ym} ${xs + 7} ${ym} H${Math.max(xm - 2, xs + 7)}" stroke="${color}" stroke-width="1.2" fill="none" opacity=".4"/>`;
        svg += `<g class="row${m.key === st.mkey ? ' on' : ''}" data-key="${A.esc(m.key)}"><rect class="hit" x="${trunkX + 20}" y="${ym - ROW / 2}" width="${wTotal - trunkX - 20}" height="${ROW}" rx="6"/>`;
        svg += `<text class="lab" x="${trunkX + 34}" y="${ym + 4}">${A.esc(m.model)}</text>`;
        for (const [yr, [c, ins]] of m.byYear) svg += `<rect class="cell" data-m="${A.esc((fam === 'Other makers' ? m.mfr + ' ' : '') + m.model)}" data-y="${yr}" data-c="${c}" data-i="${ins}" x="${X(yr)}" y="${ym - 7}" width="${Math.max(3, X(yr + 1) - X(yr) - .8)}" height="14" rx="2" fill="${color}" opacity="${(.4 + .6 * Math.sqrt(c / maxC)).toFixed(2)}"/>`;
        svg += `<text x="${X(m.y1 + 1) + 6}" y="${ym + 4}" font-size="11" style="fill:var(--ink3)">${A.int(m.n)}</text></g>`;
      }
    }
    svg += `</svg>`;
    return { svg, models: rows };
  }

  function detail(fam, m) {
    if (!m) return '';
    const color = A.FAM_COLORS[fam] || A.UNK, list = m.list;
    const inS = list.filter(b => b.status === 'in').length;
    const med = median(list.map(b => b.size));
    const locs = {}; for (const b of list) if (b.loc) locs[b.loc] = (locs[b.loc] || 0) + 1;
    const top = Object.entries(locs).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l, c]) => `${l} (${c})`).join(', ');
    const shown = [...list].sort((a, b) => (b.status === 'in') - (a.status === 'in') || (b.built || 0) - (a.built || 0)).slice(0, 40);
    return `<button class="x" data-act="closeDetail" aria-label="Close">×</button><h2>${A.esc(fam === 'Other makers' ? m.mfr + ' ' : '')}${A.esc(m.model)}</h2>
      <p style="color:var(--ink2);margin-top:4px">${m.y0 === m.y1 ? 'Built in ' + m.y0 : 'Built ' + m.y0 + '–' + m.y1}${A.esc(m.mfr && fam !== 'Other makers' ? ' · ' + m.mfr : '')}</p>
      <div class="kpis" style="margin-top:12px"><div><b>${A.int(m.n)}</b><small>in database</small></div><div><b>${Math.round(inS / m.n * 100)}%</b><small>in service</small></div><div><b>${med ? A.fmtVolShort(med) : '—'}</b><small>median cu ft</small></div></div>
      ${top ? `<p class="fine" style="font-size:12px;color:var(--ink3);margin-top:10px">Most common homes: ${A.esc(top)}</p>` : ''}
      <div class="btnrow"><button class="btn primary" data-act="sky">Fly them in the Sky</button></div>
      <div class="chips">${shown.map(b => `<button class="chip" data-id="${b.id}" title="${A.esc(A.label(b))}"><i style="background:${b.status === 'in' ? '#ffc247' : '#6f86d6'}"></i>${A.esc(A.label(b).slice(0, 22))}${b.built ? ' · ' + String(b.built).slice(2) : ''}</button>`).join('')}${list.length > 40 ? `<span class="chip" style="opacity:.6">+${list.length - 40} more</span>` : ''}</div>`;
  }

  function show() {
    const fams = families();
    if (!st.fam) st.fam = fams[0].fam;
    const f = fams.find(x => x.fam === st.fam) || fams[0];
    const color = A.FAM_COLORS[f.fam] || A.UNK;
    const tree = renderTree(f.fam, f.list);
    if (!st.mkey || !tree.models.find(m => m.key === st.mkey)) st.mkey = tree.models.slice().sort((a, b) => b.n - a.n)[0]?.key;
    const cur = tree.models.find(m => m.key === st.mkey); curTree = tree; curFam = f.fam;
    const wide = root.clientWidth > 1050;
    const mfrs = [...new Set(f.list.map(b => b.mfr).filter(Boolean))];
    const yrs = f.list.map(b => b.built).filter(Boolean);
    root.innerHTML = `
      <div class="lin-fams"><h2>Makers</h2>${fams.map(x => { const c = A.FAM_COLORS[x.fam] || A.UNK; return `<button class="fam${x.fam === f.fam ? ' on' : ''}" data-fam="${A.esc(x.fam)}"><b><i style="background:${c}"></i>${A.esc(x.fam)}</b><small>${A.int(x.list.length)} balloons</small>${spark(x.list, c)}</button>`; }).join('')}</div>
      <div class="lin-main">
        <div class="lin-head"><div><h1 style="color:${color}">${A.esc(f.fam)}</h1>
          <p>${f.fam === 'Other makers' ? 'Smaller makers pooled together, grouped by manufacturer.' : mfrs.length > 1 ? 'Brands combined in this family: ' + A.esc(mfrs.slice(0, 6).join(', ')) + '.' : ''} Each branch is a naming series, each row a model. Brighter cells mean more balloons built that year.</p></div>
          <div class="kpis"><div><b>${A.int(f.list.length)}</b><small>balloons</small></div><div><b>${Math.min(...yrs)}–${Math.max(...yrs)}</b><small>years built</small></div><div><b>${A.int(tree.models.length)}</b><small>models (3+ balloons)</small></div></div></div>
        <div class="lin-key"><span>Each square is one build year. Brighter means more balloons built that year.</span><span class="ramp">${[0, .15, .5, 1].map(k => `<i style="background:${color};opacity:${(.4 + .6 * Math.sqrt(k)).toFixed(2)}"></i>`).join('')}</span><span>1 to ${curMax}. Hover or tap a square for the count.</span></div>
        <div class="lin-body" style="display:grid;grid-template-columns:${wide ? '1fr 320px' : '1fr'};gap:18px;align-items:start">
          <div style="overflow-x:auto">${tree.svg}</div>
          ${wide ? `<div class="lin-detail" style="position:sticky;top:0">${detail(f.fam, cur)}</div>` : ''}
        </div>
      </div>
      ${wide ? '' : `<div class="lin-detail sheet" ${st.open ? '' : 'hidden'}>${detail(f.fam, cur)}</div>`}`;
  }

  function selectModel(key) {
    st.mkey = key; const m = curTree.models.find(x => x.key === key); if (!m) return;
    A.$$('.row', root).forEach(r => r.classList.toggle('on', r.dataset.key === key));
    st.open = true; const d = A.$('.lin-detail', root); d.innerHTML = detail(curFam, m); d.hidden = false;
  }
  let tip;
  function showTip(c, x, y) {
    if (!tip) { tip = A.el('div', { class: 'lin-tip' }); document.body.appendChild(tip); }
    const n = +c.dataset.c, ins = +c.dataset.i;
    tip.innerHTML = `<b>${A.esc(c.dataset.m)}</b><span>Built in ${c.dataset.y}</span><br><em>${n} balloon${n === 1 ? '' : 's'}</em> <span>· ${ins} still in service</span>`;
    tip.style.display = 'block';
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = A.clamp(x + 14, 8, innerWidth - w - 8) + 'px'; tip.style.top = (y - h - 14 < 8 ? y + 18 : y - h - 14) + 'px';
  }
  const hideTip = () => { if (tip) tip.style.display = 'none'; };
  function bind() {
    root.addEventListener('mousemove', e => { const c = e.target.closest('.cell'); if (c) showTip(c, e.clientX, e.clientY); else hideTip(); });
    root.addEventListener('mouseleave', hideTip);
    root.addEventListener('scroll', hideTip, true);
    root.addEventListener('click', e => {
      const fam = e.target.closest('[data-fam]'); if (fam) { hideTip(); st.fam = fam.dataset.fam; st.mkey = null; st.open = false; show(); return; }
      const cell = e.target.closest('.cell'); if (cell) showTip(cell, e.clientX, e.clientY); else hideTip();
      const row = e.target.closest('.row'); if (row) { selectModel(row.dataset.key); return; }
      const chip = e.target.closest('.chip[data-id]'); if (chip) { hideTip(); A.ui.select(chip.dataset.id, { fly: true, toSky: true }); return; }
      if (e.target.closest('[data-act=closeDetail]')) { st.open = false; const d = A.$('.lin-detail.sheet', root); if (d) d.hidden = true; return; }
      if (e.target.closest('[data-act=sky]')) { const m = A.byModel.get(st.mkey); if (m) A.ui.isolateModel(m[0]); }
    });
  }

  return {
    init(el) { root = el; bind(); },
    focus(b) { st.fam = b.fam; st.mkey = b.model ? A.mkey(b) : null; },
    show() { if (A.B.length) show(); },
  };
})();
