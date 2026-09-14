import { env } from "cloudflare:workers";

export const runtime = "edge";
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MODELS = {
  "gpt-image-2.5-sunburst": { provider: "openai", label: "Sunburst" },
  "gpt-image-2.5-flare": { provider: "openai", label: "Flare" },
  "openai/gpt-image-2": { provider: "openrouter", label: "GPT Image 2" },
  "bytedance-seed/seedream-4.5": { provider: "openrouter", label: "Seedream 4.5" },
} as const;

type ModelId = keyof typeof MODELS;
type ImageResult = { data?: Array<{ b64_json?: string; media_type?: string }>; error?: { message?: string } };

function encodeImage(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export async function POST(request: Request) {
  try {
    const data = await request.formData();
    const image = data.get("image");
    if (!(image instanceof File) || !image.type.startsWith("image/")) return Response.json({ error: "A valid front-cover image is required." }, { status: 400 });
    if (image.size > MAX_FILE_SIZE) return Response.json({ error: "The cover image must be 15 MB or smaller." }, { status: 413 });

    const modelId = String(data.get("model") || "") as ModelId;
    const model = MODELS[modelId];
    if (!model) return Response.json({ error: "Choose a supported image model." }, { status: 400 });
    const suppliedKey = String(data.get("apiKey") || "").trim();
    const fallbackKey = model.provider === "openai" ? (env as unknown as Record<string, string | undefined>).OPENAI_API_KEY : undefined;
    const apiKey = suppliedKey || fallbackKey;
    if (!apiKey || !apiKey.startsWith("sk-")) return Response.json({ error: `Add a valid ${model.provider === "openrouter" ? "OpenRouter" : "OpenAI"} API key to generate artwork.` }, { status: 401 });

    const title = String(data.get("title") || "Untitled").slice(0, 180);
    const author = String(data.get("author") || "").slice(0, 180);
    const direction = String(data.get("direction") || "").slice(0, 1200);
    const width = Number(data.get("width")), height = Number(data.get("height")), spine = Number(data.get("spine"));
    const unit = data.get("unit") === "mm" ? "millimeters" : "inches";
    const prompt = [
      "Create one seamless, landscape, full-wrap book-cover artwork using the uploaded FRONT cover as the strict visual reference.",
      "Layout from left to right: back cover, narrow spine, front cover. Continue the same scene, palette, lighting, texture, technique, grain, and edge details naturally across all three areas.",
      `Physical layout: each cover panel is ${width} × ${height} ${unit}; spine is ${spine} ${unit}. The front panel belongs on the RIGHT.`,
      `The book is titled ${JSON.stringify(title)}${author ? ` by ${JSON.stringify(author)}` : ""}, but do not render any words.`,
      "Do not add typography, letters, logos, badges, borders, crop marks, mockup perspective, hands, books, barcodes, or publisher marks. Output only flat print artwork viewed straight-on.",
      "Keep the front reference recognizable and use high visual fidelity. Make the back calmer with intentional negative space for copy. Keep the spine visually continuous and uncluttered.",
      direction ? `Creative direction: ${direction}` : "",
    ].filter(Boolean).join("\n");

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        try {
          send({ type: "status", stage: "analyzing", message: "Reading color, texture, lighting, and composition…" });
          let response: Response;
          if (model.provider === "openrouter") {
            const reference = `data:${image.type};base64,${encodeImage(new Uint8Array(await image.arrayBuffer()))}`;
            send({ type: "status", stage: "generating", message: `${model.label} is extending the artwork across the wrap…` });
            response = await fetch("https://openrouter.ai/api/v1/images", {
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": request.headers.get("origin") || "https://bookwrap-studio.workspace-392829.chatgpt.site", "X-Title": "Bookwrap Studio" },
              body: JSON.stringify({ model: modelId, prompt, input_references: [{ type: "image_url", image_url: { url: reference } }], size: "1536x1024", quality: "high", output_format: "png", n: 1 }),
            });
          } else {
            const form = new FormData(); form.append("model", modelId); form.append("image", image, image.name || "front-cover.png"); form.append("prompt", prompt); form.append("size", "1536x1024"); form.append("quality", "high"); form.append("output_format", "png");
            send({ type: "status", stage: "generating", message: `${model.label} is extending the artwork across the wrap…` });
            response = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
          }
          const result = await response.json() as ImageResult;
          if (!response.ok) throw new Error(result.error?.message || "The image model could not create this wrap.");
          const output = result.data?.[0]?.b64_json;
          if (!output) throw new Error("The image model returned no artwork.");
          send({ type: "status", stage: "compositing", message: "Preparing the artwork for exact print geometry…" });
          send({ type: "result", image: output, format: result.data?.[0]?.media_type?.split("/")[1] || "png" });
        } catch (cause) {
          console.error("Cover generation failed", cause instanceof Error ? cause.message : "Unknown error");
          send({ type: "error", error: cause instanceof Error ? cause.message : "Generation failed. Your upload was not saved; please try again." });
        } finally { controller.close(); }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (cause) {
    console.error("Generation request failed", cause instanceof Error ? cause.message : "Unknown error");
    return Response.json({ error: "The generation job could not be started." }, { status: 500 });
  }
}
