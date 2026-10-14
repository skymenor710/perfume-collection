"""Génère les tracés de l'illustration « montagne + chemin lumineux + porte » de la section Contact.
Sortie : src/server/views/site/landscape-paths.ts (déterministe, graine fixe). Usage : python3 -I assets-src/landscape/generate.py
"""
import math, random
random.seed(7)
W, H = 1000, 460

def ridge(points, rough, step=6):
    """Interpole des points clés et ajoute un relief rocheux (bruit multi-échelle)."""
    out = []
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        n = max(1, int(abs(x1 - x0) / step))
        for i in range(n):
            t = i / n
            x = x0 + (x1 - x0) * t
            y = y0 + (y1 - y0) * t
            y += (random.random() - .5) * rough + math.sin(x * .09) * rough * .35 + math.sin(x * .023 + 1.3) * rough * .6
            out.append((x, y))
    out.append(points[-1])
    return out

def poly(pts, close_bottom=True):
    d = 'M%.1f %.1f' % pts[0] + ''.join(' L%.1f %.1f' % p for p in pts[1:])
    if close_bottom:
        d += ' L%.1f %d L%.1f %d Z' % (pts[-1][0], H, pts[0][0], H)
    return d

far = ridge([(300, 330), (420, 285), (520, 300), (610, 250), (700, 270), (780, 215), (880, 240), (1000, 200)], 9)
mid = ridge([(380, 460), (470, 380), (560, 350), (640, 300), (700, 255), (745, 205), (790, 150), (815, 128), (850, 118), (875, 140), (910, 175), (950, 215), (1000, 240)], 7, 4)
front_l = ridge([(430, 460), (520, 420), (600, 395), (660, 370), (700, 360), (760, 330)], 6)
front_r = ridge([(820, 300), (880, 280), (930, 300), (1000, 330)], 6)

# Chemin sinueux : du bas vers la porte au sommet (courbes de Bézier).
path = ('M560 460 C 610 430, 700 420, 735 392 S 700 345, 760 322 S 880 300, 812 262 '
        'S 760 228, 820 205 S 905 180, 846 156 S 822 132, 850 124')

door = {'x': 846, 'y': 40, 'w': 26, 'h': 84}

with open('src/server/views/site/landscape-paths.ts', 'w') as f:
    f.write('// Généré par assets-src/landscape/generate.py — ne pas modifier à la main.\n')
    f.write('export const FAR = %r;\n' % poly(far))
    f.write('export const MID = %r;\n' % poly(mid))
    f.write('export const RIDGE = %r;\n' % poly(mid, False))
    f.write('export const FRONT_L = %r;\n' % poly(front_l))
    f.write('export const FRONT_R = %r;\n' % poly(front_r))
    f.write('export const TRAIL = %r;\n' % path)
    f.write('export const DOOR = %r as const;\n' % door)
print('ok', len(mid))
