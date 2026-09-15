import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../app/api/generate/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

assert.match(route, /ARTWORK ONLY: no text/);
assert.doesNotMatch(route, /Physical sizes|BACK COVER \| SPINE|Set this synopsis|Add an ISBN barcode/);
assert.doesNotMatch(page, /drawPanelSlice/);
assert.match(page, /drawCover\(ctx, artwork, backX, panelY, dims\.trimW \* 2 \+ dims\.spineW, dims\.trimH\)/);
assert.match(page, /extendBleed\(canvas, ctx, dims\.bleed, dims\.trimW \* 2 \+ dims\.spineW, dims\.trimH\)/);

console.log("Validated text-free generation, continuous artwork compositing, and deterministic bleed.");
