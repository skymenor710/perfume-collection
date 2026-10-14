"""Logotype NEXORA reconstruit en géométrie exacte (et non plus vectorisé d'après des pixels).

Le bandeau ne contient le logotype qu'à 124 px de hauteur de capitale : un tracé automatique en garde de petites
ondulations, et à la taille de l'en-tête (≈ 20 px) ses fûts tombent entre deux pixels, d'où un liseré flou.
Ici, chaque lettre est redessinée à partir de MESURES faites sur le bandeau (bords au sous-pixel, droites ajustées par
moindres carrés) :
  - fûts et barres : rectangles exacts ; diagonales (N, X, R, Λ) : droites ajustées ; O : ellipses ajustées ;
  - grille de dessin : hauteur de capitale = 19 unités, graisse = 3 unités (rapport du bandeau : 0,157) ;
    tous les bords verticaux et horizontaux tombent sur des unités entières. Affiché à 1 unité = 1 px (en-tête),
    2 px (écrans Retina)…, le logotype est donc parfaitement net, sans demi-pixel flou.
Sorties : out/wordmark-geometry.json (unités) ; le chemin, dans le repère du recadrage du bandeau (867 × 143), remplace
`wordmark` dans out/symbol-paths.json pour les verrouillages 4K.
Usage : python3 -I assets-src/logo4k/wordmark.py   (depuis nexora/, après trace.py)
"""
import json
import numpy as np
from PIL import Image

OUT = 'assets-src/logo4k/out/'
ban = np.asarray(Image.open('assets-src/nexora-banner-original.png').convert('L')).astype(np.float32)
CROP = (595, 384)  # origine du recadrage du logotype dans le bandeau (cf. trace.py : 867 × 143)
a = np.clip((ban[384:527, 595:1462] - 30) / 170, 0, 1)
H, W = a.shape


def edges(v):
    """Bords au sous-pixel (passage à 50 %) le long d'une ligne ou d'une colonne."""
    out = []
    for i in range(1, len(v)):
        if (v[i - 1] < 0.5) != (v[i] < 0.5):
            out.append(i - 1 + (0.5 - v[i - 1]) / (v[i] - v[i - 1]))
    return out


def row_edges(y, x0, x1):
    return [x0 + e for e in edges(a[y, x0:x1])]


def fit_line(pts):
    """x = p·y + q par moindres carrés."""
    ys, xs = np.array([p[1] for p in pts]), np.array([p[0] for p in pts])
    p, q = np.polyfit(ys, xs, 1)
    return float(p), float(q)


# ---------------------------------------------------------------- mesures
TOP = float(np.median([edges(a[:, x])[0] for x in (170, 200, 240, 620, 650)]))
BOT = float(np.median([edges(a[:, x])[-1] for x in (170, 200, 240)]))
CAP = BOT - TOP
U = CAP / 19.0  # une unité de la grille, en px du bandeau
print(f'capitale {CAP:.2f} px, unité {U:.3f} px')


def collect(x0, x1, ys, n, idx):
    pts = []
    for y in ys:
        e = row_edges(y, x0, x1)
        if len(e) == n:
            pts.append((e[idx], y))
    return pts


# N : diagonale (bords 2 et 3 quand la ligne coupe 6 bords)
N_d0 = fit_line(collect(0, 140, range(50, 95), 6, 2))
N_d1 = fit_line(collect(0, 140, range(50, 95), 6, 3))
# X : « \ » (bords 0,1 en haut ; 2,3 en bas) et « / » (2,3 en haut ; 0,1 en bas)
X_b0 = fit_line(collect(270, 410, range(14, 50), 4, 0) + collect(270, 410, range(92, 128), 4, 2))
X_b1 = fit_line(collect(270, 410, range(14, 50), 4, 1) + collect(270, 410, range(92, 128), 4, 3))
X_s0 = fit_line(collect(270, 410, range(14, 50), 4, 2) + collect(270, 410, range(92, 128), 4, 0))
X_s1 = fit_line(collect(270, 410, range(14, 50), 4, 3) + collect(270, 410, range(92, 128), 4, 1))
# R : jambe
R_l0 = fit_line(collect(580, 715, range(100, 128), 4, 2))
R_l1 = fit_line(collect(580, 715, range(100, 128), 4, 3))
# Λ : jambes
A_l0 = fit_line(collect(715, 867, range(45, 128), 4, 0))
A_l1 = fit_line(collect(715, 867, range(45, 128), 4, 1))
A_r0 = fit_line(collect(715, 867, range(45, 128), 4, 2))
A_r1 = fit_line(collect(715, 867, range(45, 128), 4, 3))


