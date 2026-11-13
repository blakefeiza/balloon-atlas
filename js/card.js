/* Balloon detail card */
A.Card = (function () {
  const W = 368;
  let sizeHist = null, builtHist = null;

  function prep() {
    if (sizeHist) return;
    const lo = Math.log(2000), hi = Math.log(700000), n = 44;
    sizeHist = Array(n).fill(0);
    for (const v of A.vols) sizeHist[Math.min(n - 1, Math.floor((Math.log(v) - lo) / (hi - lo) * n))]++;
    const y0 = A.meta.built[0], y1 = A.meta.now;
    builtHist = Array(y1 - y0 + 1).fill(0);
    for (const b of A.B) if (b.status === 'in' && b.built && b.built >= y0 && b.built <= y1) builtHist[b.built - y0]++;
  }

  const sizeX = v => 14 + (Math.log(v) - Math.log(2000)) / (Math.log(700000) - Math.log(2000)) * (W - 28);

  function ladder(b) {
    const mx = Math.max(...sizeHist), n = sizeHist.length, bw = (W - 28) / n;
    let s = `<svg viewBox="0 0 ${W} 128" width="100%" role="img" aria-label="Size compared with the fleet and real-world objects">`;
    sizeHist.forEach((c, i) => { const h = c / mx * 46; s += `<rect x="${14 + i * bw + .5}" y="${74 - h}" width="${bw - 1}" height="${h}" rx="1.5" fill="rgba(255,255,255,.16)"/>`; });
    s += `<line x1="14" x2="${W - 14}" y1="75" y2="75" stroke="rgba(255,255,255,.25)"/>`;
    A.BENCH.forEach((o, i) => {
      const x = sizeX(o.v), row = i % 2;
      s += `<line x1="${x}" x2="${x}" y1="75" y2="${88 + row * 16}" stroke="rgba(255,255,255,.35)"/><circle cx="${x}" cy="75" r="2.6" fill="#fff"/>
      <text x="${x}" y="${99 + row * 16}" text-anchor="${i === 0 ? 'start' : 'middle'}" font-size="10.5" fill="rgba(255,255,255,.7)">${o.name}</text>`;
    });
    if (b.size) {
      const x = sizeX(Math.min(Math.max(b.size, 2000), 700000));
      s += `<path d="M${x} 74 l-6 -11 h12z" fill="#ffb454"/><line x1="${x}" x2="${x}" y1="16" y2="63" stroke="#ffb454" stroke-width="1.5" stroke-dasharray="2 3"/>
      <g transform="translate(${x - 9},0)"><use href="#glyph" width="18" height="22" style="color:#ffb454"/></g>
      <text x="${A.clamp(x, 56, W - 56)}" y="10" text-anchor="middle" font-size="11" font-weight="700" fill="#ffb454">${A.int(b.size)}</text>`;
    }
    return s + '</svg>';
  }

  function ageStrip(b) {
    const y0 = A.meta.built[0], y1 = A.meta.now, n = builtHist.length, mx = Math.max(...builtHist), bw = (W - 28) / n;
    let s = `<svg viewBox="0 0 ${W} 84" width="100%" role="img" aria-label="Build year compared with the in-service fleet">`;
    builtHist.forEach((c, i) => { const h = c / mx * 40, yr = y0 + i, on = yr === b.built; s += `<rect x="${14 + i * bw}" y="${56 - h}" width="${bw - .6}" height="${h}" fill="${on ? '#ffb454' : 'rgba(255,255,255,.18)'}"/>`; });
    s += `<line x1="14" x2="${W - 14}" y1="57" y2="57" stroke="rgba(255,255,255,.25)"/>`;
    for (const yr of [1970, 1980, 1990, 2000, 2010, 2020]) { const x = 14 + (yr - y0 + .5) * bw; s += `<text x="${x}" y="72" text-anchor="middle" font-size="10.5" fill="rgba(255,255,255,.55)">${yr}</text>`; }
    if (b.built) { const x = 14 + (b.built - y0 + .5) * bw; s += `<path d="M${x} 58 l-5 -9 h10z" fill="#ffb454" transform="translate(0,-0)"/>`; }
    return s + '</svg>';
  }

  function peersStrip(b, peers) {
    const y0 = A.meta.built[0], y1 = A.meta.now, span = y1 - y0 + 1;
    let s = `<svg viewBox="0 0 ${W} 62" width="100%" role="img" aria-label="Build years of balloons of the same model">`;
    s += `<line x1="14" x2="${W - 14}" y1="46" y2="46" stroke="rgba(255,255,255,.25)"/>`;
    for (const yr of [1970, 1980, 1990, 2000, 2010, 2020]) s += `<text x="${14 + (yr - y0 + .5) / span * (W - 28)}" y="59" text-anchor="middle" font-size="10.5" fill="rgba(255,255,255,.55)">${yr}</text>`;
    for (const p of peers) { if (!p.built || p === b) continue; const x = 14 + (p.built - y0 + .5) / span * (W - 28), y = 40 - p.h2 * 26; s += `<circle cx="${x}" cy="${y}" r="3" fill="${A.FAM_COLORS[p.fam] || A.UNK}" opacity=".7"/>`; }
    if (b.built) { const x = 14 + (b.built - y0 + .5) / span * (W - 28); s += `<circle cx="${x}" cy="30" r="6.5" fill="#ffb454" stroke="#2a1700" stroke-width="2"/>`; }
    return s + '</svg>';
  }

  function seenStrip(b) {
    const ys = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
    return `<div style="display:flex;gap:5px">${ys.map(y => { const on = b.yearsSeen.includes(y); return `<div style="flex:1;text-align:center"><div style="height:26px;border-radius:7px;background:${on ? 'linear-gradient(#ffc86e,#ff8a4c)' : 'rgba(255,255,255,.07)'};box-shadow:${on ? '0 0 14px rgba(255,160,70,.45)' : 'none'}"></div><small style="font-size:10px;color:var(--ink3)">${String(y).slice(2)}</small></div>`; }).join('')}</div>`;
  }

  function sizeText(b) {
    if (!b.size) return `<p class="big">No envelope size is recorded for this balloon.</p>`;
    const p = A.pct(b.size), v = b.size;
    const house = v / 20000, pool = v / 88300, cont = v / 2390;
    const med = 90000;
    const rel = v >= 150000 ? `<b>${A.int(Math.round(p * 100))}%</b> of balloons are smaller. This is a giant.` : v <= 50000 ? `Only <b>${A.int(Math.round(p * 100))}%</b> of balloons are smaller. A pocket-sized one.` : `Bigger than <b>${A.int(Math.round(p * 100))}%</b> of the ${A.int(A.vols.length)} balloons with a recorded size.`;
    const eq = pool >= .5 ? `about <b>${pool.toFixed(pool < 2 ? 2 : 1)} Olympic pools</b> of air` : `about <b>${house.toFixed(1)} houses</b> of air`;
    return `<p class="big">${rel} It holds ${eq}, or <b>${cont.toFixed(0)}</b> 40-foot shipping containers. The typical balloon is ${A.int(med)} cu ft${v > med ? ` (this one is ${(v / med).toFixed(1)}× that)` : v < med ? ` (this one is ${(v / med * 100).toFixed(0)}% of that)` : ''}.</p>`;
  }

  function ageText(b) {
    if (!b.built) return `<p class="big">No build year is recorded, so this balloon cannot take off in the Sky view.</p>`;
    const now = A.meta.now, inSvc = b.status !== 'out';
    const age = now - b.built;
    const older = A.B.filter(o => o.status === 'in' && o.built && o.built > b.built).length / A.B.filter(o => o.status === 'in' && o.built).length;
    let t = inSvc ? `Built in <b>${b.built}</b>, it is <b>${age} year${age === 1 ? '' : 's'} old</b> and older than <b>${Math.round(older * 100)}%</b> of balloons still in service.`
      : `Built in <b>${b.built}</b>. It is listed as out of service${b.end ? ` and likely stopped flying around <b>${Math.round(b.end)}</b> (modeled, see below)` : ''}.`;
    if (b.rebuilt.length) t += ` Rebuilt in <b>${b.rebuilt.join(' and ')}</b>.`;
    let note = b.endEst ? `<p class="fine">The database has no retirement dates. The Sky animation assigns each out-of-service balloon a retirement year from a survival curve fitted to how many balloons of each build year are still flying, never earlier than its last sighting or rebuild.</p>` : '';
    return `<p class="big">${t}</p>${note}`;
  }

  function chain(b) {
    const cur = b.owner;
    let h = `<div class="chain">`;
    h += `<div class="link-node start"><span class="pip"></span><div><b style="cursor:default">Built${b.built ? ' ' + b.built : ''}</b><small>${A.esc(b.mfr || '')} ${A.esc(b.model || '')}</small></div></div>`;
    for (const [o, n] of b.prev) h += `<div class="link-node"><span class="pip"></span><div><b data-owner="${A.esc(o)}">${A.esc(o)}</b>${n ? `<small>flown as “${A.esc(n)}”</small>` : ''}</div></div>`;
    h += `<div class="link-node cur"><span class="pip"></span><div><b data-owner="${A.esc(cur || '')}">${A.esc(cur || 'Owner not recorded')}</b><small>current owner / pilot${b.name ? ` · “${A.esc(b.name)}”` : ''}</small></div></div></div>`;
    return h;
  }

  function render(b, el) {
    prep();
    const color = A.FAM_COLORS[b.fam] || A.UNK;
    const peers = b.model ? (A.byModel.get(A.mkey(b)) || []) : [];
    const st = b.status === 'in' ? '<span class="pill in"><i></i>In service</span>' : b.status === 'out' ? '<span class="pill out"><i></i>Out of service</span>' : '<span class="pill"><i></i>Status unknown</span>';
    const age = b.built ? A.meta.now - b.built : null;
    el.innerHTML = `
      <div class="c-hero">
        ${b.img ? `<img alt="Photo of ${A.esc(A.label(b))}" referrerpolicy="no-referrer" src="${A.photo(b.img, 800)}">` : ''}
        ${A.balloonSVG(color, A.shape(b))}
        <button class="c-close" aria-label="Close details">×</button>
      </div>
      <div class="c-body">
        <h2 class="c-title">${A.esc(A.label(b))}</h2>
        <div class="c-sub">${st}${b.reg && b.name ? `<span>${A.esc(b.reg)}</span>` : ''}<span>${A.esc(b.fam === 'Unknown' ? '' : (b.mfr || ''))} ${A.esc(b.model || '')}</span></div>
        <div class="c-grid">
          <div class="stat"><small>Built</small><b>${b.built || '—'}</b><u>${b.rebuilt.length ? 'rebuilt ' + b.rebuilt.join(', ') : b.serial ? 'serial ' + A.esc(b.serial) : ''}</u></div>
          <div class="stat"><small>Volume</small><b>${b.size ? A.fmtVolShort(b.size) : '—'}</b><u>cu ft</u></div>
          <div class="stat"><small>${b.status === 'out' ? 'Last flew' : 'Age'}</small><b>${b.status === 'out' ? (b.end ? '~' + Math.round(b.end) : '—') : age !== null ? age + ' yr' : '—'}</b><u>${b.status === 'out' && b.end ? 'modeled' : ''}</u></div>
          <div class="stat" style="grid-column:span 2"><small>Home</small><b style="font-size:16px">${A.esc(b.loc || 'Not recorded')}</b><u>${A.esc(b.owner || '')}</u></div>
          <div class="stat"><small>Shape</small><b style="font-size:15px">${A.shape(b)}</b><u>${b.types.length > 1 ? A.esc(b.types.slice(1).join(', ')) : ''}</u></div>
        </div>

        <div class="sec"><h3>How big is big? <em>fleet by volume</em></h3>${ladder(b)}${sizeText(b)}</div>
        <div class="sec"><h3>How old is old? <em>in-service fleet by build year</em></h3>${ageStrip(b)}${ageText(b)}</div>

        <div class="sec"><h3>Provenance <em>${b.prev.length ? b.prev.length + ' previous owner' + (b.prev.length > 1 ? 's' : '') : 'no previous owners recorded'}</em></h3>${chain(b)}
          ${b.prev.length ? `<p class="fine">Owners appear in the order the database lists them. Transfer dates are not recorded, so this is a sequence, not a timeline.</p>` : ''}
          ${b.note ? `<p class="fine">${A.esc(b.note)}</p>` : ''}</div>

        <div class="sec"><h3>Spotted at events <em>${b.yearsSeen.length ? b.yearsSeen.length + ' year' + (b.yearsSeen.length > 1 ? 's' : '') : 'not yet seen in person'}</em></h3>${seenStrip(b)}
          <div class="btnrow" style="margin-top:10px">${[['Crewed', b.crewed], ['Flown', b.flown], ['Burner time', b.burner]].map(([l, v]) => `<span class="pill" style="${v ? 'background:rgba(255,180,84,.22);color:#ffd9a3' : 'opacity:.45'}">${v ? '✓' : '–'} ${l}</span>`).join('')}</div></div>

        ${peers.length > 1 ? `<div class="sec"><h3>The ${A.esc(b.model)} family <em>${A.int(peers.length)} in the database</em></h3>${peersStrip(b, peers)}
          <p class="fine">Each dot is another ${A.esc(b.mfr)} ${A.esc(b.model)} by build year. The bright one is this balloon.</p></div>` : ''}

        ${b.extra.length ? `<div class="sec"><h3>More photos</h3><div class="gal">${b.extra.map(id => `<img loading="lazy" referrerpolicy="no-referrer" src="${A.photo(id, 400)}" alt="" onerror="this.remove()">`).join('')}</div></div>` : ''}

        <div class="btnrow">
          ${b.sky ? '<button class="btn primary" data-act="fly">Find in the sky</button>' : ''}
          ${b.model ? '<button class="btn" data-act="isolate">Show all ' + A.esc(b.model) + 's</button><button class="btn" data-act="lineage">See lineage</button>' : ''}
        </div>
      </div>`;
    const img = A.$('.c-hero img', el);
    if (img) { img.onload = () => img.classList.add('ok'); img.onerror = () => img.remove(); }
    el.scrollTop = 0;
  }
  return { render };
})();
