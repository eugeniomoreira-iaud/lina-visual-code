# LINA visual code

Tools for drawing with the geometry of the LINA logo (Laboratório de Modelagem da Informação, UFC). Everything they make is built by the logo's own construction rule: square cells on a half-cell grid, ¼-cell corner radius, convex corners where a block is free and concave ones where it meets a neighbour.

**Use it online:** https://eugeniomoreira-iaud.github.io/lina-visual-code/

- **Cells** (`grid.html`): place and move cells on a grid and watch the rule round them.
- **Textures** (`texture.html`): seeded random patterns (scatter, field, stems, glyphs) with control over blank space, format and palette.
- **Images** (`image.html`): turn a photo into halftone squares, stems or a bitmap, with the original beside the result.

All three export SVG; Textures and Images also export PNG. Textures and Images keep their settings in the page address, so a copied link reproduces a result (the image itself is not in the link). Cells keeps your drawing in the browser.

## Running locally

No build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server
```

## Typeface

The interface is set in Neometric, a licensed typeface that is not part of this repository. Without it the pages fall back to the system sans. To see them with the brand type on your machine, put these files in a `font/` folder at the root (it is ignored by git):

- `Neometric-Regular.otf`
- `Neometric Medium (Regular).otf`
- `Neometric Extra Bold (Bold).otf`

## Layout

- `lina-geometry.js`: the outline tracer shared by all three tools.
- `lina-texture.js`, `lina-image.js`: the texture and image engines.
- `lina-sample.js`: the sample portrait, embedded so the pages also work when opened from disk.
- `lina.css`: shared styles.
- `png/`: the LINA logos.

`CLAUDE.md` describes the rule in full.
