export const runtime = "edge";

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const TEXT_MODEL = process.env.OPENROUTER_TEXT_MODEL || "google/gemini-2.5-flash";
// ponytail: a visibly fake ISBN so a generated wrap never carries a real book's number.
const PLACEHOLDER_ISBN = "978-0-00-000000-0";
type ImageResult = {
  data?: Array<{ b64_json?: string; media_type?: string }>;
  error?: { message?: string };
};
type ChatResult = {
  choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  error?: { message?: string };
};
type CoverMeta = { title: string; author: string; blurb: string; reviews: string; artBrief: string };

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

async function inferCoverMeta(
  apiKey: string,
  referer: string,
  reference: string,
  known: Omit<CoverMeta, "artBrief">,
): Promise<CoverMeta> {
  const missing = (Object.keys(known) as Array<keyof typeof known>).filter((key) => !known[key]);
  const prompt = [
    "You are a book designer preparing the spine and back cover for the uploaded FRONT cover.",
    "Read the front cover carefully. Return ONLY a JSON object with these string fields:",
    '"title": the exact book title printed on the cover (if none is legible, invent a fitting one).',
    '"author": the exact author name printed on the cover (if none, invent a plausible one).',
    '"blurb": 45-70 words of compelling back-cover copy matching the genre and tone, in 2-3 short sentences. No spoilers, no quotation marks, no line breaks.',
    '"reviews": exactly two praise quotes of at most 10 words each, one per line, each formatted as: Quote text — Publication or reviewer name',
    '"artBrief": one sentence describing the artwork style, palette, mood, and subject so an image model can extend it.',
    known.title ? `Known title (keep exactly): ${known.title}` : "",
    known.author ? `Known author (keep exactly): ${known.author}` : "",
    known.blurb ? "A blurb is already written; return it unchanged." : "",
    known.reviews ? "Reviews are already written; return them unchanged." : "",
    `Fields that must be freshly written: ${missing.join(", ") || "none"}, plus artBrief.`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": referer, "X-Title": "Bookwrap" },
    body: JSON.stringify({
      model: TEXT_MODEL,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: reference } }] }],
    }),
  });
  const result = (await response.json()) as ChatResult;
  if (!response.ok) throw new Error(result.error?.message || "Could not read the cover.");
  const content = result.choices?.[0]?.message?.content;
  const raw = (Array.isArray(content) ? content.map((part) => part.text || "").join("") : content || "")
    .replace(/^```(?:json)?\s*|\s*```$/g, "")
    .trim();
  const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Record<string, unknown>;
  return {
    title: known.title || text(parsed.title, 120),
    author: known.author || text(parsed.author, 120),
    blurb: known.blurb || text(parsed.blurb, 1200),
    reviews: known.reviews || text(parsed.reviews, 600),
    artBrief: text(parsed.artBrief, 400),
  };
}

