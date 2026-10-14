"""Extrait les éléments de marque à partir des fichiers ORIGINAUX fournis (sans redessiner la marque).

  nexora-logo-symbol-original.png  -> symbole N détouré (alpha), masque de la bande vin (néon), arêtes des panneaux
  nexora-banner-original.png       -> logotype NEXORA (blanc chaud, alpha) + image de partage (Open Graph)

Le symbole est sur fond noir pur (0,0,0) : l'alpha est déduit de la luminosité (les panneaux sombres valent ~20),
puis la couleur est « dé-prémultipliée ». Aucune déformation : seul un recadrage autour de la forme est appliqué.
Usage : python3 -I assets-src/extract_brand.py  (depuis nexora/)
"""
from PIL import Image, ImageFilter
import numpy as np

SRC = 'assets-src/'
OUT = 'public/brand/'

src = np.array(Image.open(SRC + 'nexora-logo-symbol-original.png').convert('RGB')).astype(np.float32)
mx = src.max(axis=2)
alpha = np.clip(mx / 19.0, 0, 1)
rgb = np.clip(np.where(alpha[..., None] > 0, src / np.maximum(alpha[..., None], 1e-6), 0), 0, 255)
R, G = src[..., 0], src[..., 1]
wine = np.clip((R - 2 * G - 8) / 50.0, 0, 1)

ys, xs = np.where(alpha > 0.02)
pad = 8
x0, y0 = max(0, xs.min() - pad), max(0, ys.min() - pad)
x1, y1 = min(src.shape[1], xs.max() + 1 + pad), min(src.shape[0], ys.max() + 1 + pad)
box = (x0, y0, x1, y1)

sym = Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), 'RGBA').crop(box)

# Masque de la bande vin : légèrement érodé pour que le reflet ne déborde jamais sur le noir.
m = Image.fromarray((wine * 255).astype(np.uint8), 'L').crop(box)
m = m.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(1.2))
mask = Image.new('RGBA', m.size, (255, 255, 255, 0)); mask.putalpha(m)

# Arêtes extérieures des panneaux sombres (contour contre le fond uniquement) : effet « verre » discret.
panel = Image.fromarray((((alpha > 0.5) & (wine < 0.2)) * 255).astype(np.uint8), 'L').crop(box)
bg = Image.fromarray(((alpha < 0.3) * 255).astype(np.uint8), 'L').crop(box)
near_bg = np.array(bg.filter(ImageFilter.MaxFilter(5))) > 0
edge = (np.array(panel) > 0) & near_bg
e = Image.fromarray((edge * 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(0.7))
edges = Image.new('RGBA', e.size, (255, 255, 255, 0)); edges.putalpha(e)

def save_sizes(img, name, widths, fmt_opts):
    for w in widths:
        h = round(img.height * w / img.width)
        r = img.resize((w, h), Image.LANCZOS)
        for ext, opts in fmt_opts:
            r.save(f'{OUT}{name}-{w}.{ext}', **opts)

save_sizes(sym, 'symbol', [96, 320, 480, 640, 960], [('webp', dict(quality=90, method=6))])
save_sizes(mask, 'symbol-wine-mask', [480, 960], [('webp', dict(lossless=True, method=6))])
save_sizes(edges, 'symbol-edges', [480, 960], [('webp', dict(lossless=True, method=6))])
print('symbol', sym.size)

# Logotype NEXORA depuis le bandeau.
b = np.array(Image.open(SRC + 'nexora-banner-original.png').convert('RGB')).astype(np.float32)
crop = b[360:560, 580:1490]
a = np.clip((crop.mean(axis=2) - 30) / 170, 0, 1)
ys, xs = np.where(a > 0.05)
a = a[ys.min() - 4: ys.max() + 5, xs.min() - 4: xs.max() + 5]
wm = np.zeros((a.shape[0], a.shape[1], 4), np.uint8)
wm[..., 0], wm[..., 1], wm[..., 2], wm[..., 3] = 234, 230, 232, (a * 255).astype(np.uint8)
wmi = Image.fromarray(wm, 'RGBA')
save_sizes(wmi, 'wordmark', [300, 480], [('webp', dict(lossless=True, method=6))])
print('wordmark', wmi.size)

# Image de partage 1200x630 (bandeau original, recadré au centre).
ban = Image.open(SRC + 'nexora-banner-original.png').convert('RGB')
r = ban.resize((1200, round(ban.height * 1200 / ban.width)), Image.LANCZOS)
top = (r.height - 630) // 2
r.crop((0, top, 1200, top + 630)).save(OUT + 'og-image.jpg', quality=86, optimize=True, progressive=True)

# Icônes (symbole centré sur fond #09090C pour l'icône d'application, transparent pour le favicon).
def icon(size, bg):
    c = Image.new('RGBA', (size, size), bg)
    s = sym.copy(); s.thumbnail((round(size * 0.78), round(size * 0.78)), Image.LANCZOS)
    c.alpha_composite(s, ((size - s.width) // 2, (size - s.height) // 2))
    return c
icon(180, (9, 9, 12, 255)).convert('RGB').save(OUT + 'apple-touch-icon.png', optimize=True)
icon(192, (9, 9, 12, 255)).save(OUT + 'icon-192.png', optimize=True)
icon(512, (9, 9, 12, 255)).save(OUT + 'icon-512.png', optimize=True)
fav = icon(64, (0, 0, 0, 0))
fav.save(OUT + 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
icon(32, (0, 0, 0, 0)).save(OUT + 'favicon-32.png', optimize=True)
