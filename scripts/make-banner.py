"""Turn the white-background TMA banner into transparent light/dark variants.

Everything outside the logo's rounded panel (the flying notes) becomes a
single ink colour whose alpha follows how dark the source pixel was, so
anti-aliased edges stay smooth. The panel itself (border, clef, lettering,
white fill) is kept exactly as drawn.

Usage (needs Python 3 with numpy, scipy and Pillow), then convert to WebP:
  python3 scripts/make-banner.py public/brand/tma-banner.jpg light.png dark.png
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

src, out_light, out_dark = sys.argv[1:4]
img = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
h, w, _ = img.shape
lum = img @ np.array([0.299, 0.587, 0.114], dtype=np.float32)

white = lum > 200
# White connected to the image edge = page background.
labels, _ = ndimage.label(white)
edge_labels = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))) - {0}
background = np.isin(labels, list(edge_labels))

# The panel interior is the largest white region not touching the edge.
enclosed = white & ~background
lab2, n2 = ndimage.label(enclosed)
sizes = ndimage.sum(enclosed, lab2, index=range(1, n2 + 1))
interior = lab2 == (int(np.argmax(sizes)) + 1)
# The panel is its white interior plus the dark border stroke around it, and
# nothing outside the stroke, so no white from the original page survives.
stroke = ndimage.binary_dilation(interior, iterations=8) & (lum < 128)
panel = ndimage.binary_fill_holes(interior | stroke)
# The anti-aliased rim just outside the stroke belongs to the black border:
# it is drawn in black (with alpha from darkness) in both variants.
rim = ndimage.binary_dilation(panel, iterations=3) & ~panel

ink_alpha = np.clip((235.0 - lum) / 215.0, 0.0, 1.0)  # darkness -> opacity for the notes

def render(ink_rgb, path):
    out = np.zeros((h, w, 4), dtype=np.float32)
    ink = np.where(rim[..., None], np.array((20, 16, 16), np.float32), np.array(ink_rgb, np.float32))
    # Outside the panel: flat ink colour, alpha from darkness.
    alpha = np.where(panel, 1.0, ink_alpha)
    rgb = np.where(panel[..., None], img, ink)
    out[..., :3] = rgb
    out[..., 3] = alpha * 255
    # Crop to content with a small margin.
    ys, xs = np.where(out[..., 3] > 8)
    y0, y1 = max(ys.min() - 2, 0), min(ys.max() + 3, h)
    x0, x1 = max(xs.min() - 2, 0), min(xs.max() + 3, w)
    Image.fromarray(np.clip(out[y0:y1, x0:x1], 0, 255).astype(np.uint8), 'RGBA').save(path, optimize=True)
    print(path, (x1 - x0, y1 - y0))

render((20, 16, 16), out_light)    # near-black notes for light mode (--tma-ink)
render((243, 233, 230), out_dark)  # cream notes for dark mode
