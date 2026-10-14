"""Logo Nexora en haute définition, à partir des fichiers ORIGINAUX (aucun redessin).

1. Contours : chaque zone (silhouette, bande vin, face claire de la boucle) est extraite du PNG original, sur-échantillonnée
   ×4 (bicubique, pour placer les bords au sous-pixel près), seuillée puis vectorisée par potrace en courbes de Bézier.
   Résultat : des bords nets à toute taille, sans escalier ni liseré.
2. Couleurs : le champ de couleur de chaque zone est débruité (filtre bilatéral : retire le grain de l'original sans
   toucher aux dégradés), prolongé au-delà de ses bords (inpainting) puis agrandi — les bords ne mélangent donc jamais
   deux zones.
3. Le rendu 4K est fait par render.mjs (sharp/librsvg pour les masques vectoriels).

Sorties (assets-src/logo4k/out/) : symbol-paths.json, symbol-silhouette.svg, symbol-wine.svg, symbol-light.svg,
wordmark.svg, color-*.png (champs de couleur 1254 px prolongés).
Usage : python3 -I assets-src/logo4k/trace.py   (depuis nexora/)
"""
import json
import os
import numpy as np
import cv2
import potrace
from PIL import Image

SRC = 'assets-src/'
OUT = 'assets-src/logo4k/out/'
os.makedirs(OUT, exist_ok=True)
UP = 4  # sur-échantillonnage avant vectorisation
BLUR = 0.6  # flou avant seuillage (px de l'original) : efface l'escalier des bords, angles arrondis < 2 px
OPT = 0.5  # tolérance de simplification potrace (courbes longues et régulières)


def _fit_line(Q):
    """Droite des moindres carrés : (point moyen, direction unitaire, résidu RMS)."""
    m = Q.mean(axis=0)
    u, sv, vt = np.linalg.svd(Q - m, full_matrices=False)
    return m, vt[0], sv[1] / np.sqrt(len(Q))


def _intersect(m1, d1, m2, d2):
    A = np.array([d1, -d2]).T
    if abs(np.linalg.det(A)) < 1e-6:
        return None
    t = np.linalg.solve(A, m2 - m1)
    return m1 + t[0] * d1


def _dp(P, i0, i1, eps, out):
    """Douglas–Peucker sur P[i0..i1] (indices) ; ajoute les sommets intermédiaires à out."""
    if i1 - i0 < 2:
        return
    A, B = P[i0], P[i1]
    d = B - A
    nrm = np.hypot(*d) or 1.0
    seg = P[i0 + 1:i1]
    dist = np.abs(d[0] * (seg[:, 1] - A[1]) - d[1] * (seg[:, 0] - A[0])) / nrm
    j = int(np.argmax(dist))
    if dist[j] > eps:
        _dp(P, i0, i0 + 1 + j, eps, out)
        out.append(i0 + 1 + j)
        _dp(P, i0 + 1 + j, i1, eps, out)