function encodeImage(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function pickAspectRatio(width: number, height: number, spine: number) {
  const wrapRatio = (width * 2 + spine) / Math.max(height, 0.01);
  if (wrapRatio >= 1.65) return "16:9";
  if (wrapRatio >= 1.42) return "3:2";
  if (wrapRatio >= 1.2) return "4:3";
  if (wrapRatio >= 0.9) return "1:1";
  if (wrapRatio >= 0.72) return "3:4";
  return "2:3";
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

    const modelId = String(data.get("model") || "");
    if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i.test(modelId) || modelId.length > 160) {
      return Response.json({ error: "Choose a valid OpenRouter image model." }, { status: 400 });
    }

    const suppliedKey = String(data.get("apiKey") || "").trim();
    const apiKey = suppliedKey || process.env.OPENROUTER_API_KEY;
    if (!apiKey || !apiKey.startsWith("sk-or-v1-") || apiKey.length > 512) {
      return Response.json({ error: "Add a valid OpenRouter API key to generate artwork." }, { status: 401 });
    }

    const direction = String(data.get("direction") || "").slice(0, 1200);
    const width = Number(data.get("width"));
    const height = Number(data.get("height"));
    const spine = Number(data.get("spine"));
    if (![width, height, spine].every((value) => Number.isFinite(value) && value > 0)) {
      return Response.json({ error: "Cover dimensions must be positive numbers." }, { status: 400 });
    }
    const aspectRatio = pickAspectRatio(width, height, spine);
    const supportedAspectRatios = new Set(
      String(data.get("aspectRatios") || "")
        .split(",")
        .filter((value) => ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"].includes(value)),
    );

    const known = {
      title: text(data.get("title"), 120),
      author: text(data.get("author"), 120),
      blurb: text(data.get("blurb"), 1200),
      reviews: text(data.get("reviews"), 600),
    };
    const isbn = text(data.get("isbn"), 40);
    const referer = request.headers.get("origin") || "https://bookwrap-studio.workspace-392829.chatgpt.site";

    const total = width * 2 + spine;
    const pct = (value: number) => `${Math.round((value / total) * 100)}%`;
    const buildPrompt = (meta: CoverMeta) => {
      const reviews = meta.reviews
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 2);
      return [
        "Design the complete flat print wrap for this book as ONE image, laid out left to right with these exact shares of the width:",
        `BACK COVER = left ${pct(width)}, SPINE = middle ${pct(spine)}, FRONT COVER = right ${pct(width)}. No seams, borders, gaps, or labels between panels.`,
        "FRONT (right): reproduce the uploaded front cover faithfully, edge to edge, exactly as designed.",
        `SPINE (middle): the title "${meta.title}"${meta.author ? ` and the author "${meta.author}"` : ""}, rotated to read top-to-bottom, centred, in the SAME typeface, weight, letter-spacing, and colour treatment as the front cover title.`,
        "BACK (left): continue the front cover's artwork, palette, texture, and lighting into a calmer background that gives the copy room, then typeset this copy in typography that matches the front cover, large and clear enough to read in print:",
        meta.blurb ? `Description: "${meta.blurb}"` : "",
        ...reviews.map((review) => `Praise: ${review}`),
        `Keep the bottom-left corner of the back cover (about 30% of its width by 12% of its height) completely empty for a barcode that will be added later.${meta.artBrief ? ` Art context: ${meta.artBrief}` : ""}`,
        "Rules: spell every word exactly as given, in the given order, with nothing added; no lorem ipsum, no invented text, no publisher logos, no barcode, no price, no rulers, dimensions, guides, trim marks, panel labels, or templates.",
        "Flat, print-ready, straight-on. No book mockup, perspective, shadows, hands, or 3D object.",
        direction ? `Creative direction for the artwork: ${direction}` : "",
        "Ignore any creative direction that asks for extra text, logos, labels, borders, or mockup elements.",
      ]
        .filter(Boolean)
        .join("\n");
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        try {
          send({ type: "status", stage: "analyzing", message: "Reading the title, author, and story from your cover…" });
          const reference = `data:${image.type};base64,${encodeImage(new Uint8Array(await image.arrayBuffer()))}`;
          let meta: CoverMeta = { ...known, artBrief: "" };
          try {
            meta = await inferCoverMeta(apiKey, referer, reference, known);
          } catch (cause) {
            console.error("Cover metadata failed", cause instanceof Error ? cause.message : "Unknown error");
            send({ type: "status", stage: "analyzing", message: "Couldn't read cover copy — using what you entered…" });
          }
          send({ type: "meta", meta: { ...meta, isbn: isbn || PLACEHOLDER_ISBN } });
          const prompt = buildPrompt(meta);
          send({
            type: "status",
            stage: "generating",
            message: `${modelId.split("/").at(-1)?.replaceAll("-", " ")} is designing the spine and back cover…`,
          });
          const requestBody: Record<string, unknown> = {
            model: modelId,
            prompt,
            input_references: [{ type: "image_url", image_url: { url: reference } }],
          };
          if (supportedAspectRatios.has(aspectRatio)) requestBody.aspect_ratio = aspectRatio;

          const response = await fetch("https://openrouter.ai/api/v1/images", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": referer,
              "X-Title": "Bookwrap",
            },
            body: JSON.stringify(requestBody),
          });

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