def fit_ellipse(pts):
    """Ellipse d'axes horizontaux/verticaux : A x² + B y² + C x + D y = 1."""
    P = np.array(pts)
    x, y = P[:, 0], P[:, 1]
    M = np.column_stack([x * x, y * y, x, y])
    A, B, C, D = np.linalg.lstsq(M, np.ones(len(x)), rcond=None)[0]
    cx, cy = -C / (2 * A), -D / (2 * B)
    k = 1 + A * cx * cx + B * cy * cy
    return cx, cy, np.sqrt(k / A), np.sqrt(k / B)


o_out, o_in = [], []
for y in range(2, H - 2):
    e = row_edges(y, 410, 570)
    if len(e) == 4:
        o_out += [(e[0], y), (e[3], y)]
        o_in += [(e[1], y), (e[2], y)]
    elif len(e) == 2:
        o_out += [(e[0], y), (e[1], y)]
for x in range(425, 556):
    e = edges(a[:, x])
    if len(e) == 4:
        o_out += [(x, e[0]), (x, e[3])]
        o_in += [(x, e[1]), (x, e[2])]
O_out, O_in = fit_ellipse(o_out), fit_ellipse(o_in)

# ---------------------------------------------------------------- passage en unités (x0 = bord gauche du N)
X0 = float(np.median([row_edges(y, 0, 40)[0] for y in range(20, 120)]))
ux = lambda x: (x - X0) / U  # noqa: E731
uy = lambda y: (y - TOP) / U  # noqa: E731


def line_u(l):
    """x = p·y + q (px) → x_u = p·y_u + q_u."""
    p, q = l
    return p, (p * TOP + q - X0) / U


def at(l, yu):
    p, q = line_u(l)
    return p * yu + q


snap = lambda v: float(round(v))  # noqa: E731
S = 3.0  # graisse

shapes = []
# N : fûts aux unités entières, diagonale ajustée (coupée net en haut et en bas).
nl = snap(ux(float(np.median([row_edges(y, 0, 140)[0] for y in range(20, 120)]))))
nr = snap(ux(float(np.median([row_edges(y, 0, 140)[-1] for y in range(20, 120)]))))
shapes.append([(nl, 0), (nl + S, 0), (nl + S, 19), (nl, 19)])
shapes.append([(nr - S, 0), (nr, 0), (nr, 19), (nr - S, 19)])
# Diagonale : bord gauche d0 de (nl, y0) à la ligne de base ; bord droit d1 du sommet jusqu'au fût droit (x = nr).
pd, qd = line_u(N_d0)
pe, qe = line_u(N_d1)
y_top_left = max(0.0, (nl - qd) / pd)  # d0 coupe x = nl
y_bot_right = min(19.0, (nr - qe) / pe)  # d1 coupe x = nr
shapes.append([(nl, 0), (qe, 0), (nr, y_bot_right), (nr, 19), (pd * 19 + qd, 19), (nl, y_top_left)])

# E
el = snap(ux(float(np.median([row_edges(y, 150, 270)[0] for y in range(30, 110)]))))
e_top = snap(ux(float(np.median([row_edges(y, 150, 270)[-1] for y in (12, 14, 16, 20, 22)]))))
e_mid = snap(ux(float(np.median([row_edges(y, 150, 270)[-1] for y in (64, 68, 71, 74)]))))
e_bot = snap(ux(float(np.median([row_edges(y, 150, 270)[-1] for y in (117, 120, 124, 128)]))))
mid_c = uy(float(np.median([np.mean(edges(a[:, x])[2:4]) for x in (195, 200, 205, 210)])))
m0 = snap(mid_c - S / 2)
shapes.append([(el, 0), (e_top, 0), (e_top, S), (el + S, S), (el + S, m0), (e_mid, m0), (e_mid, m0 + S), (el + S, m0 + S), (el + S, 19 - S), (e_bot, 19 - S), (e_bot, 19), (el, 19)])

# X : deux diagonales ajustées, coupées net en haut et en bas ; centrées sur leur croisement.
for l0, l1 in ((X_b0, X_b1), (X_s0, X_s1)):
    shapes.append([(at(l0, 0), 0), (at(l1, 0), 0), (at(l1, 19), 19), (at(l0, 19), 19)])

# O : anneau elliptique (deux ellipses ajustées, de sens opposés : l’intérieure fait le trou).
ocx, ocy = ux(O_out[0]), uy(O_out[1])
O = dict(cx=ocx, cy=ocy, rxo=O_out[2] / U, ryo=O_out[3] / U, rxi=O_in[2] / U, ryi=O_in[3] / U)

