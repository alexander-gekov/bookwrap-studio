import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../app/api/generate/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

// Book cover wrap is the default; jacket stays an Advanced option.
assert.match(page, /format: "wrap"/);
assert.match(page, /Dust jacket/);
assert.match(page, /drawPrintMarks/);
assert.match(page, /BACK FLAP/);
assert.doesNotMatch(page, /format: "jacket"/);

// Jacket prompt must not feed printable panel names or percents (the model paints them).
assert.doesNotMatch(route, /BACK FLAP = left \$\{pct\(flapW\)\}/);
assert.match(route, /Never paint layout words, panel names, fold names, crop marks/);
assert.match(route, /BACK COVER = left \$\{pct\(width\)\}, SPINE = middle \$\{pct\(spine\)\}, FRONT COVER = right \$\{pct\(width\)\}/);
assert.match(route, /SAME typeface, weight, letter-spacing, and colour treatment as the front cover title/);
assert.match(route, /draw a standard vertical-bar retail barcode with the number "\$\{barcode\}"/);
assert.doesNotMatch(route, /Physical sizes|Set this synopsis|Add an ISBN barcode|ARTWORK ONLY/);
assert.doesNotMatch(page, /drawPanelSlice/);
assert.match(page, /if \(artwork\) ctx\.drawImage\(artwork, backX - dims\.flapW, panelY, artW, dims\.trimH\)/);
assert.match(page, /if \(!artwork\) drawPlaceholderCopy\(/);
assert.match(page, /extendBleed\(canvas, ctx, dims\.bleed, artW, dims\.trimH\)/);
// 3D book renders the inner wrap (back | spine | front), not flaps or fold marks.
assert.match(page, /wrapUrl=\{wrapPreviewUrl\}/);
assert.match(page, /drawImage\(source, dims\.backX, dims\.bleed, trimW, dims\.trimH, 0, 0, preview\.width, preview\.height\)/);

// Simple flow: server infers missing cover copy and the client only fills empty fields.
assert.match(route, /type: "meta"/);
assert.match(route, /isbn \|\| PLACEHOLDER_ISBN/);
for (const field of ["Title", "Author", "Blurb", "Bio", "Reviews", "Isbn"]) {
  assert.match(page, new RegExp(`set${field}\\(\\(value\\) => value \\|\\| meta\\.${field.toLowerCase()}`));
}

console.log("Validated wrap-default, jacket prompt without printable guides, panel-aligned compositing, and flap-free 3D texture.");
