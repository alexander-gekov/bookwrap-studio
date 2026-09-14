export const runtime = "edge";

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MODELS = {
  "gpt-image-2.5-sunburst": { provider: "openai", label: "Sunburst" },
  "gpt-image-2.5-flare": { provider: "openai", label: "Flare" },
  "openai/gpt-image-2": { provider: "openrouter", label: "GPT Image 2" },
  "bytedance-seed/seedream-4.5": { provider: "openrouter", label: "Seedream 4.5" },
} as const;

type ModelId = keyof typeof MODELS;
type ImageResult = {
  data?: Array<{ b64_json?: string; media_type?: string }>;
  error?: { message?: string };
};

function encodeImage(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function pickSize(width: number, height: number, spine: number) {
  const wrapRatio = (width * 2 + spine) / Math.max(height, 0.01);
  if (wrapRatio >= 1.35) return "1536x1024";
  if (wrapRatio <= 0.85) return "1024x1536";
  return "1024x1024";
}

export async function POST(request: Request) {
  try {
    const data = await request.formData();
    const image = data.get("image");
    if (!(image instanceof File) || !image.type.startsWith("image/")) {
      return Response.json({ error: "A valid front-cover image is required." }, { status: 400 });
    }
    if (image.size > MAX_FILE_SIZE) {
      return Response.json({ error: "The cover image must be 15 MB or smaller." }, { status: 413 });
    }

    const modelId = String(data.get("model") || "") as ModelId;
    const model = MODELS[modelId];
    if (!model) return Response.json({ error: "Choose a supported image model." }, { status: 400 });

    const suppliedKey = String(data.get("apiKey") || "").trim();
    const fallbackKey = model.provider === "openai" ? process.env.OPENAI_API_KEY : undefined;
    const apiKey = suppliedKey || fallbackKey;
    if (!apiKey || !apiKey.startsWith("sk-")) {
      return Response.json(
        {
          error: `Add a valid ${model.provider === "openrouter" ? "OpenRouter" : "OpenAI"} API key to generate artwork.`,
        },
        { status: 401 },
      );
    }

    const title = String(data.get("title") || "Untitled").slice(0, 180);
    const author = String(data.get("author") || "").slice(0, 180);
    const blurb = String(data.get("blurb") || "").slice(0, 800);
    const reviews = String(data.get("reviews") || "").slice(0, 800);
    const isbn = String(data.get("isbn") || "").slice(0, 32);
    const direction = String(data.get("direction") || "").slice(0, 1200);
    const width = Number(data.get("width"));
    const height = Number(data.get("height"));
    const spine = Number(data.get("spine"));
    const aspect = Number(data.get("aspect"));
    const unit = data.get("unit") === "mm" ? "millimeters" : "inches";
    const size = pickSize(width, height, spine);
    const panelRatio = Number.isFinite(aspect) && aspect > 0 ? aspect : width / Math.max(height, 0.01);

    const prompt = [
      "Create one seamless landscape full-wrap book cover using the uploaded FRONT cover as the strict visual reference.",
      "Layout left to right: BACK COVER | SPINE | FRONT COVER. The three panels must feel like one continuous design.",
      `Each cover panel uses the uploaded front's proportions (about ${panelRatio.toFixed(3)} width:height). Physical sizes: panel ${width} × ${height} ${unit}, spine ${spine} ${unit}. Front is on the RIGHT.`,
      "Critical continuity: colors, lighting, texture, and edge detail at the spine/front join must match the left edge of the uploaded front so the wrap reads as one piece.",
      `Book: ${JSON.stringify(title)}${author ? ` by ${JSON.stringify(author)}` : ""}.`,
      "FRONT (right): Keep the uploaded cover recognizable. Do not restyle or rewrite its existing title treatment.",
      "SPINE (center): Large print-scale title and author using the same type family, weight, tracking, and color language as the front. Letters should fill most of the spine width.",
      "BACK (left): Finish like a real trade-paperback back. Include:",
      blurb ? `a short synopsis: ${JSON.stringify(blurb)}` : "a short synopsis in the upper half,",
      reviews
        ? `two or three review pull-quotes: ${JSON.stringify(reviews)}`
        : "two or three short review pull-quotes with attributions,",
      isbn
        ? `an ISBN barcode using ${JSON.stringify(isbn)} in the lower-left, with digits under the bars.`
        : "an ISBN barcode in the lower-left.",
      "Flat print artwork only. No mockup perspective, hands, or 3D book.",
      direction ? `Creative direction: ${direction}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        try {
          send({ type: "status", stage: "analyzing", message: "Reading color, texture, and edge continuity…" });
          let response: Response;
          if (model.provider === "openrouter") {
            const reference = `data:${image.type};base64,${encodeImage(new Uint8Array(await image.arrayBuffer()))}`;
            send({
              type: "status",
              stage: "generating",
              message: `${model.label} is extending the artwork across the wrap…`,
            });
            response = await fetch("https://openrouter.ai/api/v1/images", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer":
                  request.headers.get("origin") || "https://bookwrap-studio.workspace-392829.chatgpt.site",
                "X-Title": "Bookwrap",
              },
              body: JSON.stringify({
                model: modelId,
                prompt,
                input_references: [{ type: "image_url", image_url: { url: reference } }],
                size,
                quality: "high",
                output_format: "png",
                n: 1,
              }),
            });
          } else {
            const form = new FormData();
            form.append("model", modelId);
            form.append("image", image, image.name || "front-cover.png");
            form.append("prompt", prompt);
            form.append("size", size);
            form.append("quality", "high");
            form.append("output_format", "png");
            send({
              type: "status",
              stage: "generating",
              message: `${model.label} is extending the artwork across the wrap…`,
            });
            response = await fetch("https://api.openai.com/v1/images/edits", {
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey}` },
              body: form,
            });
          }

          const result = (await response.json()) as ImageResult;
          if (!response.ok) throw new Error(result.error?.message || "The image model could not create this wrap.");
          const output = result.data?.[0]?.b64_json;
          if (!output) throw new Error("The image model returned no artwork.");
          send({ type: "status", stage: "compositing", message: "Aligning panels to your front cover…" });
          send({
            type: "result",
            image: output,
            format: result.data?.[0]?.media_type?.split("/")[1] || "png",
          });
        } catch (cause) {
          console.error("Cover generation failed", cause instanceof Error ? cause.message : "Unknown error");
          send({
            type: "error",
            error:
              cause instanceof Error
                ? cause.message
                : "Generation failed. Your upload was not saved; please try again.",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (cause) {
    console.error("Generation request failed", cause instanceof Error ? cause.message : "Unknown error");
    return Response.json({ error: "The generation job could not be started." }, { status: 500 });
  }
}
