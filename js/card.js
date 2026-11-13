/* Balloon detail card: flat editorial "specimen sheet" */
A.Card = (function () {
  const W = 360;
  let sizeHist = null, builtHist = null;
  const LO = Math.log(2000), HI = Math.log(700000), NB = 44;

  function prep() {
    if (sizeHist) return;
    sizeHist = Array(NB).fill(0);
    for (const v of A.vols) sizeHist[Math.min(NB - 1, Math.floor((Math.log(v) - LO) / (HI - LO) * NB))]++;
    const y0 = A.meta.built[0], y1 = A.meta.now;
    builtHist = Array(y1 - y0 + 1).fill(0);
    for (const b of A.B) if (b.status === 'in' && b.built && b.built >= y0 && b.built <= y1) builtHist[b.built - y0]++;
  }
  const sizeX = v => 4 + (Math.log(A.clamp(v, 2000, 700000)) - LO) / (HI - LO) * (W - 8);
  const median = a => a[a.length >> 1];

  /* Fleet size distribution. Bars the balloon outsizes are inked; the rest are pale. */
  function sizeChart(b) {
    const mx = Math.max(...sizeHist), bw = (W - 8) / NB, here = b.size ? Math.min(NB - 1, Math.floor((Math.log(A.clamp(b.size, 2000, 699999)) - LO) / (HI - LO) * NB)) : -1;
    const baseY = 92;
    let s = `<svg class="chart" viewBox="0 0 ${W} 150" role="img" aria-label="Where this balloon's size falls in the fleet">`;
    sizeHist.forEach((c, i) => { const h = Math.max(1, c / mx * 62); s += `<rect class="${i < here ? 'hi' : i === here ? 'me' : 'lo'}" x="${4 + i * bw + .6}" y="${baseY - h}" width="${bw - 1.2}" height="${h}"/>`; });
    s += `<line class="axis" x1="4" x2="${W - 4}" y1="${baseY + .5}" y2="${baseY + .5}"/>`;
    const medX = sizeX(median(A.vols));
    s += `<line class="med" x1="${medX}" x2="${medX}" y1="${baseY - 70}" y2="${baseY}"/><text class="note" x="${medX + 4}" y="${baseY - 62}">median ${A.fmtVolShort(median(A.vols))}</text>`;
    if (b.size) { const x = sizeX(b.size), anchor = x > W - 70 ? 'end' : 'start', tx = anchor === 'end' ? x - 6 : x + 6;
      s += `<line class="me-line" x1="${x}" x2="${x}" y1="10" y2="${baseY}"/><circle class="me-dot" cx="${x}" cy="10" r="4"/><text class="me-lab" x="${tx}" y="14" text-anchor="${anchor}">${A.int(b.size)} cu ft</text>`; }
    A.BENCH.forEach((o, i) => { const x = sizeX(o.v), row = i % 2;
      s += `<line class="tick" x1="${x}" x2="${x}" y1="${baseY}" y2="${baseY + 8 + row * 15}"/><text class="tk" x="${x}" y="${baseY + 20 + row * 15}" text-anchor="${i === 0 ? 'start' : 'middle'}">${o.name}</text>`; });
    return s + '</svg>';
  }

  /* In-service fleet by build year. Bars for balloons younger than this one are inked. */
  function ageChart(b) {
    const y0 = A.meta.built[0], n = builtHist.length, mx = Math.max(...builtHist), bw = (W - 8) / n, baseY = 80;
    let s = `<svg class="chart" viewBox="0 0 ${W} 112" role="img" aria-label="Where this balloon's build year falls in the in-service fleet">`;
    builtHist.forEach((c, i) => { const yr = y0 + i, h = Math.max(1, c / mx * 56); s += `<rect class="${b.built && yr > b.built ? 'hi' : yr === b.built ? 'me' : 'lo'}" x="${4 + i * bw + .4}" y="${baseY - h}" width="${bw - .8}" height="${h}"/>`; });
    s += `<line class="axis" x1="4" x2="${W - 4}" y1="${baseY + .5}" y2="${baseY + .5}"/>`;
    for (const yr of [1970, 1980, 1990, 2000, 2010, 2020]) { const x = 4 + (yr - y0 + .5) * bw; s += `<line class="tick" x1="${x}" x2="${x}" y1="${baseY}" y2="${baseY + 5}"/><text class="tk" x="${x}" y="${baseY + 17}" text-anchor="middle">${yr}</text>`; }
    if (b.built) { const x = 4 + (b.built - y0 + .5) * bw, anchor = x > W - 70 ? 'end' : 'start', tx = anchor === 'end' ? x - 6 : x + 6;
      s += `<line class="me-line" x1="${x}" x2="${x}" y1="8" y2="${baseY}"/><circle class="me-dot" cx="${x}" cy="8" r="4"/><text class="me-lab" x="${tx}" y="12" text-anchor="${anchor}">built ${b.built}</text>`; }
    return s + '</svg>';
  }

  function peersChart(b, peers) {
    const y0 = A.meta.built[0], span = A.meta.now - y0 + 1, x = y => 4 + (y - y0 + .5) / span * (W - 8);
    let s = `<svg class="chart" viewBox="0 0 ${W} 64" role="img" aria-label="Build years of balloons of the same model">`;
    s += `<line class="axis" x1="4" x2="${W - 4}" y1="44.5" y2="44.5"/>`;
    for (const yr of [1980, 2000, 2020]) s += `<text class="tk" x="${x(yr)}" y="60" text-anchor="middle">${yr}</text>`;
    for (const p of peers) { if (!p.built || p === b) continue; s += `<circle class="peer" cx="${x(p.built)}" cy="${38 - p.h2 * 28}" r="2.6"/>`; }
    if (b.built) s += `<circle class="me-dot" cx="${x(b.built)}" cy="26" r="5.5"/>`;
    return s + '</svg>';
  }

  function sightings(b) {
    return `<div class="seen">${[2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026].map(y => `<div class="${b.yearsSeen.includes(y) ? 'on' : ''}"><i></i><small>’${String(y).slice(2)}</small></div>`).join('')}</div>`;
  }

  function sizeHead(b) {
    if (!b.size) return ['No size recorded', '<p class="body">This balloon has no envelope volume in the database.</p>'];
    const p = Math.round(A.pct(b.size) * 100), v = b.size, pool = v / 88300, house = v / 20000, cont = v / 2390;
    const head = p >= 99 ? 'Among the very largest' : p <= 1 ? 'Among the very smallest' : `Bigger than ${p}% of the fleet`;
    const eq = pool >= .5 ? `${pool.toFixed(pool < 2 ? 2 : 1)} Olympic pools` : `${house.toFixed(1)} houses`;
    return [head, `<p class="body">It holds about <b>${eq}</b> of air, or ${A.int(Math.round(cont))} forty-foot shipping containers. The median balloon holds ${A.int(median(A.vols))} cu ft${v > 90000 ? ` (this one is ${(v / 90000).toFixed(1)}× that)` : ''}.</p>`];
  }
  function ageHead(b) {
    if (!b.built) return ['No build year recorded', '<p class="body">Without a build year this balloon can’t take off in the Sky view.</p>'];
    const now = A.meta.now, inS = A.B.filter(o => o.status === 'in' && o.built), older = Math.round(inS.filter(o => o.built > b.built).length / inS.length * 100);
    const head = b.status === 'out' ? `Built in ${b.built}, now out of service` : older >= 50 ? `Older than ${older}% of balloons still flying` : `Younger than ${100 - older}% of balloons still flying`;
    let t = `Built in <b>${b.built}</b>${b.status !== 'out' ? `, now <b>${now - b.built} year${now - b.built === 1 ? '' : 's'} old</b>` : ''}.`;
    if (b.rebuilt.length) t += ` Rebuilt in <b>${b.rebuilt.join(' and ')}</b>.`;
    if (b.endEst) t += ` The database doesn’t say when it retired, so the Sky view uses a <b>modeled</b> year (about ${Math.round(b.end)}).`;
    return [head, `<p class="body">${t}</p>`];
  }

  function provenance(b) {
    const rows = [[b.built ? 'Built ' + b.built : 'Built', `${b.mfr || ''} ${b.model || ''}`.trim(), '']];
    for (const [o, n] of b.prev) rows.push([o, n ? 'flown as “' + n + '”' : '', o]);
    rows.push([b.owner || 'Owner not recorded', 'current owner' + (b.name ? ' · “' + b.name + '”' : ''), b.owner || '', true]);
    return `<ol class="prov">${rows.map((r, i) => `<li class="${r[3] ? 'cur' : ''}"><span class="n">${String(i + 1).padStart(2, '0')}</span><div>${r[2] ? `<button class="own" data-owner="${A.esc(r[2])}">${A.esc(r[0])}</button>` : `<b>${A.esc(r[0])}</b>`}${r[1] ? `<small>${A.esc(r[1])}</small>` : ''}</div></li>`).join('')}</ol>`;
  }

  function render(b, el) {
    prep();
    const color = A.FAM_COLORS[b.fam] || A.UNK, shape = b.shp || A.shape(b);
    const peers = b.model ? (A.byModel.get(A.mkey(b)) || []) : [];
    const age = b.built ? A.meta.now - b.built : null;
    const [sh, sb] = sizeHead(b), [ah, ab] = ageHead(b);
    const status = b.status === 'in' ? 'In service' : b.status === 'out' ? 'Out of service' : 'Status unknown';
    const pctl = b.size ? Math.round(A.pct(b.size) * 100) : null;
    el.innerHTML = `
      <button class="c-handle" aria-label="Expand or collapse details"><i></i></button>
      <div class="c-top">
        ${b.img ? `<img alt="Photo of ${A.esc(A.label(b))}" referrerpolicy="no-referrer" src="${A.photo(b.img, 800)}">` : ''}
        ${A.balloonSVG(color, shape)}
        <span class="c-id">${b.id}</span>
        <button class="c-close" aria-label="Close details">×</button>
      </div>
      <div class="c-body">
        <p class="c-eyebrow"><i style="background:${color}"></i>${A.esc(b.mfr || 'Maker unknown')} ${A.esc(b.model || '')}${b.reg && b.name ? ' · ' + A.esc(b.reg) : ''}</p>
        <h2 class="c-title">${A.esc(A.label(b))}</h2>
        <p class="c-status"><span class="st ${b.status}"></span>${status}${b.loc ? ' · ' + A.esc(b.loc) : ''}${b.owner ? ' · ' + A.esc(b.owner) : ''}</p>

        <dl class="kpi">
          <div><dt>Built</dt><dd>${b.built || '–'}</dd><dd class="s">${b.rebuilt.length ? 'rebuilt ' + b.rebuilt.join(', ') : shape === 'Round' ? 'round' : shape.toLowerCase()}</dd></div>
          <div><dt>Volume</dt><dd>${b.size ? A.fmtVolShort(b.size) : '–'}</dd><dd class="s">cu ft</dd></div>
          <div><dt>${b.status === 'out' ? 'Last flew' : 'Age'}</dt><dd>${b.status === 'out' ? (b.end ? '~' + Math.round(b.end) : '–') : age !== null ? age : '–'}</dd><dd class="s">${b.status === 'out' ? (b.end ? 'modeled' : '') : age !== null ? 'years' : ''}</dd></div>
          <div><dt>Bigger than</dt><dd>${pctl !== null ? pctl + '<sup>%</sup>' : '–'}</dd><dd class="s">of the fleet</dd></div>
        </dl>

        <section><h3>How big is big?</h3><p class="head">${sh}</p>${b.size ? sizeChart(b) : ''}${sb}${b.size ? '<p class="key"><i class="k-hi"></i>smaller than this balloon <i class="k-lo"></i>larger</p>' : ''}</section>
        <section><h3>How old is old?</h3><p class="head">${ah}</p>${b.built ? ageChart(b) : ''}${ab}${b.built ? '<p class="key"><i class="k-hi"></i>younger than this balloon <i class="k-lo"></i>older</p>' : ''}</section>

        <section><h3>Provenance</h3>${provenance(b)}
          <p class="fine">Owners are in the order the database lists them. Transfer dates aren’t recorded, so this is a sequence, not a timeline.</p>${b.note ? `<p class="fine">${A.esc(b.note)}</p>` : ''}</section>

        <section><h3>Spotted at events</h3>${sightings(b)}
          <p class="fine">${b.yearsSeen.length ? 'Seen in person in ' + b.yearsSeen.join(', ') + '.' : 'Not yet seen in person.'} ${[['crewed', b.crewed], ['flown', b.flown], ['logged burner time', b.burner]].filter(x => x[1]).map(x => x[0]).join(', ')}</p></section>

        ${peers.length > 1 ? `<section><h3>The ${A.esc(b.model)} family</h3><p class="head">${A.int(peers.length)} in the database</p>${peersChart(b, peers)}<p class="fine">Each dot is another ${A.esc(b.mfr)} ${A.esc(b.model)}, placed by build year. The large dot is this one.</p></section>` : ''}

        ${b.extra.length ? `<section><h3>More photos</h3><div class="gal">${b.extra.map(id => `<img loading="lazy" referrerpolicy="no-referrer" src="${A.photo(id, 400)}" alt="" onerror="this.remove()">`).join('')}</div></section>` : ''}

        <div class="acts">
          ${b.sky ? '<button class="btn solid" data-act="fly">Find in the sky</button>' : ''}
          ${b.model ? `<button class="btn" data-act="isolate">All ${A.esc(b.model)}s</button><button class="btn" data-act="lineage">Lineage</button>` : ''}
        </div>
      </div>`;
    const img = A.$('.c-top img', el);
    if (img) { img.onload = () => el.classList.add('has-photo'); img.onerror = () => { img.remove(); el.classList.remove('has-photo'); }; }
    el.classList.remove('has-photo');
    el.scrollTop = 0;
  }
  return { render };
})();