def smooth_contours(binary, sigma, unit):
    """L'original n'a pas d'anticrénelage : ses bords sont des escaliers d'1 px (pente jamais exactement régulière),
    qui deviennent des ondulations une fois vectorisés. Chaque contour est donc reconstruit :
      1. les portions droites (≥ 24 px, écart RMS < 0,6 px) sont remplacées par leur droite des moindres carrés ;
      2. deux droites qui se rencontrent en angle vif sont prolongées jusqu'à leur intersection exacte ;
      3. le reste (arrondis, courbes) est lissé par une gaussienne, les points des droites et des angles restant fixes."""
    h, w = binary.shape
    contours, _ = cv2.findContours(binary.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = np.zeros((h, w), np.uint8)
    g = np.exp(-0.5 * (np.arange(-int(3 * sigma), int(3 * sigma) + 1) / sigma) ** 2)
    g /= g.sum()
    pad = len(g) // 2
    polys = []
    for c in contours:
        pts = c[:, 0, :].astype(np.float64)
        closed = np.vstack([pts, pts[:1]])
        L = np.hypot(*np.diff(closed, axis=0).T)
        cum = np.concatenate([[0], np.cumsum(L)])
        if cum[-1] < 40 * unit:
            continue
        t = np.arange(0, cum[-1], 1.0)
        P = np.column_stack([np.interp(t, cum, closed[:, 0]), np.interp(t, cum, closed[:, 1])])
        n = len(P)
        # Contour elliptique (le O du logotype) : remplacé par l'ellipse ajustée, parfaitement régulière.
        (ex, ey), (ea, eb), eang = cv2.fitEllipse(P.astype(np.float32))
        th = np.radians(eang)
        loc = (P - [ex, ey]) @ np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]])
        rad = np.hypot(loc[:, 0] / (ea / 2), loc[:, 1] / (eb / 2))
        if np.sqrt(np.mean((rad - 1) ** 2)) * min(ea, eb) / 2 < 0.8 * unit:
            tt = np.linspace(0, 2 * np.pi, 720, endpoint=False)
            E = np.column_stack([ea / 2 * np.cos(tt), eb / 2 * np.sin(tt)])
            E = E @ np.array([[np.cos(th), np.sin(th)], [-np.sin(th), np.cos(th)]]) + [ex, ey]
            polys.append(np.round(E * 16).astype(np.int32))
            continue
        # Sommets Douglas–Peucker (contour fermé : découpé au point le plus éloigné du premier).
        far = int(np.argmax(np.hypot(*(P - P[0]).T)))
        Pc = np.vstack([P, P[:1]])
        vs = [0]
        _dp(Pc, 0, far, 1.2 * unit, vs)
        vs.append(far)
        _dp(Pc, far, n, 1.2 * unit, vs)
        vs = sorted(set(v % n for v in vs))
        S = P.copy()
        fixed = np.zeros(n, bool)
        def straight(a0, a1):
            core = np.arange(a0 + int(2 * unit), a1 - int(2 * unit)) % n
            m, d, rms = _fit_line(P[core])
            # Courbure résiduelle : parabole ajustée dans le repère de la droite ; flèche > 0,3 px = arc, pas droite.
            u = (P[core] - m) @ d
            v = (P[core] - m) @ np.array([-d[1], d[0]])
            q = np.polyfit(u, v, 2)[0]
            sag = abs(q) * (u.max() - u.min()) ** 2 / 4
            return (m, d) if rms < 0.6 * unit and sag < 0.3 * unit else None

        runs = []
        for v0, v1 in zip(vs, vs[1:] + [vs[0] + n]):
            if v1 - v0 >= 24 * unit and straight(v0, v1):
                # Droites voisines (même avec un court tronçon entre elles) : fusionnées si l'ensemble reste droit.
                if runs and straight(runs[-1][0], v1):
                    runs[-1] = (runs[-1][0], v1)
                else:
                    runs.append((v0, v1))
        if len(runs) > 1 and straight(runs[-1][0], runs[0][1] + n):
            runs[0] = (runs[-1][0], runs[0][1] + n)
            runs.pop()
        lines = {}  # sommet de départ -> (m, d, i0, i1)
        for v0, v1 in runs:
            m, d = straight(v0, v1)
            idx = np.arange(v0, v1 + 1) % n
            S[idx] = m + np.outer((P[idx] - m) @ d, d)
            # Extrémités laissées libres : le lissage y raccorde la droite à la courbe voisine sans marche.
            margin = min(pad, (v1 - v0) // 4)
            fixed[np.arange(v0 + margin, v1 - margin + 1) % n] = True
            lines[v0 % n] = (m, d, v0, v1)
        # Angles vifs entre deux droites consécutives.
        keys = sorted(lines)
        for i, k0 in enumerate(keys):
            m1, d1, a0, a1 = lines[k0]
            nxt = next((lines[k] for k in keys if min((k - a1) % n, (a1 - k) % n) <= 3 * unit and k != k0), None)
            if not nxt:
                continue
            m2, d2, _, _ = nxt
            if abs(d1 @ d2) > np.cos(np.radians(12)):
                continue
            X = _intersect(m1, d1, m2, d2)
            if X is None:
                continue
            vi = a1 % n
            near = np.arange(vi - int(6 * unit), vi + int(6 * unit)) % n
            if np.min(np.hypot(*(P[near] - X).T)) > 1.6 * unit:
                continue  # coin arrondi dans l'original : on garde la courbe
            # Points proches de l'angle : projetés sur leur droite respective (jusqu'à l'intersection).
            for j in near:
                q = P[j]
                p1 = m1 + ((q - m1) @ d1) * d1
                p2 = m2 + ((q - m2) @ d2) * d2
                S[j] = p1 if np.hypot(*(q - p1)) < np.hypot(*(q - p2)) else p2
                fixed[j] = True
            S[vi] = X
        ext = np.vstack([S[-pad:], S, S[:pad]])
        sm = np.column_stack([np.convolve(ext[:, j], g, 'valid') for j in (0, 1)])
        S = np.where(fixed[:, None], S, sm)
        polys.append(np.round(S * 16).astype(np.int32))
    cv2.fillPoly(out, polys, 1, lineType=cv2.LINE_8, shift=4)
    return out


def trace(mask_float, alphamax=1.0, turd=40, opttol=OPT, up=UP, sigma=None):
    """Masque [0..1] → chemin SVG (coordonnées de l'image d'origine)."""
    h, w = mask_float.shape
    big = cv2.resize(mask_float.astype(np.float32), (w * up, h * up), interpolation=cv2.INTER_CUBIC)
    shape = big > 0.5
    if sigma:
        shape = smooth_contours(shape, sigma * up, up).astype(bool)
    bm = potrace.Bitmap(~shape)  # potracer inverse le bitmap : la forme doit valoir False
    path = bm.trace(turdsize=turd * up * up, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY,
                    alphamax=alphamax, opticurve=True, opttolerance=opttol)
    s = 1.0 / up
    parts = []
    for curve in path:
        p = curve.start_point
        d = [f'M{p.x * s:.3f} {p.y * s:.3f}']
        for seg in curve.segments:
            if seg.is_corner:
                d.append(f'L{seg.c.x * s:.3f} {seg.c.y * s:.3f}L{seg.end_point.x * s:.3f} {seg.end_point.y * s:.3f}')
            else:
                d.append(f'C{seg.c1.x * s:.3f} {seg.c1.y * s:.3f} {seg.c2.x * s:.3f} {seg.c2.y * s:.3f} '
                         f'{seg.end_point.x * s:.3f} {seg.end_point.y * s:.3f}')
        parts.append(''.join(d) + 'Z')
    return ''.join(parts)


def svg(d, w, h, fill='#fff'):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">'
            f'<path fill="{fill}" fill-rule="evenodd" d="{d}"/></svg>')


