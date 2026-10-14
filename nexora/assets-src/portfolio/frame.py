"""Place une capture d'écran horizontale (ex. 1600×1000) dans une fenêtre de navigateur, sur un carré 1280×1280,
sans rien recadrer. Usage : python3 -I assets-src/portfolio/frame.py <sortie.png> <capture1> [<capture2> …] (sorties numérotées)"""
import sys
from PIL import Image, ImageDraw, ImageFilter

SIZE = 1280
out_base = sys.argv[1]
for n, src in enumerate(sys.argv[2:], start=1):
    shot = Image.open(src).convert('RGB')
    w = SIZE - 2 * 48
    h = round(shot.height * w / shot.width)
    shot = shot.resize((w, h), Image.LANCZOS)
    bar = 40
    win_h = bar + h
    x0, y0 = 48, (SIZE - win_h) // 2

    # Fond : noir Nexora avec une lueur vin très douce.
    bg = Image.new('RGB', (SIZE, SIZE), (17, 16, 20))
    glow = Image.new('L', (SIZE, SIZE), 0)
    ImageDraw.Draw(glow).ellipse((SIZE * 0.15, SIZE * 0.05, SIZE * 1.05, SIZE * 0.85), fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(160))
    bg.paste(Image.new('RGB', (SIZE, SIZE), (117, 27, 53)), (0, 0), glow)

    # Ombre portée.
    shadow = Image.new('L', (SIZE, SIZE), 0)
    ImageDraw.Draw(shadow).rounded_rectangle((x0, y0 + 24, x0 + w, y0 + win_h + 24), 18, fill=150)
    shadow = shadow.filter(ImageFilter.GaussianBlur(28))
    bg.paste(Image.new('RGB', (SIZE, SIZE), (0, 0, 0)), (0, 0), shadow)

    # Fenêtre : barre + capture, coins arrondis.
    win = Image.new('RGB', (w, win_h), (42, 45, 52))
    d = ImageDraw.Draw(win)
    for i in range(3):
        cx = 22 + i * 20
        d.ellipse((cx - 6, bar // 2 - 6, cx + 6, bar // 2 + 6), fill=(74, 78, 87))
    win.paste(shot, (0, bar))
    mask = Image.new('L', (w, win_h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, win_h - 1), 16, fill=255)
    bg.paste(win, (x0, y0), mask)
    bg.save(f'{out_base}-{n}.png')
    print('ok', f'{out_base}-{n}.png')
