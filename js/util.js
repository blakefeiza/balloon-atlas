/* Shared namespace, data prep, palettes, helpers */
const A = { B: [], byId: new Map(), meta: null, S: {} };

A.$ = (s, r = document) => r.querySelector(s);
A.$$ = (s, r = document) => [...r.querySelectorAll(s)];
A.el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (html) e.innerHTML = html; return e; };
A.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
A.int = n => Math.round(n).toLocaleString('en-US');
A.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
A.lerp = (a, b, t) => a + (b - a) * t;
A.ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
A.hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; };
A.mkey = b => b.fam === 'Other makers' ? (b.mfr || '') + '|' + b.model : b.fam + '|' + b.model;
A.label = b => b.name || b.reg || b.id;
A.photo = (id, w = 640) => `https://drive.google.com/thumbnail?id=${id}&sz=w${w}`;

/* ---------- palettes ---------- */
A.FAM_COLORS = {   // sampled along a sunrise: dawn teal, violet, rose, coral, orange, marigold, cream
  'Cameron': '#ff6a4d', 'Aerostar / Raven': '#ffc233', 'Lindstrand': '#36b3c7', 'Firefly / Balloon Works': '#8d63d9',
  'Other makers': '#b9b0cc', 'Kubicek': '#f2569a', 'Ultramagic': '#4f7be0', 'HEAD': '#ffe9b8',
  'Experimental / Homebuilt': '#b5603f', 'Thunder & Colt': '#ff9a45', 'Adams / Richardson': '#7fd1a4', 'Avian': '#f2d3ff', 'Unknown': '#7a7396'
};
A.UNK = '#7a7396';

const US = new Set(['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming','Wisconsin']);
const TOP_STATES = ['New Mexico', 'Texas', 'Arizona', 'California', 'Michigan', 'Ohio', 'Colorado'];
A.region = b => !b.loc ? 'Unknown' : TOP_STATES.includes(b.loc) ? b.loc : US.has(b.loc) ? 'Other US' : b.loc === 'UK' ? 'UK' : b.loc === 'Canada' ? 'Canada' : 'Rest of world';
A.shape = b => b.types.some(t => /Special|Appendage/.test(t)) ? 'Special shape' : b.types.includes('Racer') ? 'Racer' : b.types.includes('Hopper') ? 'Hopper' : b.types.length ? 'Round' : 'Unknown';
A.sizeBin = b => !b.size ? 'Unknown' : b.size < 50000 ? 'Under 50k' : b.size < 80000 ? '50–80k' : b.size < 100000 ? '80–100k' : b.size < 150000 ? '100–150k' : '150k+';
A.era = b => !b.built ? 'Unknown' : b.built < 1980 ? '1960s–70s' : b.built < 1990 ? '1980s' : b.built < 2000 ? '1990s' : b.built < 2010 ? '2000s' : b.built < 2020 ? '2010s' : '2020s';

/* color modes: each yields cat(b) and an ordered category list with colors */
A.MODES = {
  fam: { label: 'Maker', cat: b => b.fam, colors: A.FAM_COLORS },
  status: { label: 'Status', cat: b => b.status === 'in' ? 'In service' : b.status === 'out' ? 'Retired' : 'Unknown',
    colors: { 'In service': '#ffc233', 'Retired': '#7c8ae8', 'Unknown': '#d9d3e6' } },
  size: { label: 'Size', cat: A.sizeBin,   // small = dawn blue, large = full sun
    colors: { 'Under 50k': '#4fc3d9', '50–80k': '#7c8ae8', '80–100k': '#c561d6', '100–150k': '#ff6a4d', '150k+': '#ffd166', 'Unknown': '#7a7396' } },
  era: { label: 'Era built', cat: A.era,   // old = gold, new = blue
    colors: { '1960s–70s': '#ffd166', '1980s': '#ff9a45', '1990s': '#ff6a4d', '2000s': '#f2569a', '2010s': '#9b6be0', '2020s': '#4fc3d9', 'Unknown': '#7a7396' } },
  shape: { label: 'Shape', cat: A.shape,
    colors: { 'Round': '#ffb454', 'Special shape': '#f2569a', 'Racer': '#36b3c7', 'Hopper': '#8d63d9', 'Unknown': '#7a7396' } },
};
A.MODE_ORDER = ['fam', 'status', 'size', 'era', 'shape'];

A.ARRANGE = {
  fam: { label: 'Maker', cat: b => b.fam },
  size: { label: 'Size', cont: true },
  region: { label: 'Region', cat: A.region },
  shape: { label: 'Shape', cat: A.shape },
};
A.ARRANGE_ORDER = ['fam', 'size', 'region', 'shape'];

/* Real-world yardsticks (cubic feet) for "how big is big" */
A.BENCH = [
  { name: 'Shipping container (40 ft)', v: 2390, ico: '▭' },
  { name: '2,500 sq ft house', v: 20000, ico: '⌂' },
  { name: 'Olympic swimming pool', v: 88300, ico: '≋' },
  { name: 'Goodyear blimp', v: 297000, ico: '◖' },
];

