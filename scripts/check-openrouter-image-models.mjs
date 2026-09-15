import assert from "node:assert/strict";

const response = await fetch("https://openrouter.ai/api/v1/images/models");
assert.equal(response.ok, true, `OpenRouter catalog returned ${response.status}`);

const payload = await response.json();
const models = payload.data.filter((model) => model.architecture?.input_modalities?.includes("image"));
const ids = models.map((model) => model.id);

assert(models.length > 0, "No image-editing models found");
assert(ids.some((id) => id.includes("gemini")), "Nano Banana/Gemini model missing");
assert(ids.some((id) => id.includes("seedream")), "Seedream model missing");
assert(ids.some((id) => id.includes("gpt-image")), "GPT Image model missing");

console.log(`Validated ${models.length} OpenRouter image-editing models.`);
