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

/* ---------- balloon icon: flat, matte, panelled envelope ---------- */
A.envPath = w => `M32 3C${32 + w * 1.05} 3 ${32 + w * 1.15} 34 ${32 + w * .55} 50L40 58H24L${32 - w * .55} 50C${32 - w * 1.15} 34 ${32 - w * 1.05} 3 32 3Z`;
A.halfW = shape => shape === 'Racer' ? 15 : shape === 'Special shape' ? 28 : 25;
A.shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (f > 1) { const k = f - 1; r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; } else { r *= f; g *= f; b *= f; }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`; };

A.spriteCache = new Map();
A.sprite = function (color, shape = 'Round') {
  const key = color + shape; let c = A.spriteCache.get(key); if (c) return c;
  c = document.createElement('canvas'); c.width = 64; c.height = 84; const g = c.getContext('2d');
  const env = new Path2D(A.envPath(A.halfW(shape)));
  g.fillStyle = A.shade(color, .78); g.fill(env);                       // outer gores
  g.save(); g.clip(env);
  for (const [k, f] of [[.64, 1], [.3, 1.16]]) {                         // nested inner gores
    g.save(); g.translate(32, 0); g.scale(k, 1); g.translate(-32, 0); g.fillStyle = A.shade(color, f); g.fill(env); g.restore();
  }
  g.fillStyle = 'rgba(255,246,228,.9)'; g.fillRect(0, 30, 64, 6);        // equator band
  g.fillStyle = A.shade(color, .6); g.fillRect(0, 36, 64, 1.6);
  g.restore();
  g.lineJoin = 'round'; g.lineWidth = 2; g.strokeStyle = 'rgba(24,12,48,.62)'; g.stroke(env);
  g.fillStyle = A.shade(color, .55); g.fillRect(23, 57, 18, 4);          // skirt
  g.strokeStyle = 'rgba(24,12,48,.7)'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(25, 61); g.lineTo(27.5, 73); g.moveTo(39, 61); g.lineTo(36.5, 73); g.stroke();
  g.fillStyle = '#5a3a22'; g.fillRect(26, 73, 12, 8); g.strokeStyle = 'rgba(24,12,48,.7)'; g.strokeRect(26, 73, 12, 8);
  A.spriteCache.set(key, c); return c;
};

/* same icon as inline SVG (card hero, glyph) */
A.balloonSVG = (color, shape = 'Round', cls = 'art') => {
  const w = A.halfW(shape), id = 'e' + Math.floor(Math.random() * 1e8), d = A.envPath(w);
  const lens = (k, f) => `<path d="${d}" fill="${A.shade(color, f)}" transform="translate(32 0) scale(${k} 1) translate(-32 0)"/>`;
  return `<svg class="${cls}" viewBox="0 0 64 84" aria-hidden="true"><defs><clipPath id="${id}"><path d="${d}"/></clipPath></defs>
  <path d="${d}" fill="${A.shade(color, .78)}"/><g clip-path="url(#${id})">${lens(.64, 1)}${lens(.3, 1.16)}<rect y="30" width="64" height="6" fill="rgba(255,246,228,.9)"/><rect y="36" width="64" height="1.6" fill="${A.shade(color, .6)}"/></g>
  <path d="${d}" fill="none" stroke="rgba(24,12,48,.62)" stroke-width="2" stroke-linejoin="round"/>
  <rect x="23" y="57" width="18" height="4" fill="${A.shade(color, .55)}"/><path d="M25 61L27.5 73M39 61L36.5 73" stroke="rgba(24,12,48,.7)" stroke-width="1.3"/><rect x="26" y="73" width="12" height="8" fill="#5a3a22" stroke="rgba(24,12,48,.7)"/></svg>`;
};

A.colorOf = b => { const m = A.MODES[A.S.colorBy]; return m.colors[m.cat(b)] || A.UNK; };
