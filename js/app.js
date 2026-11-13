/* App controller: state, UI wiring, routing */
(function () {
  const S = A.S;
  Object.assign(S, { view: 'sky', t: 1963, playing: false, speed: 2, arrange: 'fam', colorBy: 'fam', sel: null, wasPlaying: false,
    filters: { inSvc: true, outSvc: true, ghost: false, szMin: 0, szMax: 1e9, cats: new Set(), model: null, fam: null, query: '' } });

  const $ = A.$, esc = A.esc;
  let lastDom = 0, lastYearShown = null, lastYearVal = '', lastAloft = -1, lastTipId = null;

  A.ui = {
    frame(t, counts, settled) {
      const now = performance.now();
      if (!settled && now - lastDom < 120) return; lastDom = now;
      const yr = Math.floor(t);
      if (yr !== lastYearShown) { $('#yearNum').textContent = yr; lastYearShown = yr; }
      const yv = t.toFixed(2); if (yv !== lastYearVal) { $('#year').value = t; lastYearVal = yv; }
      if (counts.aloft !== lastAloft) { lastAloft = counts.aloft; $('#aloftN').textContent = A.int(counts.aloft); $('#yearSub').textContent = A.int(counts.aloft) + ' balloons aloft'; }
      drawHist(t);
      updateLegendCounts(counts);
    },
    setPlaying(p) {
      S.playing = p; $('#play').classList.toggle('on', p); $('#play').setAttribute('aria-label', p ? 'Pause' : 'Play');
      if (p && S.t >= A.meta.now + .9) S.t = A.meta.built[0];
    },
    showTip(b, x, y) {
      const tip = $('#tooltip');
      if (lastTipId !== b.id) { lastTipId = b.id; tip.innerHTML = `<b>${esc(A.label(b))}</b><span>${esc(b.mfr || '')} ${esc(b.model || '')}${b.built ? ' · ' + b.built : ''}</span><br><span>${b.size ? A.int(b.size) + ' cu ft' : ''}${b.loc ? (b.size ? ' · ' : '') + esc(b.loc) : ''}</span>`; }
      tip.hidden = false;
      const w = tip.offsetWidth, h = tip.offsetHeight, host = $('#sky').getBoundingClientRect();
      tip.style.left = Math.min(x + 16, host.width - w - 8) + 'px'; tip.style.top = Math.max(8, y - h - 14) + 'px';
    },
    hideTip() { $('#tooltip').hidden = true; lastTipId = null; },
    select(id, opt = {}) {
      const b = id ? A.byId.get(id) : null;
      S.sel = b;
      const card = $('#card');
      if (!b) { card.hidden = true; if (S.wasPlaying) A.ui.setPlaying(true); S.wasPlaying = false; setHash(); A.Sky.dirty(); return; }
      if (opt.toSky || S.view !== 'sky') setView('sky');
      if (S.playing) { S.wasPlaying = true; A.ui.setPlaying(false); }
      // make sure it is visible in the current year
      if (b.sky && (S.t < b.t0 || S.t >= b.t1 + 1)) S.t = A.clamp(S.t, b.t0 + .2, Math.min(b.t1 - .3, A.meta.now + .9));
      if (b.sky && S.t < b.t0) S.t = b.t0 + .5;
      // un-hide if filters would exclude it
      if (!b.pass) { clearFilters(true); }
      card.classList.remove('full'); A.Card.render(b, card); card.hidden = false;
      if (opt.fly !== false) A.Sky.flyTo(b, innerWidth > 760 ? Math.min(414, innerWidth - 20) : 0, innerWidth > 760 ? 0 : innerHeight * .5);
      setHash(); A.Sky.dirty();
    },
    isolateModel(b) { S.filters.model = { key: A.mkey(b), label: (b.fam === 'Other makers' ? b.mfr + ' ' : '') + b.model }; setView('sky'); applyAndSync(); },
  };

  /* ---------- controls ---------- */
  function buildSegs() {
    const mk = (id, order, defs, key, fn) => {
      const seg = $(id);
      order.forEach(k => { const b = A.el('button', { 'data-k': k }, defs[k].label); if (S[key] === k) b.classList.add('on'); b.onclick = () => { fn(k); A.$$('button', seg).forEach(x => x.classList.toggle('on', x.dataset.k === k)); }; seg.appendChild(b); });
    };
    mk('#arrangeSeg', A.ARRANGE_ORDER, A.ARRANGE, 'arrange', k => A.Sky.arrange(k));
    mk('#colorSeg', A.MODE_ORDER, A.MODES, 'colorBy', k => { S.colorBy = k; S.filters.cats.clear(); applyAndSync(); });
  }

  function buildLegend() {
    const mode = A.MODES[S.colorBy], box = $('#legend'); box.innerHTML = '';
    const cats = Object.keys(mode.colors).filter(k => A.B.some(b => mode.cat(b) === k && b.sky));
    for (const k of cats) {
      const btn = A.el('button', { 'data-k': k }, `<i style="background:${mode.colors[k]}"></i>${esc(k)} <em>0</em>`);
      btn.onclick = () => { const c = S.filters.cats; if (c.has(k)) c.delete(k); else c.add(k); applyAndSync(); };
      box.appendChild(btn);
    }
  }
  function updateLegendCounts(counts) {
    const c = S.filters.cats;
    A.$$('#legend button').forEach(btn => {
      const k = btn.dataset.k, ix = counts.catKeys.indexOf(k), n = ix >= 0 ? counts.cc[ix] : 0, em = btn.querySelector('em'), txt = A.int(n); if (em.textContent !== txt) em.textContent = txt;
      btn.classList.toggle('on', c.has(k)); btn.classList.toggle('dim', c.size > 0 && !c.has(k));
    });
  }

  function applyAndSync() {
    A.Sky.applyFilters(); buildLegend();
    const f = S.filters, chip = $('#isolateChip');
    if (f.model || f.fam) { chip.hidden = false; chip.innerHTML = `Showing ${esc(f.model ? f.model.label + 's' : f.fam)}<button aria-label="Clear">×</button>`; chip.querySelector('button').onclick = () => { f.model = null; f.fam = null; applyAndSync(); }; }
    else chip.hidden = true;
    const dirty = f.cats.size || f.model || f.fam || f.szMin > 0 || f.szMax < 1e9 || !f.inSvc || !f.outSvc || f.ghost;
    $('#fClear').hidden = !dirty;
    updateSizeLabel(); A.Sky.dirty();
  }
  function clearFilters(silent) {
    Object.assign(S.filters, { inSvc: true, outSvc: true, ghost: false, szMin: 0, szMax: 1e9, model: null, fam: null }); S.filters.cats.clear();
    $('#fIn').checked = $('#fOut').checked = true; $('#fGhost').checked = false; $('#szMin').value = 0; $('#szMax').value = 100;
    applyAndSync();
  }

  /* size slider: log scale 12k..600k */
  const szVal = p => Math.round(Math.exp(Math.log(12000) + (p / 100) * (Math.log(600000) - Math.log(12000))) / 1000) * 1000;
  function updateSizeLabel() {
    const a = +$('#szMin').value, b = +$('#szMax').value;
    $('#szLabel').textContent = a === 0 && b === 100 ? 'any' : `${a === 0 ? '≤' : A.fmtVolShort(szVal(a)) + ' –'} ${b === 100 ? '+' : A.fmtVolShort(szVal(b))}`.replace('≤ ', '').replace(' – +', '+');
  }
  function bindFilters() {
    $('#fIn').onchange = e => { S.filters.inSvc = e.target.checked; applyAndSync(); };
    $('#fOut').onchange = e => { S.filters.outSvc = e.target.checked; applyAndSync(); };
    $('#fGhost').onchange = e => { S.filters.ghost = e.target.checked; applyAndSync(); };
    const sz = () => {
      let a = +$('#szMin').value, b = +$('#szMax').value;
      if (a > b - 3) { if (document.activeElement === $('#szMin')) { a = b - 3; $('#szMin').value = a; } else { b = a + 3; $('#szMax').value = b; } }
      S.filters.szMin = a === 0 ? 0 : szVal(a); S.filters.szMax = b === 100 ? 1e9 : szVal(b);
      applyAndSync();
    };
    $('#szMin').oninput = sz; $('#szMax').oninput = sz;
    $('#fClear').onclick = () => clearFilters();
  }

  /* ---------- timeline ---------- */
  let hist, histKey = '', histBase, histFill;
  function drawHist(t) {
    const cv = $('#histCanvas'), r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    if (!r.width) return;
    if (cv.width !== Math.round(r.width * dpr)) { cv.width = r.width * dpr; cv.height = r.height * dpr; }
    const y0 = A.meta.built[0], y1 = A.meta.now, mx = Math.max(...A.hist), w = r.width - 16, h = r.height - 22;
    const X = y => 8 + (y - y0) / (y1 + 1 - y0) * w;
    const key = r.width + 'x' + r.height + '@' + dpr;
    if (key !== histKey) {                              // static layers are drawn once per size, then only blitted
      histKey = key;
      const mk = fn => { const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); fn(x); return c; };
      const path = x => { x.beginPath(); x.moveTo(X(y0), h); A.years.forEach((y, i) => x.lineTo(X(y + .5), h - A.hist[i] / mx * (h - 4))); x.lineTo(X(y1 + .5), h); x.closePath(); };
      histBase = mk(x => { path(x); const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,180,84,.55)'); gr.addColorStop(1, 'rgba(255,180,84,.05)'); x.fillStyle = gr; x.fill();
        x.font = '10.5px "DM Sans",sans-serif'; x.fillStyle = 'rgba(255,255,255,.5)'; x.textAlign = 'center'; for (const y of [1970, 1980, 1990, 2000, 2010, 2020]) x.fillText(y, X(y), r.height - 2);
        x.textAlign = 'left'; x.fillStyle = 'rgba(255,255,255,.45)'; x.fillText('peak ' + A.int(mx) + ' aloft', X(A.years[A.hist.indexOf(mx)]) - 30, 10); });
      histFill = mk(x => { path(x); x.fillStyle = 'rgba(255,180,84,.9)'; x.fill(); });
    }
    const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(histBase, 0, 0);
    const cw = Math.max(0, Math.min(cv.width, X(t) * dpr)); if (cw > 0) g.drawImage(histFill, 0, 0, cw, cv.height, 0, 0, cw, cv.height);
  }
  function bindTimeline() {
    $('#play').onclick = () => A.ui.setPlaying(!S.playing);
    A.$$('#speed button').forEach(b => b.onclick = () => { S.speed = +b.dataset.s; A.$$('#speed button').forEach(x => x.classList.toggle('on', x === b)); });
    $('#year').oninput = e => { S.t = +e.target.value; lastYearShown = null; A.Sky.dirty(); };
    $('#year').min = A.meta.built[0]; $('#year').max = A.meta.now + .99;
    addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' && e.target.type !== 'range') { if (e.key === 'Escape') e.target.blur(); return; }
      if (e.key === ' ') { e.preventDefault(); A.ui.setPlaying(!S.playing); }
      else if (e.key === 'Escape') { if (!$('#about').hidden) $('#about').hidden = true; else if (S.sel) A.ui.select(null); }
      else if (e.key === 'ArrowRight' && e.target.id !== 'year') { S.t = Math.min(A.meta.now + .99, S.t + 1); lastYearShown = null; }
      else if (e.key === 'ArrowLeft' && e.target.id !== 'year') { S.t = Math.max(A.meta.built[0], S.t - 1); lastYearShown = null; }
      else if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
    });
  }

  /* ---------- search ---------- */
  function bindSearch() {
    const q = $('#q'), box = $('#results'); let items = [], cur = -1;
    const run = () => {
      const s = q.value.trim().toLowerCase(); if (s.length < 2) { box.hidden = true; return; }
      const terms = s.split(/\s+/); items = [];
      for (const b of A.B) { if (terms.every(t => b.search.includes(t))) { items.push(b); if (items.length > 400) break; } }
      items.sort((a, b) => (A.label(b).toLowerCase().startsWith(s)) - (A.label(a).toLowerCase().startsWith(s)) || (b.status === 'in') - (a.status === 'in'));
      const top = items.slice(0, 12);
      box.innerHTML = top.map((b, i) => `<li data-id="${b.id}"><span class="dot" style="background:${A.FAM_COLORS[b.fam] || A.UNK}"></span><span>${esc(A.label(b))}</span><small>${esc(b.reg && b.name ? b.reg + ' · ' : '')}${esc(b.mfr || '')} ${esc(b.model || '')}</small></li>`).join('') + (items.length > 12 ? `<li style="color:var(--ink3);cursor:default">${items.length > 400 ? '400+' : items.length} matches — keep typing</li>` : '') || '<li style="color:var(--ink3);cursor:default">No match</li>';
      box.hidden = false; cur = -1;
    };
    q.addEventListener('input', run);
    q.addEventListener('keydown', e => {
      const lis = A.$$('li[data-id]', box);
      if (e.key === 'ArrowDown') { cur = Math.min(lis.length - 1, cur + 1); e.preventDefault(); } else if (e.key === 'ArrowUp') { cur = Math.max(0, cur - 1); e.preventDefault(); }
      else if (e.key === 'Enter') { const li = lis[Math.max(0, cur)]; if (li) { A.ui.select(li.dataset.id, { fly: true }); box.hidden = true; q.blur(); } }
      lis.forEach((l, i) => l.classList.toggle('on', i === cur));
    });
    box.addEventListener('click', e => { const li = e.target.closest('li[data-id]'); if (li) { A.ui.select(li.dataset.id, { fly: true }); box.hidden = true; q.value = ''; } });
    document.addEventListener('click', e => { if (!e.target.closest('.search')) box.hidden = true; });
  }

  /* ---------- views, card actions, hash ---------- */
  function setView(v) {
    S.view = v; $('#app').dataset.view = v;
    A.$$('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === v));
    $('#sky').hidden = v !== 'sky'; $('#lineage').hidden = v !== 'lineage';
    $('#timeline').style.display = v === 'sky' ? '' : 'none';
    if (v === 'lineage') { if (S.playing) A.ui.setPlaying(false); A.Lineage.show(); } else { A.Sky.resize(); A.Sky.dirty(); }
    setHash();
  }
  function bindCard() {
    $('#card').addEventListener('click', e => {
      if (e.target.closest('.c-close')) return A.ui.select(null);
      if (e.target.closest('.c-handle')) return $('#card').classList.toggle('full');
      const act = e.target.closest('[data-act]')?.dataset.act, b = S.sel;
      if (act === 'fly') A.Sky.flyTo(b, innerWidth > 760 ? 414 : 0, innerWidth > 760 ? 0 : innerHeight * .5);
      if (act === 'isolate') A.ui.isolateModel(b);
      if (act === 'lineage') { A.Lineage.focus(b); setView('lineage'); }
      const own = e.target.closest('[data-owner]'); if (own && own.dataset.owner) { $('#q').value = own.dataset.owner; $('#q').dispatchEvent(new Event('input')); $('#q').focus(); }
    });
  }
  function setHash() {
    const p = new URLSearchParams(); if (S.view !== 'sky') p.set('view', S.view); if (S.sel) p.set('b', S.sel.id);
    const h = p.toString(); history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
  }
  function readHash() {
    const y = +new URLSearchParams(location.search).get('year'); if (y) S.t = y;
    const p = new URLSearchParams(location.hash.slice(1)); if (p.get('view') === 'lineage') setView('lineage');
    if (p.get('b') && A.byId.has(p.get('b'))) A.ui.select(p.get('b'), { fly: true });
  }

  function bindAbout() {
    $('#btnInfo').onclick = () => {
      const m = $('#about'), M = A.meta;
      m.innerHTML = `<div class="sheet"><h2>About this atlas</h2>
        <p>${A.int(M.count)} hot air balloons from a hand-built database, shown as they climb the sky year by year. Each balloon rises with its age. Size on screen is its envelope volume.</p>
        <h4>What is measured</h4><p>Build year, rebuild years, envelope volume, maker, model, status (in service or out), owner history and event sightings come straight from the database.</p>
        <h4>What is modeled</h4><p><b>Retirement years.</b> The database says whether a balloon is out of service, not when it stopped. For the animation, each retired balloon gets a retirement year drawn from a Weibull survival curve fitted to how many balloons of each build year are still flying, and never earlier than its last sighting or rebuild. Those years are estimates and are labeled as such.</p>
        <h4>Caveats</h4><p>${A.int(A.B.filter(b => !b.sky).length)} balloons have no build year and cannot fly in the Sky (search still finds them). Owner order is as listed; transfer dates are not recorded. Old retired balloons are under-represented, because the database follows the surviving fleet.</p>
        <p style="margin-top:12px;font-size:12px;color:var(--ink3)">Renderer: ${({webgl2:'WebGL 2',webgl1:'WebGL 1',['2d']:'Canvas 2D (no GPU needed)'})[A.perf.backend] || A.perf.backend}</p>
        <div class="btnrow"><button class="btn primary" id="aboutX">Back to the sky</button></div></div>`;
      m.hidden = false; $('#aboutX').onclick = () => m.hidden = true; m.onclick = e => { if (e.target === m) m.hidden = true; };
    };
  }

  /* ---------- boot ---------- */
  A.load().then(() => {
    $('#year').min = A.meta.built[0];
    buildSegs(); buildLegend(); bindFilters(); bindTimeline(); bindSearch(); bindCard(); bindAbout();
    $('#zIn').onclick = () => A.Sky.zoom(1.5); $('#zOut').onclick = () => A.Sky.zoom(1 / 1.5); $('#zReset').onclick = () => A.Sky.reset();
    A.$$('.tabs button').forEach(b => b.onclick = () => setView(b.dataset.view));
    $('#ctlBtn').onclick = () => { const h = $('#hudTL'); const o = h.classList.toggle('open'); $('#ctlBtn').setAttribute('aria-expanded', o); };
    S.t = A.meta.built[0];
    A.Lineage.init($('#lineage'));
    A.Sky.init($('#skyCanvas'));
    readHash();
    addEventListener('resize', () => { if (S.view === 'lineage') A.Lineage.show(); });
    // gentle intro: autoplay once unless deep-linked
    if (!S.sel && !location.search.includes('year')) setTimeout(() => A.ui.setPlaying(true), 600);
    window.A = A;
  }).catch(err => { document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:60px;color:#fff">Could not load data: ${esc(err.message)}</pre>`); console.error(err); });
})();
