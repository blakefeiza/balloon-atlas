"""xlsx -> data/balloons.json for the Balloon Atlas data app.
Usage: python3 -I prep/build_data.py /path/hot_air_balloon.xlsx
Repairs overflow rows, parses fields, and models retirement years (flagged as estimates).
"""
import sys, re, json, math, hashlib, os
import pandas as pd

SRC = sys.argv[1] if len(sys.argv) > 1 else '/Users/blakefeiza/Downloads/hot_air_balloon.xlsx'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'balloons.json')
NOW = 2026

raw = pd.read_excel(SRC, header=1, dtype=object)
raw = raw.where(raw.notna(), None)

# ---- 1. repair overflow rows (long previous-owner lists spilled into following rows)
rows, parent = [], None
repaired = 0
for _, r in raw.iterrows():
    r = r.to_dict()
    if str(r['BalloonID']).startswith('HAB-'):
        parent = r; rows.append(r); continue
    if parent is None: continue
    repaired += 1
    frag = str(r['BalloonID']).strip()
    po = (parent.get('PreviousOwners') or '').rstrip()
    parent['PreviousOwners'] = (po + ' ' + frag).strip()
    # tail fragment carries shifted Image/Seen/Crewed/Flown/BurnerTime
    if r.get('Name') and str(r['Name']).startswith('http'):
        parent['Image'] = r['Name']; parent['Seen'] = r['Registration']
        parent['Crewed'] = r['Manufacturer']; parent['Flown'] = r['Model']; parent['BurnerTime'] = r['SerialNumber']
df = pd.DataFrame(rows)

def clean(v):
    if v is None: return None
    s = str(v).strip()
    return None if s in ('', 'N/A', 'nan', 'No', 'Unknown') else s

def drive_id(u):
    if not u: return None
    m = re.search(r'/d/([\w-]+)', str(u)); return m.group(1) if m else None

def years_in(s):
    return [int(y) for y in re.findall(r'(?<!\d)(19[5-9]\d|20[0-2]\d)(?!\d)', str(s or ''))]

FAMILY = [  # (regex on manufacturer, family)
    (r'^Cameron', 'Cameron'), (r'^Lindstrand', 'Lindstrand'), (r'^Aerostar|Raven', 'Aerostar / Raven'),
    (r'^Firefly|Balloon Works', 'Firefly / Balloon Works'), (r'^Adams', 'Adams / Richardson'),
    (r'^Thunder', 'Thunder & Colt'), (r'^Kubicek', 'Kubicek'), (r'^Ultramagic', 'Ultramagic'),
    (r'^HEAD', 'HEAD'), (r'^Avian', 'Avian'), (r'^Experimental', 'Experimental / Homebuilt'),
]
def family(m):
    if not m: return 'Unknown'
    for rx, f in FAMILY:
        if re.search(rx, m): return f
    return None  # decided later (small makers -> Other)