/* ---------- load + derive ---------- */
A.load = async function () {
  const res = await fetch('data/balloons.json');
  const d = await res.json();
  A.meta = d.meta;
  const B = d.balloons;
  const vols = [];
  for (const b of B) {
    b.hash = A.hash(b.id);
    b.h2 = A.hash(b.id + 'y');
    b.jx = (A.hash(b.id + 'a') + A.hash(b.id + 'b')) - 1;      // triangular -1..1
    b.sky = b.built != null;
    b.t0 = b.built ?? Infinity;
    b.t1 = b.status === 'out' && b.end ? b.end : Infinity;
    b.rv = b.size ? A.clamp(Math.sqrt(b.size / 90000), .55, 2.2) : 1;
    b.fam = b.fam || 'Unknown';
    b.shp = A.shape(b);
    b.search = [b.name, b.reg, b.owner, b.model, b.mfr, b.loc, b.id, ...b.prev.map(p => p[0] + ' ' + p[1])].join(' ').toLowerCase();
    if (b.size) vols.push(b.size);
    A.byId.set(b.id, b);
  }
  vols.sort((a, b) => a - b); A.vols = vols;
  A.B = B;
  // peers
  A.byModel = new Map();
  for (const b of B) if (b.model) { const k = A.mkey(b); (A.byModel.get(k) || A.byModel.set(k, []).get(k)).push(b); }
  // aloft histogram by year
  const y0 = A.meta.built[0], y1 = A.meta.now;
  A.years = []; for (let y = y0; y <= y1; y++) A.years.push(y);
  A.aloftAt = t => { let n = 0; for (const b of B) if (b.sky && b.t0 <= t && t < b.t1) n++; return n; };
  A.hist = A.years.map(y => A.aloftAt(y + .5));
  A.sizeRange = [20000, 400000];
  return A;
};

A.pct = v => { // share of balloons with volume smaller than v
  const a = A.vols; let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } return lo / a.length;
};
A.sizeToX = v => { const [a, b] = A.sizeRange; return A.clamp((Math.log(v) - Math.log(a)) / (Math.log(b) - Math.log(a)), 0, 1); };
A.fmtVol = v => v ? A.int(v) + ' cu ft' : '—';
A.fmtVolShort = v => v >= 1000 ? Math.round(v / 1000) + 'k' : String(v);

/* ---------- balloon sprite (canvas) ---------- */
A.spriteCache = new Map();
A.sprite = function (color, shape = 'Round') {
  const key = color + shape;
  let c = A.spriteCache.get(key); if (c) return c;
  const W = 64, H = 84; c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const w = shape === 'Racer' ? 15 : shape === 'Special shape' ? 28 : 25;      // half-width
  const cx = W / 2, top = 3, bot = 58;
  const path = () => { g.beginPath(); g.moveTo(cx, top);
    g.bezierCurveTo(cx + w * 1.05, top, cx + w * 1.15, 34, cx + w * .55, 50);
    g.lineTo(cx + 8, bot); g.lineTo(cx - 8, bot); g.lineTo(cx - w * .55, 50);
    g.bezierCurveTo(cx - w * 1.15, 34, cx - w * 1.05, top, cx, top); g.closePath(); };
  path();
  const grad = g.createRadialGradient(cx - w * .35, 22, 3, cx, 30, w * 1.5);
  grad.addColorStop(0, A.shade(color, 1.16)); grad.addColorStop(.45, color); grad.addColorStop(1, A.shade(color, .84));
  g.fillStyle = grad; g.fill();
  g.save(); path(); g.clip();
  g.strokeStyle = 'rgba(255,255,255,.10)'; g.lineWidth = 2.2;
  for (const k of [-.5, 0, .5]) { g.beginPath(); g.moveTo(cx, top); g.bezierCurveTo(cx + w * k * 2.4, 22, cx + w * k * 1.8, 40, cx + 8 * k * 2, bot); g.stroke(); }
  g.restore();
  g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(cx - 9, bot, 18, 4);
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(cx - 8, bot + 4); g.lineTo(cx - 5, 73); g.moveTo(cx + 8, bot + 4); g.lineTo(cx + 5, 73); g.stroke();
  g.fillStyle = '#6b4423'; g.fillRect(cx - 6, 73, 12, 8);
  g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(cx - 6, 73, 12, 2);
  A.spriteCache.set(key, c); return c;
};
A.shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (f > 1) { const k = f - 1; r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; } else { r *= f; g *= f; b *= f; }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`; };

/* inline SVG balloon art for the card hero fallback */
A.balloonSVG = (color, shape = 'Round') => {
  const w = shape === 'Racer' ? 15 : shape === 'Special shape' ? 28 : 25;
  const id = 'g' + Math.floor(Math.random() * 1e6);
  return `<svg class="art" viewBox="0 0 64 84" aria-hidden="true"><defs><radialGradient id="${id}" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="${A.shade(color, 1.16)}"/><stop offset=".45" stop-color="${color}"/><stop offset="1" stop-color="${A.shade(color, .84)}"/></radialGradient></defs>
  <path d="M32 3C${32 + w * 1.05} 3 ${32 + w * 1.15} 34 ${32 + w * .55} 50L40 58H24L${32 - w * .55} 50C${32 - w * 1.15} 34 ${32 - w * 1.05} 3 32 3Z" fill="url(#${id})"/>
  <path d="M32 3C${32 + w * 1.2} 22 ${32 + w * .9} 40 40 58M32 3C${32 - w * 1.2} 22 ${32 - w * .9} 40 24 58M32 3V58" stroke="rgba(255,255,255,.10)" stroke-width="2" fill="none"/>
  <rect x="23" y="58" width="18" height="4" fill="rgba(0,0,0,.45)"/><path d="M24 62L27 73M40 62L37 73" stroke="rgba(255,255,255,.55)" stroke-width="1.4"/><rect x="26" y="73" width="12" height="8" fill="#6b4423"/></svg>`;
};

A.colorOf = b => { const m = A.MODES[A.S.colorBy]; return m.colors[m.cat(b)] || A.UNK; };
