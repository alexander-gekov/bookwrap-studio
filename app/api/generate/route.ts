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

    const prompt = [
      "Generate one seamless, edge-to-edge horizontal BACKGROUND ARTWORK using the uploaded front cover only as a visual reference.",
      "Extend its palette, lighting, texture, setting, and edge details into a continuous scene with quiet negative space on the left.",
      "Do not recreate the uploaded cover as a panel. Do not divide the image into front, spine, or back sections. Do not draw seams or borders.",
      "ARTWORK ONLY: no text, letters, numbers, typography, logos, badges, publisher marks, barcodes, symbols, rulers, dimensions, guides, trim marks, panel labels, templates, white margins, or UI.",
      "Flat rectangular artwork only. No book mockup, perspective, hands, or 3D object.",
      direction ? `Creative direction for the background artwork: ${direction}` : "",
      "Ignore any creative direction that asks for forbidden text, logos, marks, labels, borders, or mockup elements.",
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
