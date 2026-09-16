export const runtime = "edge";

const MAX_FILE_SIZE = 15 * 1024 * 1024;
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

function pickAspectRatio(width: number, height: number, spine: number, flaps = 0) {
  const wrapRatio = (width * 2 + spine + flaps * 2) / Math.max(height, 0.01);
  if (wrapRatio >= 2) return "21:9";
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

    const title = String(data.get("title") || "").slice(0, 180);
    const author = String(data.get("author") || "").slice(0, 180);
    const blurb = String(data.get("blurb") || "").slice(0, 800);
    const bio = String(data.get("bio") || "").slice(0, 800);
    const reviews = String(data.get("reviews") || "").slice(0, 800);
    const isbn = String(data.get("isbn") || "").slice(0, 32);
    const direction = String(data.get("direction") || "").slice(0, 1200);
    const width = Number(data.get("width"));
    const height = Number(data.get("height"));
    const spine = Number(data.get("spine"));
    const flap = Number(data.get("flap"));
    const jacket = data.get("format") === "jacket";
    const aspect = Number(data.get("aspect"));
    if (![width, height, spine].every((value) => Number.isFinite(value) && value > 0)) {
      return Response.json({ error: "Cover dimensions must be positive numbers." }, { status: 400 });
    }
    const flapWidth = jacket && Number.isFinite(flap) && flap > 0 ? flap : 0;
    const unit = data.get("unit") === "mm" ? "millimeters" : "inches";
    const aspectRatio = pickAspectRatio(width, height, spine, flapWidth);
    const panelRatio = Number.isFinite(aspect) && aspect > 0 ? aspect : width / Math.max(height, 0.01);
    const supportedAspectRatios = new Set(
      String(data.get("aspectRatios") || "")
        .split(",")
        .filter((value) => ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"].includes(value)),
    );

    const prompt = [
      "Create one seamless landscape print-flat book cover using the uploaded FRONT cover as the strict visual reference.",
      jacket
        ? "Layout left to right: BACK FLAP | BACK COVER | SPINE | FRONT COVER | FRONT FLAP. This is a dust jacket that will be printed, folded, and wrapped around a hardcover."
        : "Layout left to right: BACK COVER | SPINE | FRONT COVER. The three panels must feel like one continuous design.",
      jacket
        ? `Cover panels use the uploaded front's proportions (about ${panelRatio.toFixed(3)} width:height). Physical sizes: flaps ${flapWidth} ${unit}, covers ${width} × ${height} ${unit}, spine ${spine} ${unit}. Front cover sits just left of the right flap.`
        : `Each cover panel uses the uploaded front's proportions (about ${panelRatio.toFixed(3)} width:height). Physical sizes: panel ${width} × ${height} ${unit}, spine ${spine} ${unit}. Front is on the RIGHT.`,
      "Critical continuity: colors, lighting, texture, and edge detail at each fold must match so the jacket reads as one piece.",
      title || author ? `Book: ${JSON.stringify(title)}${author ? ` by ${JSON.stringify(author)}` : ""}.` : "",
      "FRONT COVER: Keep the uploaded cover recognizable. Do not restyle or rewrite its existing title treatment.",
      title || author
        ? "SPINE: Set the supplied title and author using the same type family, weight, tracking, and color language as the front."
        : "SPINE: Continue the artwork without inventing title or author text.",
      jacket
        ? "BACK COVER: Reviews and optional ISBN. FRONT FLAP: the synopsis. BACK FLAP: a short author biography. Continue the scene onto both flaps, calmer, with room for type. Do not draw fold lines or crop marks."
        : "BACK: Finish like a real trade-paperback back while preserving clear, usable composition.",
      blurb ? `Synopsis: ${JSON.stringify(blurb)}.` : "Do not invent synopsis copy.",
      jacket && bio ? `Author biography for the back flap: ${JSON.stringify(bio)}.` : "",
      reviews ? `Review quotes: ${JSON.stringify(reviews)}.` : "Do not invent review quotes.",
      isbn
        ? `Add an ISBN barcode using ${JSON.stringify(isbn)} on the back, with digits under the bars.`
        : "Do not add an ISBN or barcode.",
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
          const reference = `data:${image.type};base64,${encodeImage(new Uint8Array(await image.arrayBuffer()))}`;
          send({
            type: "status",
            stage: "generating",
            message: `${modelId.split("/").at(-1)?.replaceAll("-", " ")} is extending the artwork across the wrap…`,
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
              "HTTP-Referer":
                request.headers.get("origin") || "https://bookwrap-studio.workspace-392829.chatgpt.site",
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
