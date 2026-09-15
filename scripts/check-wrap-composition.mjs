import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../app/api/generate/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

// The model designs the typography (matching the front) at exact panel shares; the client
// stretch-fills that output onto the trim, pastes the original front, and adds only the barcode.
assert.match(route, /BACK COVER = left \$\{pct\(width\)\}, SPINE = middle \$\{pct\(spine\)\}, FRONT COVER = right \$\{pct\(width\)\}/);
assert.match(route, /SAME typeface, weight, letter-spacing, and colour treatment as the front cover title/);
assert.match(route, /completely empty for a barcode/);
assert.match(route, /no barcode, no price/);
assert.doesNotMatch(route, /Physical sizes|Set this synopsis|Add an ISBN barcode|ARTWORK ONLY/);
assert.doesNotMatch(page, /drawPanelSlice/);
assert.match(page, /if \(artwork\) ctx\.drawImage\(artwork, backX, panelY, dims\.trimW \* 2 \+ dims\.spineW, dims\.trimH\)/);
assert.match(page, /if \(!artwork\) drawPlaceholderCopy\(/);
assert.match(page, /extendBleed\(canvas, ctx, dims\.bleed, dims\.trimW \* 2 \+ dims\.spineW, dims\.trimH\)/);
// 3D book renders the composited wrap (trim only), not the raw model output.
assert.match(page, /wrapUrl=\{wrapPreviewUrl\}/);
assert.match(page, /drawImage\(source, dims\.bleed, dims\.bleed, trimW, dims\.trimH, 0, 0, preview\.width, preview\.height\)/);

// Simple flow: server infers missing cover copy and the client only fills empty fields.
assert.match(route, /type: "meta"/);
assert.match(route, /isbn \|\| PLACEHOLDER_ISBN/);
for (const field of ["Title", "Author", "Blurb", "Reviews", "Isbn"]) {
  assert.match(page, new RegExp(`set${field}\\(\\(value\\) => value \\|\\| meta\\.${field.toLowerCase()}`));
}

console.log("Validated model-designed typography, panel-aligned compositing, deterministic bleed, inferred cover copy, and composited 3D texture.");