# R : fût, barre haute, panse (demi-cercle), barre basse, jambe ajustée.
rl = snap(ux(float(np.median([row_edges(y, 580, 715)[0] for y in range(20, 120)]))))
r_out = snap(ux(float(max(row_edges(y, 580, 715)[-1] for y in range(40, 66)))))
rb0 = snap(uy(float(np.median([edges(a[:, x])[2] for x in (615, 620, 625, 630)]))))  # haut de la barre basse
R = dict(l=rl, out=r_out, b0=rb0)
leg = [(at(R_l0, rb0), rb0), (at(R_l1, rb0), rb0), (at(R_l1, 19), 19), (at(R_l0, 19), 19)]

# Λ : trapèze extérieur moins triangle intérieur (sommet aplati, comme sur le bandeau).
lam_outer = [(at(A_l0, 19), 19), (at(A_l0, 0), 0), (at(A_r1, 0), 0), (at(A_r1, 19), 19)]
pl, ql = line_u(A_l1)
pr, qr = line_u(A_r0)
yi = (qr - ql) / (pl - pr)
lam_inner = [(at(A_l1, 19), 19), (pl * yi + ql, yi), (at(A_r0, 19), 19)]


# ---------------------------------------------------------------- chemin SVG (unités)
def poly(pts, hole=False):
    """Polygone orienté (sens horaire à l'écran ; trou : sens inverse) — remplissage nonzero sans trou parasite."""
    area = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]))
    if (area < 0) != hole:
        pts = pts[::-1]
    return 'M' + 'L'.join(f'{x:.3f} {y:.3f}' for x, y in pts) + 'Z'


def ellipse(cx, cy, rx, ry, cw):
    s = 1 if cw else 0
    return f'M{cx - rx:.3f} {cy:.3f}A{rx:.3f} {ry:.3f} 0 1 {s} {cx + rx:.3f} {cy:.3f}A{rx:.3f} {ry:.3f} 0 1 {s} {cx - rx:.3f} {cy:.3f}Z'


ro = R['out']
bowl_h = R['b0'] + S
rad = bowl_h / 2
cxr = ro - rad
rin = rad - S
r_path = (
    f'M{rl:.3f} 0L{cxr:.3f} 0A{rad:.3f} {rad:.3f} 0 0 1 {cxr:.3f} {bowl_h:.3f}L{rl + S:.3f} {bowl_h:.3f}L{rl + S:.3f} 19L{rl:.3f} 19Z'
    f'M{rl + S:.3f} {S:.3f}L{rl + S:.3f} {R["b0"]:.3f}L{cxr:.3f} {R["b0"]:.3f}A{rin:.3f} {rin:.3f} 0 0 0 {cxr:.3f} {S:.3f}Z'
)
d = ''.join(poly(s) for s in shapes)
d += ellipse(O['cx'], O['cy'], O['rxo'], O['ryo'], True) + ellipse(O['cx'], O['cy'], O['rxi'], O['ryi'], False)
d += r_path + poly(leg)
d += poly(lam_outer) + poly(lam_inner, hole=True)

xs = [p[0] for s in shapes + [leg, lam_outer] for p in s] + [O['cx'] + O['rxo'], ro]
width_u = max(xs)
geom = {'unit_px_banner': U, 'cap': 19, 'stroke': S, 'width': width_u, 'o_overshoot': O['ryo'] - 9.5, 'd': d}
with open(OUT + 'wordmark-geometry.json', 'w') as fh:
    json.dump(geom, fh)


# Même chemin dans le repère du recadrage du bandeau (pour les verrouillages 4K) : x = X0 + u·U, y = TOP + v·U.
def to_crop(dpath):
    import re
    out, toks, i = [], re.findall(r'[MLAZ]|-?\d+\.?\d*', dpath), 0
    cmd = None
    while i < len(toks):
        t = toks[i]
        if t in 'MLAZ':
            cmd = t
            out.append(t)
            i += 1
            continue
        if cmd in 'ML':
            out.append(f'{X0 + float(toks[i]) * U:.2f} {TOP + float(toks[i + 1]) * U:.2f}')
            i += 2
        elif cmd == 'A':
            rx, ry, rot, la, sw, x, y = toks[i:i + 7]
            out.append(f'{float(rx) * U:.2f} {float(ry) * U:.2f} {rot} {la} {sw} {X0 + float(x) * U:.2f} {TOP + float(y) * U:.2f}')
            i += 7
    return ''.join(o if o in 'MLAZ' else ' ' + o + ' ' for o in out).replace(' Z', 'Z').strip()


paths = json.load(open(OUT + 'symbol-paths.json'))
paths['wordmark'] = {'width': W, 'height': H, 'd': to_crop(d)}
json.dump(paths, open(OUT + 'symbol-paths.json', 'w'))
print(f'logotype : {width_u:.2f} × 19 unités ; O : {O}')
