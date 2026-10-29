# Rebuild with: python3 icons/dot_icons.py . /tmp   (needs Pillow; not part of the extension)
#
# The TOOLBAR icons, plain and with the one-click "chose for you" dot (Dan, 2026-10-29).
# Both are the same drawing a step smaller than the canvas (15 of 16 px, 30 of 32),
# anchored bottom left; the dot version only adds a small amber circle on the top-right
# corner, hanging just past the blue edge like an app's notification dot. Same size both
# ways, because swapping between a full-size plain icon and a smaller dotted one made the
# icon jump on every tab switch.
#  - 16 px: drawn on the pixel grid (a 15-px version of icons/dotted-line-icon-16.svg,
#    a pixel further left so the circle clears the nib's cap): anything scaled at this
#    size goes soft.
#  - 32 px: drawn from the shapes in icons/dotted-line-icon-32.svg, scaled to 30.
# The 48/128 px icons (extensions page, store) stay full size: no dot is ever shown there.
# Drawn 8x and scaled down so curves are smooth. argv: repo root, preview dir.
import sys
from PIL import Image, ImageDraw

root, preview = sys.argv[1], sys.argv[2]
BLUE, WHITE, AMBER = (29, 78, 216, 255), (255, 255, 255, 255), (245, 158, 11, 255)
k = 8


def with_dot(big, size, art):
    """A copy with the amber circle centred near the blue square's top-right corner."""
    big = big.copy()
    S = size * k
    r = S * 0.16
    cx, cy = min(art * k, S - r), max(S - art * k, r)
    ImageDraw.Draw(big).ellipse([cx - r, cy - r, cx + r, cy + r], fill=AMBER)
    return big


def draw16():
    size, art = 16, 15
    big = Image.new("RGBA", (size * k, size * k), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    oy = size - art
    d.rounded_rectangle([0, oy * k, art * k - 1, size * k - 1], radius=3.3 * k, fill=BLUE)
    white = [(1, 10, 2, 2), (4, 10, 2, 2), (7, 10, 2, 2),   # dots
             (9, 2, 3, 1),                                   # cap
             (8, 4, 5, 3), (9, 7, 3, 2), (10, 9, 1, 2)]      # nib: shoulders, body, tip
    blue = [(10, 5, 1, 1), (10, 7, 1, 2)]                    # hole, slit
    for (x, y, w, h), c in [(r, WHITE) for r in white] + [(r, BLUE) for r in blue]:
        d.rectangle([x * k, (y + oy) * k, (x + w) * k - 1, (y + h + oy) * k - 1], fill=c)
    return big, size, art


def draw32():
    size, art = 32, 30
    s = art / 32 * k
    oy = (size - art) * k
    big = Image.new("RGBA", (size * k, size * k), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    P = lambda x, y: (x * s, y * s + oy)
    d.rounded_rectangle([*P(0, 0), *P(32, 32)], radius=6.56 * s, fill=BLUE)
    for cx in (8, 13, 18):                                   # circle cx, 21.5, r 1.9
        d.ellipse([*P(cx - 1.9, 21.5 - 1.9), *P(cx + 1.9, 21.5 + 1.9)], fill=WHITE)
    d.rounded_rectangle([*P(22.5, 7.5), *P(28, 10.5)], radius=0.6 * s, fill=WHITE)
    d.polygon([P(22.8, 12), P(27.2, 12), P(29.7, 18.5), P(25, 28), P(20.4, 18.5)], fill=WHITE)
    d.ellipse([*P(25 - 1.1, 17.5 - 1.1), *P(25 + 1.1, 17.5 + 1.1)], fill=BLUE)
    d.line([P(25, 18.7), P(25, 25.5)], fill=BLUE, width=round(1.3 * s))
    return big, size, art


made = {}
for big, size, art in (draw16(), draw32()):
    for name, im in (("toolbar", big), ("toolbar-dot", with_dot(big, size, art))):
        out = im.resize((size, size), Image.LANCZOS)
        out.save(f"{root}/icons/{name}-{size}.png")
        made[(name, size)] = out

# Preview, 8x on a toolbar grey: 16 plain, 16 dot, 32 plain, 32 dot.
tiles = []
for key in (("toolbar", 16), ("toolbar-dot", 16), ("toolbar", 32), ("toolbar-dot", 32)):
    im = made[key]
    t = Image.new("RGBA", im.size, (241, 243, 244, 255)); t.alpha_composite(im)
    tiles.append(t.resize((128, 128), Image.NEAREST))
sheet = Image.new("RGBA", (4 * 152 + 24, 152), (255, 255, 255, 255))
for i, t in enumerate(tiles):
    sheet.alpha_composite(t, (24 + i * 152, 12))
sheet.save(f"{preview}/toolbar-icons.png")
print("ok")
