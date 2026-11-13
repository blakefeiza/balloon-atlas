/* Sky view.
   Rendering is split into four stacked canvases so each frame only touches what actually changed:
     bg     sky + stars          drawn once per resize, never again
     scene  rules, hills, names  redrawn only when the camera or layout changes (cheap, no balloons)
     gl     every balloon        tier 1/2: ONE instanced WebGL draw call (GPU computes position/fade/size from the year)
                                  tier 3 (no WebGL, e.g. some embedded browsers): Canvas2D with a cached layer of every
                                  in-service balloon that is simply scrolled, plus live draws for the few that retire
     fx     hover ring, beacon, per-group counts   tiny 2D overlay; also receives all pointer input */
A.Sky = (function () {
  const S = A.S;
  let cv, g, bgc, sc, sg, glc, gl, W = 0, H = 0, dpr = 1;
  const cam = { zoom: 1, tx: 0, ty: 0, tz: 1, ttx: 0, tty: 0, flying: false };
  const PAD = 18, MAX_AGE = 63, STRIDE = 12, LM = 80, SHAPES = ['Round', 'Racer', 'Special shape'];
  let GY = 0, PPY = 1, stars = [], sizeK = 1, hit, layersEl, vcam = null, gestureTimer = 0, pendingCommit = false, axisW = null;
  let groups = [], layoutT = 1, mixE = 1, layoutStart = 0, groupsVer = 0;
  let order = [], N = 0, inst = null;
  let hoverIdx = -1, hoverReq = null, dragging = null, camReq = null, last = 0, dirty = true;
  let catKeys = [], gc = new Int32Array(0), cc = new Int32Array(0), lastCount = 0, labelCache = null;
  let counts = { groups: gc, catKeys, cc, aloft: 0 };
  A.perf = { backend: 'none' };
  let fadeT = 1, fadeStart = 0, atlasMode = '', glOK = false, backend = 'none', ext = null, gx = null, layer = null, layerDirty = true, outList = [], inList = [];
  const P = { x: 0, y: 0, r: 0, alive: true };          // scratch result of geom()

  /* ============ layout (x positions) ============ */
  const curX = b => b.xs + (b.xt - b.xs) * mixE;
  function computeLayout(mode, animate = true) {
    const def = A.ARRANGE[mode];
    for (const b of A.B) b.xs = curX(b);
    if (def.cont) {
      groups = [25000, 50000, 90000, 150000, 300000].map(v => ({ key: v, label: A.fmtVolShort(v), x: .04 + .9 * A.sizeToX(v), tick: true }));
      groups.push({ key: 'unk', label: 'size n/a', x: .975, tick: true });
      for (const b of A.B) { b.gi = -1; b.xt = b.size ? .04 + .9 * A.sizeToX(b.size) + b.jx * .006 : .975 + b.jx * .01; }
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
    gc = new Int32Array(groups.length); groupsVer++; labelCache = null;
    if (!animate) { for (const b of A.B) b.xs = b.xt; layoutT = 1; mixE = 1; } else { layoutT = 0; mixE = 0; layoutStart = performance.now(); }
    writeInstances(); layerDirty = true; dirty = true;
  }

  /* ============ filters / colors ============ */
  function applyFilters() {
    const f = S.filters, mode = A.MODES[S.colorBy];
    const lo = f.szMin, hi = f.szMax;
    catKeys = Object.keys(mode.colors); const cidx = new Map(catKeys.map((k, i) => [k, i])); cc = new Int32Array(catKeys.length);
    for (const b of A.B) {
      b.prevFa = b.fa === undefined ? undefined : b.fa;
      let ok = true;
      if (b.status === 'in' && !f.inSvc) ok = false;
      if (b.status === 'out' && !f.outSvc) ok = false;
      if (ok && f.cats.size && !f.cats.has(mode.cat(b))) ok = false;
      if (ok && (lo > 0 || hi < 1e9) && b.size && (b.size < lo || b.size > hi)) ok = false;
      if (ok && (lo > 0 || hi < 1e9) && !b.size) ok = false;
      if (ok && f.model && !(A.mkey(b) === f.model.key)) ok = false;
      if (ok && f.fam && b.fam !== f.fam) ok = false;
      b.pass = ok;
      const ck = mode.cat(b); b.ci = cidx.has(ck) ? cidx.get(ck) : catKeys.length - 1;
      b.col = mode.colors[ck] || A.UNK;
    }
    // GPU fade between the previous and new filter state (computed on the GPU, driven by one uniform)
    for (const b of order) { const to = b.pass ? 1 : .05; b.faFrom = b.faTo === undefined ? to : A.lerp(b.faFrom, b.faTo, fadeT); b.faTo = to; }
    fadeT = 0; fadeStart = performance.now();
    if (backend === '2d') {
      const tc = new Map();
      for (const b of A.B) { const sh = b.shp === 'Racer' || b.shp === 'Special shape' ? b.shp : 'Round', k = b.col + sh; b.sp = tc.get(k) || (tc.set(k, A.tiers(b.col, sh)), tc.get(k)); }
      layerDirty = true;
    } else if (glOK) { if (atlasMode !== S.colorBy) buildAtlas(); writeInstances(); }
    dirty = true;
  }

  /* ============ geometry ============ */
  function resize() {
    const r = hit.getBoundingClientRect(); if (r.width < 2 || r.height < 2) { W = H = 0; return; }
    dpr = Math.min(window.devicePixelRatio || 1, backend === '2d' ? 1.5 : 2);
    W = r.width; H = r.height; layerDirty = true;
    for (const c of [bgc, sc, glc, cv]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    GY = H - 40; PPY = (GY - 36) / MAX_AGE; sizeK = A.clamp(W / 900, .6, 1); axisW = null;   // smaller balloons in narrow frames so columns don't fuse
    stars = Array.from({ length: 140 }, (_, i) => ({ x: A.hash('sx' + i) * W, y: A.hash('sy' + i) * H * .55, r: .4 + A.hash('sr' + i) * 1.1, p: A.hash('sp' + i) * 6.28 }));
    drawBg(); labelCache = null; sceneKey = ''; clampCam(); dirty = true;
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
  /* CPU twin of the vertex shader: screen position of one balloon at the current year (used for picking and the overlay) */
  function geom(b, t) {
    const life = t - b.t0; if (life < 0) return false;
    let age = life, sc2 = life < .7 ? .75 + .25 * life / .7 : 1; P.alive = true;
    if (t >= b.t1) {
      const f = t - b.t1;
      if (f < 1.1) age = b.t1 - b.t0 + f * 2.2;
      else if (S.filters.ghost || b === S.sel) { age = b.t1 - b.t0 + 2.4; P.alive = false; }
      else return false;
    }
    P.x = (PAD + curX(b) * (W - 2 * PAD)) * cam.zoom + cam.tx;
    P.y = (GY - Math.min(age, MAX_AGE + 2) * PPY) * cam.zoom + cam.ty;
    P.r = 4.6 * sizeK * Math.pow(cam.zoom, .55) * b.rv * sc2;
    return true;
  }

  /* ============ static layers ============ */
  function drawBg() {
    const c = bgc.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const gr = c.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#12103a'); gr.addColorStop(.26, '#2f2576'); gr.addColorStop(.48, '#7a3a8e'); gr.addColorStop(.67, '#cf4f7c'); gr.addColorStop(.84, '#ff8a5c'); gr.addColorStop(1, '#ffcf8a');
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
    const sun = c.createRadialGradient(W * .5, H, 10, W * .5, H, H * .7);
    sun.addColorStop(0, 'rgba(255,236,170,.75)'); sun.addColorStop(1, 'rgba(255,210,150,0)');
    c.fillStyle = sun; c.fillRect(0, 0, W, H);
    for (const st of stars) { c.fillStyle = `rgba(255,255,255,${(.25 + .4 * Math.abs(Math.sin(st.p))) * (1 - st.y / (H * .6))})`; c.fillRect(st.x, st.y, st.r, st.r); }
  }
  let sceneKey = '';
  function drawScene() {
    const key = W + '|' + H + '|' + dpr + '|' + cam.zoom.toFixed(3) + '|' + cam.tx.toFixed(1) + '|' + cam.ty.toFixed(1) + '|' + groupsVer;
    if (key === sceneKey) return; sceneKey = key;
    const c = sg; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    c.save(); c.textBaseline = 'middle';
    c.font = '11px "DM Sans",sans-serif'; c.strokeStyle = 'rgba(255,255,255,.1)'; c.fillStyle = 'rgba(255,255,255,.6)'; c.setLineDash([2, 5]);
    for (let a = 10; a <= 60; a += 10) { const y = toSY(baseY(a)); if (y < 30 || y > GY + 60) continue; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.setLineDash([]);
    if (!groups.axis) { c.strokeStyle = 'rgba(255,255,255,.06)'; groups.forEach((gr, i) => { if (!i) return; const x = toSX(baseX(gr.x - gr.w / 2)); c.beginPath(); c.moveTo(x, 0); c.lineTo(x, toSY(GY)); c.stroke(); }); }
    c.restore();
  }
  /* hills + names sit ABOVE the balloons' layer, so they live on the fx canvas (cheap: two paths and ~13 labels) */
  function drawFx(t) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const gy = toSY(GY) + 2;
    for (const [off, col, amp, fr] of [[0, 'rgba(58,24,78,.9)', 10, .011], [14, 'rgba(30,14,52,.97)', 8, .017]]) {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) g.lineTo(x, gy + off - amp * Math.sin((x - cam.tx * .5) * fr + off) * cam.zoom ** .3 - amp * .6 * Math.sin((x - cam.tx * .5) * fr * 2.3));
      g.lineTo(W, H); g.fill();
    }
    // altitude labels: readable pills pinned to the left edge, drawn above the balloons
    g.font = '600 11.5px "DM Sans",sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
    for (let a = 10; a <= 60; a += 10) {
      const y = toSY(baseY(a)); if (y < 34 || y > GY * cam.zoom + cam.ty - 4) continue;
      const txt = W < 560 ? a + ' yrs' : a + ' yrs aloft', w = (axisW || (axisW = {}))[txt] || (axisW[txt] = g.measureText(txt).width);
      g.fillStyle = 'rgba(16,10,44,.62)'; g.beginPath(); g.roundRect ? g.roundRect(6, y - 10, w + 14, 20, 10) : g.rect(6, y - 10, w + 14, 20); g.fill();
      g.fillStyle = 'rgba(255,255,255,.96)'; g.fillText(txt, 13, y + .5);
    }
    const ly = Math.min(H - 12, toSY(GY) + 26);
    if (!labelCache) {                                   // truncated names depend only on zoom/layout, not on every pan frame
      g.font = '700 12px "DM Sans",sans-serif';
      labelCache = groups.map(gr => { let lab = gr.label; const mw = gr.w ? gr.w * (W - 2 * PAD) * cam.zoom - 6 : 200; while (lab.length > 3 && g.measureText(lab).width > mw) lab = lab.slice(0, -2).trimEnd() + '…'; return { lab, count: !gr.tick && mw > 64 }; });
      labelCache.zoom = cam.zoom;
    }
    if (labelCache.zoom !== cam.zoom) labelCache = null;
    if (labelCache) {
      g.textAlign = 'center'; g.textBaseline = 'middle';
      groups.forEach((gr, i) => {
        const x = toSX(baseX(gr.x)); if (x < -60 || x > W + 60) return;
        const L = labelCache[i]; g.font = '700 12px "DM Sans",sans-serif'; g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText(L.lab, x, ly - (gr.tick ? 0 : 6));
        if (L.count) { g.font = '11px "DM Sans",sans-serif'; g.fillStyle = 'rgba(255,255,255,.55)'; g.fillText(A.int(gc[i]) + ' aloft', x, ly + 8); }
      });
      if (groups.axis) { g.font = '11px "DM Sans",sans-serif'; g.fillStyle = 'rgba(255,255,255,.5)'; g.fillText(groups.axis, W / 2, ly + 14); }
    }
    // hover ring + selection beacon
    if (hoverIdx >= 0 && order[hoverIdx] !== S.sel && geom(order[hoverIdx], t)) ring(P.x, P.y - P.r * 2.7, P.r * 2.3, 'rgba(255,255,255,.4)', 1.2);
    if (S.sel && S.sel.sky && geom(S.sel, t)) {
      const x = P.x, y = P.y, r = P.r * 1.55, p = (performance.now() % 1600) / 1600;
      g.save(); g.strokeStyle = 'rgba(255,180,84,.55)'; g.setLineDash([3, 5]); g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y + 4); g.lineTo(x, toSY(GY)); g.stroke(); g.setLineDash([]); g.restore();
      const cy = y - r * 2.1;
      ring(x, cy, r * 1.9 + p * r * 2.4, `rgba(255,180,84,${.8 * (1 - p)})`, 2); ring(x, cy, r * 2.0, 'rgba(255,180,84,.95)', 1.6);
    }
  }
  function ring(x, y, rad, col, w) { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(x, y, rad, 0, 6.3); g.stroke(); }

  /* ============ WebGL (tiers 1-2): instanced balloons ============ */
  const VS_BODY = `
attribute vec2 aq;
attribute vec4 aA;   // xFrom, xTo, t0, t1
attribute vec4 aB;   // sizeScale, atlasCell, fadeFrom, fadeTo
attribute vec4 aC;   // x = instance index
uniform vec2 uRes, uCam, uAtlas, uCellPx, uSpritePx;
uniform float uT, uMix, uZoom, uPad, uGY, uPPY, uR, uMaxAge, uFade, uGhost, uPadPx, uCols, uMode, uSel, uHov;
varying vec2 vUV; varying float vA;
void main() {
  vA = 0.0; vUV = vec2(0.0); gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  bool isSel = abs(aC.x - uSel) < 0.5, isHov = abs(aC.x - uHov) < 0.5;
  if (uMode < 0.5 && (isSel || isHov)) return;           // pass 1: everyone except the highlighted
  if (uMode > 0.5 && !(isSel || isHov)) return;          // pass 2: only the highlighted, on top and larger
  float t0 = aA.z, t1 = aA.w, life = uT - t0;
  if (life < 0.0) return;
  float alpha = 1.0, sc = 1.0, age = life;
  if (life < 0.7) { alpha = life / 0.7; sc = 0.75 + 0.25 * life / 0.7; }
  if (uT >= t1) {
    float f = uT - t1;
    if (f < 1.1) { alpha *= 1.0 - f / 1.1; age = t1 - t0 + f * 2.2; }
    else if (uGhost > 0.5) { alpha = 0.09; age = t1 - t0 + 2.4; }
    else if (uMode > 0.5 && isSel) { alpha = 1.0; age = t1 - t0 + 2.4; }
    else return;
  }
  alpha *= mix(aB.z, aB.w, uFade);
  float boost = 1.0;
  if (uMode > 0.5) { boost = isSel ? 1.55 : 1.4; alpha = 1.0; }
  float x = mix(aA.x, aA.y, uMix);
  vec2 c = vec2(uPad + x * (uRes.x - 2.0 * uPad), uGY - min(age, uMaxAge + 2.0) * uPPY) * uZoom + uCam;
  float dw = uR * aB.x * sc * boost * 2.7, dh = dw * 1.3125;
  if (c.x < -dw || c.x > uRes.x + dw || c.y < -dh * 0.5 || c.y > uRes.y + dh * 1.5) return;   // cull on the shared center
  vec2 p = vec2(c.x + (aq.x - 0.5) * dw, c.y - (1.0 - aq.y) * dh);
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
  float cell = aB.y, col = mod(cell, uCols), row = floor(cell / uCols);
  vUV = (vec2(col, row) * uCellPx + vec2(uPadPx) + aq * uSpritePx) / uAtlas;
  vA = alpha;
}`;
  const FS_BODY = `
varying vec2 vUV; varying float vA; uniform sampler2D uTex;
void main() { FRAG = texture2D(uTex, vUV) * vA; }`;
  const U = {}; let atlasTex, instBuf;
  const CELL_W = 112, CELL_H = 142, CELL_OFF = 8, SPR_W = 96, SPR_H = 126, COLS = 8, ATLAS = 1024;   // power-of-two atlas: mipmaps work on WebGL1 too

  function initGL() {
    const attrs = { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: true };   // refuse slow software GL; Canvas2D tier is faster then
    const force = new URLSearchParams(location.search).get('renderer');      // ?renderer=2d | webgl1 | webgl2 (testing)
    if (force === '2d') return false;
    let v2 = true;
    gl = force === 'webgl1' ? null : glc.getContext('webgl2', attrs);
    if (!gl) { v2 = false; gl = glc.getContext('webgl', attrs) || glc.getContext('experimental-webgl', attrs); }
    if (!gl) return false;
    if (!v2) { ext = gl.getExtension('ANGLE_instanced_arrays'); if (!ext) { gl = null; return false; } }
    const sh = (type, src) => { const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    const vsHead = v2 ? '#version 300 es\n#define attribute in\n#define varying out\nprecision highp float;\n' : 'precision highp float;\n';
    const fsHead = v2 ? '#version 300 es\nprecision mediump float;\n#define varying in\n#define texture2D texture\nout vec4 oColor;\n#define FRAG oColor\n' : 'precision mediump float;\n#define FRAG gl_FragColor\n';
    const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vsHead + VS_BODY)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fsHead + FS_BODY));
    gl.bindAttribLocation(prog, 0, 'aq'); gl.bindAttribLocation(prog, 1, 'aA'); gl.bindAttribLocation(prog, 2, 'aB'); gl.bindAttribLocation(prog, 3, 'aC');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    for (const n of ['uRes', 'uCam', 'uAtlas', 'uCellPx', 'uSpritePx', 'uT', 'uMix', 'uZoom', 'uPad', 'uGY', 'uPPY', 'uR', 'uMaxAge', 'uFade', 'uGhost', 'uPadPx', 'uCols', 'uMode', 'uSel', 'uHov', 'uTex']) U[n] = gl.getUniformLocation(prog, n);
    if (v2) gl.bindVertexArray(gl.createVertexArray());
    const div = (loc, d) => v2 ? gl.vertexAttribDivisor(loc, d) : ext.vertexAttribDivisorANGLE(loc, d);
    const q = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, q); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    instBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    for (const [loc, off] of [[1, 0], [2, 16], [3, 32]]) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, STRIDE * 4, off); div(loc, 1); }
    atlasTex = gl.createTexture();
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.clearColor(0, 0, 0, 0);
    glOK = true; backend = v2 ? 'webgl2' : 'webgl1'; return true;
  }
  /* sprite atlas: one cell per (category color x shape); mipmapped so the GPU does the downscaling */
  function buildAtlas() {
    const mode = A.MODES[S.colorBy], key = S.colorBy;
    const cvs = document.createElement('canvas'); cvs.width = ATLAS; cvs.height = ATLAS; const x = cvs.getContext('2d');
    catKeys.forEach((k, ci) => SHAPES.forEach((sh, si) => { const n = ci * SHAPES.length + si; x.drawImage(A.sprite(mode.colors[k] || A.UNK, sh, 1.5), (n % COLS) * CELL_W + CELL_OFF, Math.floor(n / COLS) * CELL_H + CELL_OFF); }));
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cvs); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform2f(U.uAtlas, ATLAS, ATLAS); atlasMode = key;
  }
  /* per-balloon static data -> GPU. Only rewritten when layout / colors / filters change, never per frame. */
  function writeInstances() {
    if (!glOK || !inst) return;
    for (let i = 0; i < N; i++) {
      const b = order[i], o = i * STRIDE, si = b.shp === 'Racer' ? 1 : b.shp === 'Special shape' ? 2 : 0;
      inst[o] = b.xs; inst[o + 1] = b.xt; inst[o + 2] = b.t0; inst[o + 3] = b.t1 === Infinity ? 1e6 : b.t1;
      inst[o + 4] = b.rv; inst[o + 5] = (b.ci || 0) * SHAPES.length + si; inst[o + 6] = b.faFrom ?? 1; inst[o + 7] = b.faTo ?? 1; inst[o + 8] = i;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf); gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
  }
  const drawInst = () => backend === 'webgl2' ? gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, N) : ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, N);
  function drawGL(t) {
    gl.viewport(0, 0, glc.width, glc.height); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.uRes, W, H); gl.uniform2f(U.uCam, cam.tx, cam.ty);
    gl.uniform2f(U.uCellPx, CELL_W, CELL_H); gl.uniform2f(U.uSpritePx, SPR_W, SPR_H);
    gl.uniform1f(U.uT, t); gl.uniform1f(U.uMix, mixE); gl.uniform1f(U.uZoom, cam.zoom); gl.uniform1f(U.uPad, PAD); gl.uniform1f(U.uGY, GY);
    gl.uniform1f(U.uPPY, PPY); gl.uniform1f(U.uR, 4.6 * sizeK * Math.pow(cam.zoom, .55)); gl.uniform1f(U.uMaxAge, MAX_AGE); gl.uniform1f(U.uFade, A.ease(fadeT));
    gl.uniform1f(U.uGhost, S.filters.ghost ? 1 : 0); gl.uniform1f(U.uPadPx, CELL_OFF); gl.uniform1f(U.uCols, COLS);
    const selI = S.sel && S.sel.sky ? S.sel.oi : -1;
    gl.uniform1f(U.uSel, selI); gl.uniform1f(U.uHov, hoverIdx);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.uniform1i(U.uTex, 0);
    gl.uniform1f(U.uMode, 0); drawInst();
    if (selI >= 0 || hoverIdx >= 0) { gl.uniform1f(U.uMode, 1); drawInst(); }
  }

  /* ============ Canvas2D (tier 3): no GPU required ============
     Every balloon rises at the same speed, so the whole in-service fleet (~4,900 balloons) is pre-drawn ONCE into
     one tall layer and each frame is just a single scrolled blit. Only balloons that retire (~1,600 at peak) are drawn live.
     When zoomed in, only the handful on screen are drawn individually. */
  function pickTier(b, dw) { const need = dw * dpr * .95, T = A.TIER_W; return b.sp[need <= T[0] ? 0 : need <= T[1] ? 1 : need <= T[2] ? 2 : 3]; }
  function paintLayer(cvs, list, keep) {
    const T0 = A.meta.built[0], lw = Math.round((W + 2 * LM) * dpr), lh = Math.round((H + (A.meta.now + 1 - T0) * PPY + 2 * LM) * dpr);
    if (cvs.width !== lw || cvs.height !== lh) { cvs.width = lw; cvs.height = lh; }
    const c = cvs.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, lw, lh); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const b of list) {
      if (keep && !keep(b)) continue;
      const dw = 4.6 * sizeK * b.rv * 2.7, dh = dw * 1.3125, x = LM + PAD + b.xt * (W - 2 * PAD), y = LM + GY + (b.t0 - T0) * PPY;
      if (!b.pass) c.globalAlpha = .05;
      c.drawImage(pickTier(b, dw), x - dw / 2, y - dh, dw, dh);
      if (!b.pass) c.globalAlpha = 1;
    }
  }
  let layerOut = null, layerOutYear = -1;
  function buildLayer() { if (!layer) layer = document.createElement('canvas'); paintLayer(layer, inList); layerDirty = false; layerOutYear = -1; }
  /* balloons that retire later than this year's end sit in a second cached layer, rebuilt once per calendar year */
  function buildOutLayer(Y) { if (!layerOut) layerOut = document.createElement('canvas'); paintLayer(layerOut, outList, b => b.t1 >= Y + 1); layerOutYear = Y; }
  function draw2D(t) {
    gx.setTransform(1, 0, 0, 1, 0, 0); gx.clearRect(0, 0, glc.width, glc.height); gx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const useLayer = cam.zoom < 1.001 && mixE === 1, T0 = A.meta.built[0], Y = Math.floor(t);
    if (useLayer) {
      if (layerDirty) buildLayer();
      if (layerOutYear !== Y) buildOutLayer(Y);
      const groundY = cam.ty + GY + 4, dh = Math.max(1, Math.min(H, groundY)), x0 = LM - cam.tx, y0 = (t - T0) * PPY - cam.ty + LM;
      gx.drawImage(layer, x0 * dpr, y0 * dpr, W * dpr, dh * dpr, 0, 0, W, dh);      // every in-service balloon: one blit
      gx.drawImage(layerOut, x0 * dpr, y0 * dpr, W * dpr, dh * dpr, 0, 0, W, dh);   // every balloon retiring after this year: one blit
    }
    const list = useLayer ? outList : order, ghost = S.filters.ghost, R = 4.6 * sizeK * Math.pow(cam.zoom, .55), sel = S.sel;
    for (let i = 0, n = list.length; i < n; i++) {
      const b = list[i], life = t - b.t0; if (life < 0) continue;
      if (useLayer && b.t1 >= Y + 1) continue;                                      // already in the cached layer
      let alpha = life < .7 ? life / .7 : 1, age = life, sc2 = life < .7 ? .75 + .25 * life / .7 : 1;
      if (t >= b.t1) { const f = t - b.t1; if (f < 1.1) { alpha *= 1 - f / 1.1; age = b.t1 - b.t0 + f * 2.2; } else if (ghost) { alpha = .09; age = b.t1 - b.t0 + 2.4; } else continue; }
      if (b === sel || list === order && i === hoverIdx) continue;
      alpha *= b.pass ? 1 : .05;
      const sx = (PAD + curX(b) * (W - 2 * PAD)) * cam.zoom + cam.tx, sy = (GY - Math.min(age, MAX_AGE + 2) * PPY) * cam.zoom + cam.ty, dw = R * b.rv * sc2 * 2.7;
      if (sx < -dw || sx > W + dw || sy < 0 || sy > H + dw * 1.3) continue;
      if (alpha < .99) gx.globalAlpha = alpha;
      gx.drawImage(pickTier(b, dw), sx - dw / 2, sy - dw * 1.3125, dw, dw * 1.3125);
      if (alpha < .99) gx.globalAlpha = 1;
    }
    for (const [b, boost] of [[hoverIdx >= 0 ? order[hoverIdx] : null, 1.4], [sel && sel.sky ? sel : null, 1.55]]) {
      if (!b || !geom(b, t)) continue;
      const dw = P.r * boost * 2.7; gx.drawImage(pickTier(b, dw), P.x - dw / 2, P.y - dw * 1.3125, dw, dw * 1.3125);
    }
  }

  /* ============ frame loop: do work only when something moved ============ */
  function computeCounts(t) {
    gc.fill(0); cc.fill(0); let aloft = 0;
    for (let i = 0; i < N; i++) { const b = order[i]; if (t < b.t0 || t >= b.t1 || !b.pass) continue; aloft++; if (b.gi >= 0) gc[b.gi]++; cc[b.ci]++; }
    counts.aloft = aloft; counts.groups = gc; counts.catKeys = catKeys; counts.cc = cc;
  }
  function render(now) {
    requestAnimationFrame(render);
    const dtRaw = (now - last) / 1000 || 0, dt = Math.min(.05, dtRaw); last = now;
    if (vcam) return;                                  // mid-gesture the compositor moves the finished frame; we redraw once on release
    let busy = false;
    if (S.playing) {
      S.t += dt * S.speed * 2; busy = true;
      if (S.t >= A.meta.now + .99) { S.t = A.meta.now + .99; A.ui.setPlaying(false); }
    }
    if (layoutT < 1) { layoutT = Math.min(1, (now - layoutStart) / 900); mixE = A.ease(layoutT); busy = true; if (layoutT >= 1) { mixE = 1; layerDirty = true; } }
    if (cam.flying) {
      const k = 1 - Math.pow(.0009, dt);
      cam.zoom += (cam.tz - cam.zoom) * k; cam.tx += (cam.ttx - cam.tx) * k; cam.ty += (cam.tty - cam.ty) * k;
      if (Math.abs(cam.tz - cam.zoom) < .003 && Math.abs(cam.ttx - cam.tx) < .4) cam.flying = false;
      busy = true;
    }
    if (fadeT < 1) { fadeT = Math.min(1, (now - fadeStart) / 260); busy = true; }
    if (hoverReq) {
      const [mx, my] = hoverReq; hoverReq = null; const i = pick(mx, my);
      if (i !== hoverIdx) { hoverIdx = i; hit.classList.toggle('hover', i >= 0); dirty = true; if (i < 0) A.ui.hideTip(); }
      if (i >= 0) A.ui.showTip(order[i], mx, my);
    }
    if (S.sel) busy = true;                                        // selection beacon pulses
    if (busy && dtRaw > 0 && dtRaw < .5) A.perf.fps = (A.perf.fps || 60) * .92 + (1 / dtRaw) * .08;   // live frame rate, shown in the About panel
    if (!(dirty || busy) || document.hidden || W < 2 || H < 2 || backend === 'none') return;
    dirty = false;
    const t = S.t;
    drawScene();
    if (backend === '2d') draw2D(t); else drawGL(t);
    if (now - lastCount > 120 || !busy) { computeCounts(t); lastCount = now; }
    drawFx(t);
    A.perf.dpr = dpr; A.perf.size = glc.width + 'x' + glc.height;
    if (pendingCommit) { layersEl.style.transform = ''; pendingCommit = false; }   // swap the temporary transform for the freshly drawn frame
    if (A.ui) A.ui.frame(t, counts, !busy);
  }

  /* ============ interaction ============ */
  function pick(mx, my) {
    const t = S.t; let best = -1, bd = 1e9;
    for (let i = N - 1; i >= 0; i--) {
      const b = order[i]; if (!b.pass || !geom(b, t) || !P.alive) continue;
      const r = P.r, cy = P.y - r * 1.7, dx = mx - P.x, dy = my - cy, d = (dx * dx + dy * dy) / (r * r * 3.2);
      if (d < 1 && d < bd) { bd = d; best = i; }
    }
    return best;
  }
  /* Gestures: while the user drags, pinches or wheels, the layers that are already drawn are moved by the browser's
     compositor (a CSS transform: no canvas work at all). The camera is committed and the sky redrawn once, on release. */
  function beginGesture() { if (!vcam) vcam = { zoom: cam.zoom, tx: cam.tx, ty: cam.ty }; cam.flying = false; }
  function clampV(v) { v.zoom = A.clamp(v.zoom, 1, 14); v.tx = A.clamp(v.tx, W * (1 - v.zoom) - 60, 60); v.ty = A.clamp(v.ty, H * (1 - v.zoom) - 80, 60); }
  function applyGesture() { const k = vcam.zoom / cam.zoom; layersEl.style.transform = `translate3d(${vcam.tx - cam.tx * k}px,${vcam.ty - cam.ty * k}px,0) scale(${k})`; }
  function endGesture() {
    if (!vcam) return; cam.zoom = vcam.zoom; cam.tx = vcam.tx; cam.ty = vcam.ty; vcam = null;
    clampCam(); pendingCommit = true; dirty = true;
  }
  function bind() {
    let R0 = hit.getBoundingClientRect();
    const ptrs = new Map(); let pinch = null;
    const base = () => vcam || cam;
    hit.addEventListener('pointerdown', e => {
      R0 = hit.getBoundingClientRect(); try { hit.setPointerCapture(e.pointerId); } catch (err) {} ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); cam.flying = false;
      if (ptrs.size === 2) { const [p, q] = [...ptrs.values()], c = base(); pinch = { d: Math.hypot(p.x - q.x, p.y - q.y), z: c.zoom, tx: c.tx, ty: c.ty, cx: (p.x + q.x) / 2 - R0.left, cy: (p.y + q.y) / 2 - R0.top }; dragging = null; }
      else { const c = base(); dragging = { x: e.clientX, y: e.clientY, tx: c.tx, ty: c.ty, moved: false }; }
    });
    hit.addEventListener('pointermove', e => {
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && ptrs.size === 2) {
        const [p, q] = [...ptrs.values()], d = Math.hypot(p.x - q.x, p.y - q.y), cx = (p.x + q.x) / 2 - R0.left, cy = (p.y + q.y) / 2 - R0.top;
        beginGesture(); const nz = A.clamp(pinch.z * d / pinch.d, 1, 14), k = nz / pinch.z;
        vcam.zoom = nz; vcam.tx = cx - (pinch.cx - pinch.tx) * k; vcam.ty = cy - (pinch.cy - pinch.ty) * k; clampV(vcam); applyGesture(); A.ui.hideTip(); return;
      }
      if (dragging) {
        const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
        if (!dragging.moved && Math.abs(dx) + Math.abs(dy) > 5) { dragging.moved = true; hit.classList.add('drag'); A.ui.hideTip(); beginGesture(); }
        if (dragging.moved) { vcam.tx = dragging.tx + dx; vcam.ty = dragging.ty + dy; clampV(vcam); applyGesture(); }
        return;
      }
      if (e.pointerType === 'touch') return;
      hoverReq = [e.clientX - R0.left, e.clientY - R0.top];
    });
    const up = e => {
      ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
      const was = dragging; dragging = null; hit.classList.remove('drag');
      if (ptrs.size === 0) endGesture();
      if (e.type === 'pointerup' && was && !was.moved) {
        const i = pick(e.clientX - R0.left, e.clientY - R0.top);
        if (i >= 0) A.ui.select(order[i].id, { fly: true }); else if (S.sel) A.ui.select(null);
      }
    };
    hit.addEventListener('pointerup', up); hit.addEventListener('pointercancel', up);
    hit.addEventListener('pointerleave', () => { hoverReq = null; hoverIdx = -1; A.ui.hideTip(); hit.classList.remove('hover'); dirty = true; });
    hit.addEventListener('wheel', e => {
      e.preventDefault(); R0 = hit.getBoundingClientRect(); beginGesture();
      const cx = e.clientX - R0.left, cy = e.clientY - R0.top, nz = A.clamp(vcam.zoom * Math.exp(-e.deltaY * .0015), 1, 14), kk = nz / vcam.zoom;
      vcam.tx = cx - (cx - vcam.tx) * kk; vcam.ty = cy - (cy - vcam.ty) * kk; vcam.zoom = nz; clampV(vcam); applyGesture();
      clearTimeout(gestureTimer); gestureTimer = setTimeout(() => { if (!ptrs.size) endGesture(); }, 140);
    }, { passive: false });
    hit.addEventListener('dblclick', e => { R0 = hit.getBoundingClientRect(); zoomAt(e.clientX - R0.left, e.clientY - R0.top, 1.9); });
    new ResizeObserver(() => { resize(); dirty = true; }).observe(hit);
    glc.addEventListener('webglcontextlost', e => { e.preventDefault(); glOK = false; backend = 'none'; });
    glc.addEventListener('webglcontextrestored', () => { try { initGL(); buildAtlas(); writeInstances(); } catch (err) {} dirty = true; });
  }

  return {
    init(canvas) {
      cv = canvas; g = cv.getContext('2d'); hit = A.$('#hitLayer'); layersEl = A.$('#layers');
      bgc = A.$('#bgCanvas'); sc = A.$('#sceneCanvas'); sg = sc.getContext('2d'); glc = A.$('#glCanvas');
      order = A.B.filter(b => b.sky).sort((a, b) => a.t0 - b.t0); N = order.length; order.forEach((b, i) => b.oi = i);
      for (const b of A.B) { b.xs = b.xt = .5; b.oi = b.oi ?? -1; }
      order.forEach((b, i) => b.oi = i);
      inst = new Float32Array(N * STRIDE);
      try { initGL(); } catch (e) {
        console.warn('WebGL unavailable, using Canvas2D', e); glOK = false; gl = null;
        const fresh = glc.cloneNode(false); glc.replaceWith(fresh); glc = fresh;      // a canvas that has tried GL can no longer give a 2D context
      }
      if (!glOK) { gx = glc.getContext('2d'); backend = gx ? '2d' : 'none'; inList = order.filter(b => b.t1 === Infinity); outList = order.filter(b => b.t1 !== Infinity); }
      A.perf.backend = backend;
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
      const bx = baseX(curX(b)), by = baseY(Math.max(0, age));
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
