"""Assemble le symbole 4K : masques vectoriels (rasterize.mjs) × champs de couleur débruités et agrandis (trace.py).

La géométrie vient du fichier symbole haute définition (1254 px) ; le RENDU (luminosité de la bande, panneaux
« verre » plus clairs avec un liseré) suit le symbole du BANDEAU, recalé dessus : un gain basse fréquence calculé sur
le bandeau est appliqué aux couleurs, ce qui garde les arêtes nettes du fichier HD et l'éclairage du bandeau.
Usage : python3 -I assets-src/logo4k/compose.py 3840   (depuis nexora/)"""
import sys
import numpy as np
import cv2
from PIL import Image

N = int(sys.argv[1]) if len(sys.argv) > 1 else 3840
D = 'assets-src/logo4k/out/'
K = N / 1254


def mask(name):
    return np.asarray(Image.open(f'{D}{name}-{N}.png').convert('L'), dtype=np.float32)[..., None] / 255.0


def field(name, gain=None):
    img = np.asarray(Image.open(f'{D}color-{name}.png').convert('RGB')).astype(np.float32)
    if gain is not None:
        img = img * gain
    big = cv2.resize(img, (N, N), interpolation=cv2.INTER_LANCZOS4)
    # Lissage proportionnel à l'agrandissement : supprime le grain de l'original, garde les dégradés.
    return cv2.GaussianBlur(big, (0, 0), K * 0.9)


# --- Recalage bandeau -> symbole HD (bandes vin : boîtes englobantes mesurées, IoU 0,94) et gain d'éclairage.
src = np.asarray(Image.open('assets-src/nexora-logo-symbol-original.png').convert('RGB')).astype(np.float32)
ban = np.asarray(Image.open('assets-src/nexora-banner-original.png').convert('RGB')).astype(np.float32)
o_box, b_box = (178, 1080, 159, 1094), (277, 551, 304, 597)
sx = (b_box[1] - b_box[0]) / (o_box[1] - o_box[0])
sy = (b_box[3] - b_box[2]) / (o_box[3] - o_box[2])
to_banner = np.float32([[sx, 0, b_box[0] - o_box[0] * sx], [0, sy, b_box[2] - o_box[2] * sy]])
ban_o = cv2.warpAffine(ban, to_banner, (1254, 1254), flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP)
wine_o = ((src[..., 0] - 2 * src[..., 1] - 8) > 40) & ((ban_o[..., 0] - 2 * ban_o[..., 1] - 8) > 40)
core = cv2.erode(wine_o.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(np.float32)


def local_mean(img, m, s):
    num = cv2.GaussianBlur(img * m[..., None], (0, 0), s)
    den = cv2.GaussianBlur(m, (0, 0), s)[..., None]
    return num / np.maximum(den, 1e-3), den[..., 0]


bm, cover = local_mean(ban_o, core, 18)
om, _ = local_mean(src, core, 18)
gain = np.clip(bm / np.maximum(om, 1.0), 0.8, 1.6)
# Hors de portée du recalage : gain moyen.
mean_gain = (gain * (cover[..., None] > 0.2)).sum((0, 1)) / max(1, (cover > 0.2).sum())
gain = np.where((cover > 0.2)[..., None], gain, mean_gain)
gain = cv2.GaussianBlur(gain, (0, 0), 10)
print('gain bande (moyen)', np.round(mean_gain, 3))
PANEL_GAIN = np.array([1.36, 1.27, 1.30], np.float32)  # panneaux du bandeau / panneaux du fichier HD (moyennes)

sil, wine, light, panels = mask('symbol-silhouette'), mask('symbol-wine'), mask('symbol-light'), mask('symbol-panels')
rgb = field('panel', PANEL_GAIN)
# Panneaux « verre » du bandeau : liseré intérieur un peu plus clair, très doux.
p = panels[..., 0]
inner = cv2.erode(p, np.ones((3, 3), np.uint8), iterations=max(1, int(K * 2.2)))
rim = cv2.GaussianBlur(np.clip(p - inner, 0, 1), (0, 0), K * 1.6)[..., None]
rgb = rgb + rim * np.array([16, 12, 16], np.float32)
wfield = field('wine', gain)
pcol = rgb.copy()
rgb = rgb * (1 - wine) + wfield * wine
# Panneaux par-dessus la bande prolongée : aucun liseré vin le long des bords extérieurs des panneaux.
rgb = rgb * (1 - panels) + pcol * panels
rgb = rgb * (1 - light) + field('light', gain) * light
# Léger grain (0,6 niveau) contre l'effet de bande dans les dégradés une fois compressés.
rgb = rgb + np.random.default_rng(7).normal(0, 0.6, rgb.shape).astype(np.float32)
out = np.dstack([np.clip(rgb, 0, 255), sil[..., 0] * 255]).astype(np.uint8)
Image.fromarray(out, 'RGBA').save(f'{D}nexora-symbol-{N}.png')
bg = np.array([9, 9, 12], np.float32)
flat = rgb * sil + bg * (1 - sil)
Image.fromarray(np.clip(flat, 0, 255).astype(np.uint8)).save(f'{D}preview-{N}.png')
print('ok', N)
