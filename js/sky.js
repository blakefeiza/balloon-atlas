/* Sky view: canvas renderer, camera, layout, hit-testing, time engine */
A.Sky = (function () {
  const S = A.S;
  let cv, g, W = 0, H = 0, dpr = 1;
  const cam = { zoom: 1, tx: 0, ty: 0, tz: 1, ttx: 0, tty: 0, flying: false };
  const PAD = 18, MAX_AGE = 63;
  let GY = 0, PPY = 1, bgCache = null, stars = [];
  let groups = [], layoutT = 1, layoutStart = 0;
  let order = [];                 // balloons on the sky, oldest first (draw order)
  let px, py, pr, pvis;           // last-frame screen geometry for hit testing
  let hoverIdx = -1, dragging = null, clock = 0, last = 0, dirty = true;
  let counts = { groups: [], cats: {}, aloft: 0 };

  /* ---------- layout ---------- */
  function computeLayout(mode, animate = true) {
    const def = A.ARRANGE[mode];
    for (const b of A.B) b.xs = b.x ?? 0.5;
    if (def.cont) {
      groups = [25000, 50000, 90000, 150000, 300000].map(v => ({ key: v, label: A.fmtVolShort(v), x: .04 + .9 * A.sizeToX(v), tick: true }));
      groups.push({ key: 'unk', label: 'size n/a', x: .975, tick: true });
      for (const b of A.B) b.xt = b.size ? .04 + .9 * A.sizeToX(b.size) + b.jx * .006 : .975 + b.jx * .01;
      groups.axis = 'Envelope volume, cu ft (log scale)';
    } else {
      const m = new Map();
      for (const b of A.B) if (b.sky) { const k = def.cat(b); m.set(k, (m.get(k) || 0) + 1); }
      const tail = ['Unknown', 'Other makers', 'Other US', 'Rest of world'];
      const keys = [...m.keys()].sort((a, b) => (tail.includes(a) - tail.includes(b)) || m.get(b) - m.get(a));
      const G = keys.length, idx = new Map(keys.map((k, i) => [k, i]));
      groups = keys.map((k, i) => ({ key: k, label: k, x: (i + .5) / G, w: 1 / G, n: m.get(k) }));
      for (const b of A.B) { const i = idx.get(def.cat(b)) ?? G - 1; b.gi = i; b.xt = (i + .5) / G + b.jx * .5 * .84 / G; }
      groups.axis = '';
    }
    if (!animate) { for (const b of A.B) b.x = b.xt; layoutT = 1; } else { layoutT = 0; layoutStart = performance.now(); }
    dirty = true;
  }

  /* ---------- filters ---------- */
  function applyFilters() {
    const f = S.filters, mode = A.MODES[S.colorBy];
    const lo = f.szMin, hi = f.szMax;
    const q = f.query;
    for (const b of A.B) {
      let ok = true;
      if (b.status === 'in' && !f.inSvc) ok = false;
      if (b.status === 'out' && !f.outSvc) ok = false;
      if (ok && f.cats.size && !f.cats.has(mode.cat(b))) ok = false;
      if (ok && (lo > 0 || hi < 1e9) && b.size && (b.size < lo || b.size > hi)) ok = false;
      if (ok && (lo > 0 || hi < 1e9) && !b.size) ok = false;
      if (ok && f.model && !(A.mkey(b) === f.model.key)) ok = false;
      if (ok && f.fam && b.fam !== f.fam) ok = false;
      b.pass = ok;
      b.col = mode.colors[mode.cat(b)] || A.UNK;
    }
    dirty = true;
  }

  /* ---------- geometry ---------- */
  function resize() {
    const r = cv.getBoundingClientRect(); if (r.width < 2 || r.height < 2) { W = H = 0; return; } dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr;
    GY = H - 40; PPY = (GY - 36) / MAX_AGE;
    bgCache = null;
    stars = Array.from({ length: 140 }, (_, i) => ({ x: A.hash('sx' + i) * W, y: A.hash('sy' + i) * H * .55, r: .4 + A.hash('sr' + i) * 1.1, p: A.hash('sp' + i) * 6.28 }));
    clampCam(); dirty = true;
  }
  const baseX = x => PAD + x * (W - 2 * PAD);
  const baseY = age => GY - age * PPY;
  const toSX = bx => bx * cam.zoom + cam.tx;
  const toSY = by => by * cam.zoom + cam.ty;
  function clampCam() {
    cam.zoom = A.clamp(cam.zoom, 1, 14);
    cam.tx = A.clamp(cam.tx, W * (1 - cam.zoom) - 60, 60);
    cam.ty = A.clamp(cam.ty, H * (1 - cam.zoom) - 80, 60);
  }
  function zoomAt(cx, cy, k) {
    const nz = A.clamp(cam.zoom * k, 1, 14), kk = nz / cam.zoom;
    cam.tx = cx - (cx - cam.tx) * kk; cam.ty = cy - (cy - cam.ty) * kk; cam.zoom = nz; cam.flying = false; clampCam(); dirty = true;
  }

  function drawBackground() {
    if (!bgCache) {
      bgCache = document.createElement('canvas'); bgCache.width = W * dpr; bgCache.height = H * dpr;
      const c = bgCache.getContext('2d'); c.scale(dpr, dpr);
      const gr = c.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, '#12103a'); gr.addColorStop(.26, '#2f2576'); gr.addColorStop(.48, '#7a3a8e'); gr.addColorStop(.67, '#cf4f7c'); gr.addColorStop(.84, '#ff8a5c'); gr.addColorStop(1, '#ffcf8a');
      c.fillStyle = gr; c.fillRect(0, 0, W, H);
      const sun = c.createRadialGradient(W * .5, H, 10, W * .5, H, H * .7);
      sun.addColorStop(0, 'rgba(255,236,170,.75)'); sun.addColorStop(1, 'rgba(255,210,150,0)');
      c.fillStyle = sun; c.fillRect(0, 0, W, H);
    }
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(bgCache, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const s of stars) { const a = .35 + .35 * Math.sin(clock * 1.2 + s.p); g.fillStyle = `rgba(255,255,255,${a * (1 - s.y / (H * .6))})`; g.fillRect(s.x, s.y, s.r, s.r); }
  }

  function drawGround() {
    const gy = toSY(GY) + 2;
    g.save();
    for (const [off, col, amp, fr] of [[0, 'rgba(58,24,78,.9)', 10, .011], [14, 'rgba(30,14,52,.97)', 8, .017]]) {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 6) g.lineTo(x, gy + off - amp * Math.sin((x - cam.tx * .5) * fr + off) * cam.zoom ** .3 - amp * .6 * Math.sin((x - cam.tx * .5) * fr * 2.3));
      g.lineTo(W, H); g.fill();
    }
    g.restore();
  }

  function drawAxis(tNow) {
    g.save(); g.textBaseline = 'middle';
    // altitude rules (age)
    g.font = '11px "DM Sans",sans-serif'; g.strokeStyle = 'rgba(255,255,255,.1)'; g.fillStyle = 'rgba(255,255,255,.6)'; g.setLineDash([2, 5]);
    for (let a = 10; a <= 60; a += 10) {
      const y = toSY(baseY(a)); if (y < 30 || y > GY + 60) continue;
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      g.fillText(a + ' yrs aloft', 12, y - 8);
    }
    g.setLineDash([]);
    // group labels on the hills
    const ly = Math.min(H - 12, toSY(GY) + 26);
    g.textAlign = 'center';
    groups.forEach((gr, i) => {
      const x = toSX(baseX(gr.x));
      if (x < -60 || x > W + 60) return;
      const n = counts.groups[i] || 0;
      g.font = '700 12px "DM Sans",sans-serif'; g.fillStyle = 'rgba(255,255,255,.85)';
      let lab = gr.label; const mw = gr.w ? gr.w * (W - 2 * PAD) * cam.zoom - 6 : 200; while (lab.length > 3 && g.measureText(lab).width > mw) lab = lab.slice(0, -2).trimEnd() + '…';
      g.fillText(lab, x, ly - (gr.tick ? 0 : 6));
      if (!gr.tick && mw > 64) { g.font = '11px "DM Sans",sans-serif'; g.fillStyle = 'rgba(255,255,255,.5)'; g.fillText(A.int(n) + ' aloft', x, ly + 8); }
    });
    if (groups.axis) { g.font = '11px "DM Sans",sans-serif'; g.fillStyle = 'rgba(255,255,255,.5)'; g.fillText(groups.axis, W / 2, ly + 14); }
    // group separators
    if (!groups.axis) { g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1; groups.forEach((gr, i) => { if (!i) return; const x = toSX(baseX(gr.x - gr.w / 2)); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, toSY(GY)); g.stroke(); }); }
    g.restore();
  }

  /* ---------- render ---------- */
  function render(now) {
    const dt = Math.min(.05, (now - last) / 1000 || 0); last = now; clock += dt;
    // time
    if (S.playing) {
      S.t += dt * S.speed * 2; dirty = true;
      if (S.t >= A.meta.now + .99) { S.t = A.meta.now + .99; A.ui.setPlaying(false); }
    }
    // layout tween
    if (layoutT < 1) { layoutT = Math.min(1, (now - layoutStart) / 900); const e = A.ease(layoutT); for (const b of A.B) b.x = A.lerp(b.xs, b.xt, e); dirty = true; }
    // camera tween
    if (cam.flying) {
      const k = 1 - Math.pow(.0009, dt);
      cam.zoom += (cam.tz - cam.zoom) * k; cam.tx += (cam.ttx - cam.tx) * k; cam.ty += (cam.tty - cam.ty) * k;
      if (Math.abs(cam.tz - cam.zoom) < .003 && Math.abs(cam.ttx - cam.tx) < .4) cam.flying = false;
      dirty = true;
    }
    // filter-alpha tween
    let anim = false;
    for (const b of A.B) { const tg = b.pass ? 1 : .05; if (b.fa === undefined) b.fa = tg; if (b.fa !== tg) { b.fa += (tg - b.fa) * Math.min(1, dt * 9); if (Math.abs(tg - b.fa) < .01) b.fa = tg; anim = true; } }
    if (anim) dirty = true;
    dirty = true; // ambient sway/twinkle keeps the sky alive
    if (!dirty || document.hidden || W < 2 || H < 2) { requestAnimationFrame(render); return; }
    dirty = false;

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackground(); drawGround();
    const t = S.t, zs = Math.pow(cam.zoom, .55), R = 4.6 * zs;
    const catFn = A.MODES[S.colorBy].cat;
    const gc = new Array(groups.length).fill(0), cc = {}; let aloft = 0;
    const N = order.length;
    if (!px || px.length !== N) { px = new Float32Array(N); py = new Float32Array(N); pr = new Float32Array(N); pvis = new Uint8Array(N); }
    const sel = S.sel; let selDraw = null, hovDraw = null;
    const ghost = S.filters.ghost;
    for (let i = 0; i < N; i++) {
      const b = order[i]; pvis[i] = 0;
      if (t < b.t0) continue;
      let alpha = Math.min(1, (t - b.t0) / .7), age = t - b.t0, ghostOnly = false;
      if (t >= b.t1) {
        const f = t - b.t1;
        if (f < 1.1) { alpha *= 1 - f / 1.1; age = b.t1 - b.t0 + f * 2.2; }
        else if (ghost) { alpha = .09; age = b.t1 - b.t0 + 2.4; ghostOnly = true; }
        else if (b !== sel) continue;
        else { alpha = .0; }
      }
      const live = !ghostOnly && alpha > .02;
      alpha *= b.fa;
      const bx = baseX(b.x) + Math.sin(clock * .9 + b.hash * 6.28) * 1.1;
      const by = baseY(Math.min(age, MAX_AGE + 2)) + Math.sin(clock * .7 + b.h2 * 6.28) * .9;
      const sx = toSX(bx), sy = toSY(by);
      const r = R * b.rv * (.75 + .25 * Math.min(1, (t - b.t0) / .7));
      px[i] = sx; py[i] = sy; pr[i] = r;
      if (live && b.pass) { aloft++; gc[b.gi] = (gc[b.gi] || 0) + 1; const k = catFn(b); cc[k] = (cc[k] || 0) + 1; }
      if (sx < -30 || sx > W + 30 || sy < -40 || sy > H + 60) continue;
      if (alpha < .01) continue;
      pvis[i] = (b.pass && live) ? 1 : 0;
      if (b === sel) { selDraw = [b, sx, sy, r, Math.max(alpha, .6)]; continue; }
      if (i === hoverIdx) { hovDraw = [b, sx, sy, r, alpha]; continue; }
      draw(b, sx, sy, r, alpha);
    }
    if (hovDraw) { const [b, sx, sy, r, a] = hovDraw; ring(sx, sy - r * 1.6, r * 1.9, 'rgba(255,255,255,.35)', 1.2); draw(b, sx, sy, r * 1.4, 1); }
    if (selDraw) { const [b, sx, sy, r] = selDraw; beacon(sx, sy, r); draw(b, sx, sy, r * 1.55, 1); }
    counts = { groups: gc, cats: cc, aloft };
    drawAxis(t);
    if (A.ui) A.ui.frame(t, counts);
    requestAnimationFrame(render);
  }

  function draw(b, sx, sy, r, alpha) {
    if (r < 1.7) { g.globalAlpha = alpha; g.fillStyle = b.col; g.fillRect(sx - r, sy - r * 2, r * 2, r * 2.4); g.globalAlpha = 1; return; }
    const dw = r * 2.7, dh = dw * 84 / 64;
    g.globalAlpha = alpha;
    g.drawImage(A.sprite(b.col, b.shp === 'Racer' || b.shp === 'Special shape' ? b.shp : 'Round'), sx - dw / 2, sy - dh, dw, dh);
    g.globalAlpha = 1;
  }
  function ring(x, y, rad, col, w) { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(x, y, rad, 0, 6.3); g.stroke(); }
  function beacon(sx, sy, r) {
    const p = (clock % 1.6) / 1.6;
    g.save(); g.strokeStyle = 'rgba(255,180,84,.55)'; g.setLineDash([3, 5]); g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(sx, sy + 4); g.lineTo(sx, toSY(GY)); g.stroke(); g.setLineDash([]);
    const cy = sy - r * 2.2;
    ring(cy ? sx : sx, cy, r * 2.2 + p * r * 3, `rgba(255,180,84,${.8 * (1 - p)})`, 2);
    ring(sx, cy, r * 2.5, 'rgba(255,180,84,.9)', 1.6);
    g.restore();
  }

  /* ---------- interaction ---------- */
  function pick(mx, my) {
    let best = -1, bd = 1e9;
    for (let i = order.length - 1; i >= 0; i--) {
      if (!pvis[i]) continue;
      const r = pr[i], cy = py[i] - r * 1.7, dx = mx - px[i], dy = my - cy;
      const d = (dx * dx + dy * dy) / (r * r * 3.2);
      if (d < 1 && d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function bind() {
    const rect = () => cv.getBoundingClientRect();
    const ptrs = new Map(); let pinch = null;
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); cam.flying = false;
      if (ptrs.size === 2) { const [p, q] = [...ptrs.values()]; pinch = { d: Math.hypot(p.x - q.x, p.y - q.y), z: cam.zoom, tx: cam.tx, ty: cam.ty, cx: (p.x + q.x) / 2, cy: (p.y + q.y) / 2 }; dragging = null; }
      else dragging = { x: e.clientX, y: e.clientY, tx: cam.tx, ty: cam.ty, moved: false };
    });
    cv.addEventListener('pointermove', e => {
      const r = rect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && ptrs.size === 2) {
        const [p, q] = [...ptrs.values()], d = Math.hypot(p.x - q.x, p.y - q.y), cx = (p.x + q.x) / 2 - r.left, cy = (p.y + q.y) / 2 - r.top;
        const nz = A.clamp(pinch.z * d / pinch.d, 1, 14), k = nz / pinch.z, ox = pinch.cx - r.left, oy = pinch.cy - r.top;
        cam.zoom = nz; cam.tx = cx - (ox - pinch.tx) * k; cam.ty = cy - (oy - pinch.ty) * k; clampCam(); dirty = true; A.ui.hideTip(); return;
      }
      if (dragging) {
        const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) { dragging.moved = true; cv.classList.add('drag'); A.ui.hideTip(); }
        if (dragging.moved) { cam.tx = dragging.tx + dx; cam.ty = dragging.ty + dy; clampCam(); dirty = true; }
        return;
      }
      if (e.pointerType === 'touch') return;
      const i = pick(mx, my);
      if (i !== hoverIdx) { hoverIdx = i; cv.classList.toggle('hover', i >= 0); dirty = true; }
      if (i >= 0) A.ui.showTip(order[i], mx, my); else A.ui.hideTip();
    });
    const up = e => {
      ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
      const was = dragging; dragging = null; cv.classList.remove('drag');
      if (e.type === 'pointerup' && was && !was.moved) {
        const r = rect(), i = pick(e.clientX - r.left, e.clientY - r.top);
        if (i >= 0) A.ui.select(order[i].id, { fly: true }); else if (S.sel) A.ui.select(null);
      }
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { hoverIdx = -1; A.ui.hideTip(); cv.classList.remove('hover'); });
    cv.addEventListener('wheel', e => { e.preventDefault(); const r = rect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * .0015)); }, { passive: false });
    cv.addEventListener('dblclick', e => { const r = rect(); zoomAt(e.clientX - r.left, e.clientY - r.top, 1.9); });
    new ResizeObserver(resize).observe(cv);
  }

  return {
    init(canvas) {
      cv = canvas; g = cv.getContext('2d');
      order = A.B.filter(b => b.sky).sort((a, b) => a.t0 - b.t0);
      resize(); bind(); computeLayout(S.arrange, false); applyFilters();
      requestAnimationFrame(render);
    },
    arrange(mode) { S.arrange = mode; computeLayout(mode, true); },
    applyFilters, resize, computeLayout,
    zoom(k) { zoomAt(W / 2, H / 2, k); },
    reset() { cam.tz = 1; cam.ttx = 0; cam.tty = 0; cam.flying = true; dirty = true; },
    flyTo(b, cardW = 0, cardH = 0) {
      if (!b || !b.sky) return;
      const t = S.t, age = Math.min(t, b.t1) - b.t0;
      const bx = baseX(b.x), by = baseY(Math.max(0, age));
      cam.tz = Math.max(cam.zoom, 3.4);
      cam.ttx = (W - cardW) / 2 - bx * cam.tz; cam.tty = (H - cardH) * .55 - by * cam.tz;
      cam.ttx = A.clamp(cam.ttx, W * (1 - cam.tz) - 60, 60); cam.tty = A.clamp(cam.tty, H * (1 - cam.tz) - 80, 60);
      cam.flying = true; dirty = true;
    },
    groups: () => groups, counts: () => counts, dirty() { dirty = true; },
    cat: () => A.MODES[S.colorBy].cat,
    camState: () => cam,
  };
})();