out = []
for r in df.to_dict('records'):
    yb = str(r.get('YearBuilt') or '')
    built_all = years_in(yb.split('Rebuilt')[0].split('ex.')[0]) or []
    built = built_all[0] if built_all else None
    m = re.match(r'^\s*(\d{4})', yb)
    if built is None and m:
        y = int(m.group(1))
        if y in (2965, 2995): built = y - 1000   # obvious typos
    rebuilt = sorted({y for y in years_in(yb.split('Rebuilt')[-1]) if built and y > built and y <= NOW}) if 'ebuil' in yb else []
    sz = re.match(r'^\s*([\d,]+)', str(r.get('Size') or ''))
    size = int(sz.group(1).replace(',', '')) if sz else None
    po = []
    for part in re.split(r',\s*(?=[^,]*?\s-\s)|,\s*$', (r.get('PreviousOwners') or '').replace('\n', ' ')):
        part = part.strip().strip(',').strip()
        if not part: continue
        if ' - ' in part:
            o, n = part.split(' - ', 1)
        else:
            o, n = part, ''
        n = n.strip().rstrip(',')
        po.append([o.strip(), '' if n in ('N/A', '') else n])
    types = [t.strip() for t in str(r.get('Type') or '').split(',') if t.strip()]
    status = r.get('Status')
    out.append(dict(
        id=r['BalloonID'], name=clean(r.get('Name')), reg=clean(r.get('Registration')),
        mfr=clean(r.get('Manufacturer')), model=clean(r.get('Model')), serial=clean(r.get('SerialNumber')),
        built=built, rebuilt=rebuilt, size=size, owner=clean(r.get('PilotOwner')), loc=clean(r.get('Location')),
        status={'In Service': 'in', 'Out of Service': 'out'}.get(status, 'unk'),
        seenIP=r.get('SeenInPerson') == 'Yes', yearsSeen=sorted(set(years_in(r.get('YearsSeen')))),
        types=types, prev=po, img=drive_id(r.get('Image')),
        extra=[d for d in (drive_id(u) for u in re.split(r'[\s,]+', str(r.get('AdditionalImages') or ''))) if d],
        seen=r.get('Seen') == 'Yes', crewed=r.get('Crewed') == 'Yes', flown=r.get('Flown') == 'Yes', burner=r.get('BurnerTime') == 'Yes',
        note=clean(r.get('Notes')),
    ))

# families: makers with >=40 balloons keep their own name, the rest -> Other
from collections import Counter
cnt = Counter(o['mfr'] for o in out)
for o in out:
    f = family(o['mfr'])
    o['fam'] = f or ('Other makers' if o['mfr'] else 'Unknown')
    if o['mfr'] is None: o['fam'] = 'Unknown'
    o['model'] = o['model'] or None

# drop rows with nothing usable
out = [o for o in out if o['mfr'] or o['size'] or o['built']]

# ---- 2. retirement model (estimated): Weibull survival fit to cohort attrition
coh = [(o['built'], o['status']) for o in out if o['built'] and 1969 <= o['built'] <= NOW and o['status'] != 'unk']
def F(a, k, lam): return 1 - math.exp(-((a / lam) ** k))
def loglik(par):
    k, lam = par; ll = 0
    for b, s in coh:
        p = min(max(F(NOW - b + 1, k, lam), 1e-9), 1 - 1e-9)
        ll += math.log(p) if s == 'out' else math.log(1 - p)
    return ll
best = max(((k / 10, lam) for k in range(8, 40, 2) for lam in range(20, 140, 4)), key=loglik)
K, LAM = best
print('weibull k, lambda', K, LAM)
for yr in (1975, 1985, 1995, 2005, 2015):
    sub = [s for b, s in coh if yr <= b < yr + 5]
    print(yr, 'observed out', round(sum(s == 'out' for s in sub) / len(sub), 2), 'model', round(F(NOW - yr - 2, K, LAM), 2))

def u01(key):
    return int(hashlib.md5(key.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF

for o in out:
    o['end'] = None; o['endEst'] = False
    if not o['built'] or o['status'] != 'out': continue
    lastactive = max([o['built']] + o['rebuilt'] + o['yearsSeen'])
    span = NOW - o['built'] + 1
    lo = max(0, lastactive - o['built'])
    f_lo, f_hi = F(lo, K, LAM), F(span, K, LAM)
    u = f_lo + (f_hi - f_lo) * u01(o['id'])
    age = LAM * (-math.log(1 - u)) ** (1 / K)
    o['end'] = round(min(NOW, o['built'] + max(age, 1.0)), 2); o['endEst'] = True

h = K
meta = dict(now=NOW, weibull=[K, LAM], count=len(out), repaired=repaired,
            built=[min(o['built'] for o in out if o['built']), NOW])
json.dump(dict(meta=meta, balloons=out), open(OUT, 'w'), separators=(',', ':'))
print(meta, os.path.getsize(OUT) // 1024, 'KB')
print(Counter(o['fam'] for o in out).most_common(14))
print('no built', sum(1 for o in out if not o['built']), 'no size', sum(1 for o in out if not o['size']))
print(sum(len(o['prev']) > 0 for o in out), 'with prev owners; max chain', max(len(o['prev']) for o in out))