def extend(color, core, iterations=24):
    """Prolonge les couleurs d'une zone au-delà de ses bords (inpainting), pour un agrandissement sans mélange."""
    img = color.copy()
    holes = (~core).astype(np.uint8) * 255
    return cv2.inpaint(img, holes, 6, cv2.INPAINT_TELEA)


# ---------------------------------------------------------------- symbole
src = np.array(Image.open(SRC + 'nexora-logo-symbol-original.png').convert('RGB'))
# Halo de quantification de l'original : pixels rouges/bleus/magenta purs (vert ≈ 0) collés aux bords. Aucune couleur
# du logo n'a un vert nul (bande : G ≥ 15, panneaux : G ≈ 13) : ces pixels sont remis au fond.
src[(src[..., 1] <= 5) & (src.max(axis=2) > 12)] = 0
H, W = src.shape[:2]
f = src.astype(np.float32)
mx = f.max(axis=2)
R, G = f[..., 0], f[..., 1]

# L'original a un liseré de pixels parasites (rouges/bleus purs) sur ses bords : filtre médian, puis léger flou
# avant le seuillage, pour des contours réguliers (les rayons du logo sont grands, les angles vifs sont conservés).
# Filtre médian ADAPTATIF : seuls les pixels aberrants (écart > 22 avec la médiane locale) sont remplacés ; les autres,
# y compris l'anticrénelage d'origine qui place les bords au sous-pixel, restent intacts.
m5 = cv2.medianBlur(src, 5)
outlier = (np.abs(src.astype(np.int16) - m5.astype(np.int16)).max(axis=2) > 22)[..., None]
med = np.where(outlier, m5, src).astype(np.float32)
wine_raw = cv2.morphologyEx(np.clip((med[..., 0] - 2 * med[..., 1] - 8) / 50.0, 0, 1), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
# Bande vin : là où elle touche le fond, elle est prolongée sous le bord de la silhouette (qui la découpe ensuite),
# pour qu'aucun liseré sombre n'apparaisse entre la bande et le fond.
panel_strict = (med.max(axis=2) >= 10) & (wine_raw < 0.1)
grown = cv2.dilate(wine_raw, np.ones((7, 7), np.uint8))
# Les panneaux = grandes zones sombres (ouverture morphologique) : le liseré coloré des bords n'en fait pas partie
# et ne doit pas bloquer le prolongement de la bande (sinon : encoches le long des diagonales).
panel_block = cv2.dilate(cv2.morphologyEx(panel_strict.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)),
                         np.ones((3, 3), np.uint8)).astype(bool)
