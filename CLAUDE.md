# LINA visual code

Tools for drawing with the geometry of the LINA logo (Laboratório de Modelagem da Informação, UFC). Everything produced here must look like it belongs to the logo family, because it is built by the logo's own construction rule, not by imitating its look.

## The rule

- One base unit: the **cell** (the foot of the L). Blocks are always cell-sized, plus the half cell where the logo itself uses it (the A's crossbar). Only the dither pattern varies dot size (the exception below).
- Any shape is a union of blocks. Its outline is traced once, treating diagonal (corner-to-corner) contact as connected, and every corner gets an arc of **¼ cell radius**. Free corners round outward; corners that meet a neighbour round inward, which puts a neck between two blocks that only touch at a corner.
- Blocks that **connect** (touch or overlap) keep a whole number of half cells between their origins, so a shape's inside geometry stays on the half-cell grid. Inside a shape, gaps are at least half a cell; the rule closes them into the half-circle arch of the n and the pill counter of the A.
- Blocks that **do not connect** may be displaced by ¼ cell, so separate shapes can sit **¼ cell apart**, the wordmark's own letter spacing. A ¼-cell gap is legal only between distinct shapes, never inside one.
- One declared exception from the logo: the A's crossbar (half a cell wide, one cell long).
- One declared exception outside the logo: the landing page's animated dither field (the banner under the header in `index.html`) is decoration, not drawn by the rule. Its dots vary in size continuously; their corners keep a fixed radius of ¼ of the dot pitch, so dots smaller than half the pitch become circles. Its darkest tiles become solid cells whose union is traced by the rule; a union's rim is dithered into cells that meet at corners (the L's neck), and mid tones draw short lines one cell wide. Dots next to a solid shrink to half a cell, and solids of different colours never touch. Beyond that banner, only the dither mode (Pontilhado) of the texture generator and of the image filter may reuse it; no other tool or page may. In the image filter the tone comes from the photo, in one colour, and the lines follow its contours.
- Colours: crimson `#9B0A0E`, oxblood `#520000` (the A), white, black. Font: Neometric (in `font/`, local only: it is licensed, so it is git-ignored and the published site falls back to the system sans).

If a change would produce a solid thinner than a cell (outside the exceptions), a ¼-cell offset between connected blocks, or a gap thinner than ¼ cell, it breaks the system. Don't ship it; say so.

## Layout

- `lina-geometry.js`: the one tracer (`traceBitmap`, `outlinePath`, `wordmark`, the four letters as blocks). All three tools draw with it. Change it only when the rule itself changes.
- `lina-texture.js` + `texture.html`: seeded random patterns (scatter, field, dither, glyphs). Ink pixels carry their shape's alignment class so placement can enforce the half-cell rule for connected pieces.
- `lina-image.js` + `image.html`: photo to dither / bitmap. Dither is the banner's pattern toned by the photo (the declared exception); bitmap keeps to the rule. Stems were tried and dropped. `LinaImage.outline` draws any result. `lina-sample.js` is the embedded sample portrait.
- `grid.html`: the cell editor.
- `index.html` + `lina.css`: landing page and shared chrome. The landing page carries the brand concept (a system is parts whose relation makes a shared property emerge; the group is that property), shown by a slider that brings the wordmark's cells from aggregate to system.
- `png/`, `references/`: brand assets and visual references. Read-only. `references/` is git-ignored.

Plain HTML, CSS and JS. No build step, no dependencies. Pages must also work when opened from Finder (that is why the sample photo is embedded). The repo is public at `github.com/lina-ufc/lina-visual-code`, and GitHub Pages serves `main` from the root (`.nojekyll`, so files are served as they are). A push to `main` is a release: the team uses the site. The interface and the README are in Brazilian Portuguese, so write new UI text in pt-BR; code, identifiers, URL keys, comments and this file stay in English. Units in code: 1 unit = ¼ cell in the engines and the editor; `lina-geometry.js` is unit-agnostic (the letter tables in it are in half cells).

## Verifying

Every generator has a legality check that can be run with Node (`node -e 'require("./lina-geometry.js"); require("./lina-texture.js"); …'`): every solid pixel must belong to a filled half-cell (2×2 units) block, cell-based modes to a filled 4×4; connected shapes share one alignment class. The dither modes are exempt: their dots are the banner's exception. Run the relevant check after touching an engine, and look at the result in a browser (`python3 -m http.server`) before calling it done. Compare against `png/red-horiz-preto.png` when the wordmark itself is involved.

Working notes live in the conversation, not in the repo. Don't add screenshots, scratch files or `.playwright-mcp/` to the project folder.

---

# Behavioral guidelines

Adapted from the Karpathy-inspired CLAUDE.md ([multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills)). They bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

Here that especially means: before adding a shape, gap or size, say whether the rule allows it.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify. A control that a designer won't reach for is a feature that wasn't asked for.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"
- Here: "Add a pattern" → "Run the legality check, hit the requested blank share within 1%, same seed gives same output, then look at it"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
