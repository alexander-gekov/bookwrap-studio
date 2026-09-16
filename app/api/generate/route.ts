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
    const fallbackKey = model.provider === "openai" ? process.env.OPENAI_API_KEY : undefined;
    const apiKey = suppliedKey || fallbackKey;
    if (!apiKey || !apiKey.startsWith("sk-")) return Response.json({ error: `Add a valid ${model.provider === "openrouter" ? "OpenRouter" : "OpenAI"} API key to generate artwork.` }, { status: 401 });

    const title = String(data.get("title") || "Untitled").slice(0, 180);
    const author = String(data.get("author") || "").slice(0, 180);
    const blurb = String(data.get("blurb") || "").slice(0, 800);
    const reviews = String(data.get("reviews") || "").slice(0, 800);
    const isbn = String(data.get("isbn") || "").slice(0, 32);
    const direction = String(data.get("direction") || "").slice(0, 1200);
    const width = Number(data.get("width")), height = Number(data.get("height")), spine = Number(data.get("spine"));
    const flap = Number(data.get("flap")) || 3.25;
    const jacket = data.get("format") === "jacket";
    const unit = data.get("unit") === "mm" ? "millimeters" : "inches";
    const prompt = [
      "Create one seamless, landscape, print-flat book-cover artwork using the uploaded FRONT cover as the strict visual reference.",
      jacket
        ? "Layout from left to right: BACK FLAP, BACK COVER, SPINE, FRONT COVER, FRONT FLAP. This is a dust jacket that will be printed, folded, and wrapped around a hardcover."
        : "Layout from left to right: BACK COVER, narrow SPINE, FRONT COVER.",
      jacket
        ? `Physical layout: flaps ${flap} ${unit}; covers ${width} × ${height} ${unit}; spine ${spine} ${unit}. Front cover is the panel just left of the right flap.`
        : `Physical layout: each cover panel is ${width} × ${height} ${unit}; spine is ${spine} ${unit}. The front panel belongs on the RIGHT.`,
      `Book: ${JSON.stringify(title)}${author ? ` by ${JSON.stringify(author)}` : ""}.`,
      "FRONT COVER: Keep the uploaded cover recognizable. Do not restyle or rewrite its existing title treatment.",
      "SPINE: Paint large, confident, print-scale typography — title and author — using the same type family, weight, tracking, and color language as the front. Fill most of the spine width.",
      jacket
        ? "BACK COVER: Reviews and an ISBN barcode. FRONT FLAP: the synopsis. BACK FLAP: a short author biography. Continue the scene onto both flaps, a little calmer, with room for type. Do not draw fold lines, crop marks, or a 3D book — those are added in print."
        : "BACK: Finish it like a real trade-paperback back.",
      blurb ? `Synopsis: ${JSON.stringify(blurb)}` : "",
      reviews ? `Review pull-quotes: ${JSON.stringify(reviews)}` : "Include two or three short review pull-quotes with attributions.",
      isbn ? `ISBN barcode: ${JSON.stringify(isbn)} with digits under the bars.` : "Include an ISBN barcode.",
      "Keep typography large enough to read. Flat print artwork, viewed straight-on. No mockup perspective or hands.",
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
