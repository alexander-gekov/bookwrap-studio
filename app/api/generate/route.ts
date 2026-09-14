import { env } from "cloudflare:workers";

export const runtime = "edge";
const MAX_FILE_SIZE = 15 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const data = await request.formData();
    const image = data.get("image");
    if (!(image instanceof File) || !image.type.startsWith("image/")) return Response.json({ error: "A valid front-cover image is required." }, { status: 400 });
    if (image.size > MAX_FILE_SIZE) return Response.json({ error: "The cover image must be 15 MB or smaller." }, { status: 413 });
    const provider = data.get("provider") === "openrouter" ? "openrouter" : "openai";
    const suppliedKey = String(data.get("apiKey") || "").trim();
    const apiKey = suppliedKey || (env as unknown as Record<string, string | undefined>).OPENAI_API_KEY;
    if (!apiKey || !apiKey.startsWith("sk-")) return Response.json({ error: `Add a valid ${provider === "openrouter" ? "OpenRouter" : "OpenAI"} API key to generate artwork.` }, { status: 401 });
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
    let response: Response;
    if (provider === "openrouter") {
      const bytes = new Uint8Array(await image.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      const reference = `data:${image.type};base64,${btoa(binary)}`;
      response = await fetch("https://openrouter.ai/api/v1/images", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": request.headers.get("origin") || "https://bookwrap-studio.sites.openai.com", "X-Title": "Bookwrap Studio" },
        body: JSON.stringify({ model: "openai/gpt-image-2", prompt, input_references: [{ type: "image_url", image_url: { url: reference } }], size: "1536x1024", quality: "high", output_format: "png", n: 1 }),
      });
    } else {
      const form = new FormData();
      form.append("model", "gpt-image-2.5-sunburst"); form.append("image", image, image.name || "front-cover.png"); form.append("prompt", prompt);
      form.append("size", "1536x1024"); form.append("quality", "high"); form.append("output_format", "png");
      response = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
    }
    const result = await response.json() as { data?: Array<{ b64_json?: string; media_type?: string }>; error?: { message?: string } };
    if (!response.ok) { console.error("OpenAI image edit failed", response.status, result.error?.message); return Response.json({ error: result.error?.message || "The image model could not create this wrap." }, { status: response.status }); }
    const output = result.data?.[0]?.b64_json;
    if (!output) return Response.json({ error: "The image model returned no artwork." }, { status: 502 });
    return Response.json({ image: output, format: result.data?.[0]?.media_type?.split("/")[1] || "png" });
  } catch (cause) { console.error("Cover generation failed", cause); return Response.json({ error: "Generation failed. Your upload was not saved; please try again." }, { status: 500 }); }
}