wine = cv2.GaussianBlur(np.where(panel_block, wine_raw, np.maximum(wine_raw, grown)), (0, 0), BLUR)
den = cv2.bilateralFilter(src, 9, 18, 7)             # débruitage qui préserve les arêtes
smooth = cv2.bilateralFilter(den, 9, 14, 9)
core_wine = cv2.erode((wine_raw > 0.85).astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
core_panel = cv2.erode((panel_strict & (med.max(axis=2) >= 14)).astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
ext_wine, ext_panel = extend(smooth, core_wine), extend(smooth, core_panel)
# Silhouette = taux de couverture réel de chaque pixel de bord (fond noir pur) : pixel ÷ couleur de la zone voisine
# (bande ou panneau, champs prolongés ci-dessus). Le bord est ainsi placé à 50 % de couverture, au sous-pixel près.
d_w = cv2.distanceTransform((~core_wine).astype(np.uint8), cv2.DIST_L2, 5)
d_p = cv2.distanceTransform((~core_panel).astype(np.uint8), cv2.DIST_L2, 5)
F = np.where((d_w <= d_p)[..., None], ext_wine, ext_panel).astype(np.float32)
coverage = np.clip((med * F).sum(axis=2) / np.maximum((F * F).sum(axis=2), 1.0), 0, 1)
# Ouverture morphologique : supprime le halo d'1 px détaché du bord (présent dans l'original), sans déplacer les bords.
K3 = np.ones((3, 3), np.uint8)
sil = cv2.GaussianBlur(cv2.morphologyEx(coverage, cv2.MORPH_OPEN, K3), (0, 0), BLUR)   # panneaux + bande
lum = den[..., 0].astype(np.float32) * 0.6 + den[..., 2].astype(np.float32) * 0.4
light = ((lum > 108) & (wine > 0.6)).astype(np.uint8)
# Face claire de la boucle : composantes nettes seulement (le dégradé de la bande n'en fait pas partie).
light = cv2.morphologyEx(light, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
n, lab, stats, _ = cv2.connectedComponentsWithStats(light)
keep = np.zeros_like(light)
for i in range(1, n):
    x, y, w_, h_, area = stats[i]
    if area > 4000 and y > H * 0.55:                 # la face intérieure de la boucle, en bas à droite
        keep[lab == i] = 1
light_soft = cv2.GaussianBlur(keep.astype(np.float32), (0, 0), 1.2)

paths = {
    'width': W, 'height': H,
    'silhouette': trace(sil, alphamax=0.9, sigma=5),
    'wine': trace(wine, alphamax=1.0, sigma=5),
    'light': trace(light_soft, alphamax=1.1, turd=200, sigma=5),
}
# Panneaux sombres seuls (pour les arêtes « verre » du hero) : silhouette moins la bande.
panel = np.clip(sil - cv2.dilate(wine, np.ones((3, 3), np.uint8)), 0, 1)
paths['panels'] = trace(panel, alphamax=0.9, turd=200, sigma=5)

for k in ('silhouette', 'wine', 'light', 'panels'):
    with open(f'{OUT}symbol-{k}.svg', 'w') as fh:
        fh.write(svg(paths[k], W, H))

# Champs de couleur prolongés (débruités).
core_light = cv2.erode(keep, np.ones((5, 5), np.uint8)).astype(bool)
for name, ext in (('wine', ext_wine), ('light', extend(smooth, core_light)), ('panel', ext_panel)):
    Image.fromarray(ext).save(f'{OUT}color-{name}.png')

# ---------------------------------------------------------------- logotype (bandeau original)
ban = np.array(Image.open(SRC + 'nexora-banner-original.png').convert('RGB')).astype(np.float32)
crop = ban[360:560, 580:1490]
a = np.clip((crop.mean(axis=2) - 30) / 170, 0, 1)
ys, xs = np.where(a > 0.05)
y0, y1, x0, x1 = ys.min() - 6, ys.max() + 7, xs.min() - 6, xs.max() + 7
a = a[y0:y1, x0:x1]
wh, ww = a.shape
paths['wordmark'] = {'width': ww, 'height': wh, 'd': trace(a, alphamax=1.0, turd=8, opttol=0.4, up=6, sigma=3)}
with open(OUT + 'wordmark.svg', 'w') as fh:
    fh.write(svg(paths['wordmark']['d'], ww, wh, '#EAE6E8'))

# Position relative symbole / logotype dans le bandeau (pour un verrouillage fidèle).
bsil = np.clip(ban.max(axis=2) / 40.0, 0, 1)[250:700, 230:600]
ys2, xs2 = np.where(bsil > 0.5)
paths['banner'] = {
    'symbol_box': [int(xs2.min() + 230), int(ys2.min() + 250), int(xs2.max() + 230), int(ys2.max() + 250)],
    'wordmark_box': [int(x0 + 580), int(y0 + 360), int(x1 + 580), int(y1 + 360)],
}
with open(OUT + 'symbol-paths.json', 'w') as fh:
    json.dump(paths, fh)
print('ok', {k: (len(v) if isinstance(v, str) else v) for k, v in paths.items() if k != 'wordmark'}, 'wordmark', ww, wh)
