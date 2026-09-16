"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  BookOpen,
  Check,
  Download,
  Eye,
  EyeOff,
  ImagePlus,
  KeyRound,
  LoaderCircle,
  Sparkles,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BookPreview3D } from "@/components/book-preview-3d";
import { IMAGE_MODELS, ModelPicker, type ImageModel } from "@/components/model-picker";

type Unit = "in" | "mm";
type Format = "wrap" | "jacket";
type CoverConfig = { width: number; height: number; spine: number; bleed: number; flap: number; dpi: number; unit: Unit; format: Format };
type JobStatus = "idle" | "queued" | "analyzing" | "generating" | "compositing" | "ready" | "error";

declare global {
  interface Document {
    modelContext?: {
      registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => void | Promise<void>;
    };
  }
}

const defaults: CoverConfig = { width: 6, height: 9, spine: 0.54, bleed: 0.125, flap: 3.25, dpi: 300, unit: "in", format: "jacket" };

const toInches = (value: number, unit: Unit) => (unit === "in" ? value : value / 25.4);
const toPx = (value: number, config: CoverConfig) => Math.round(toInches(value, config.unit) * config.dpi);
const isBusy = (status: JobStatus) => ["queued", "analyzing", "generating", "compositing"].includes(status);

const spring = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 } as const;
const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const },
};

function Hint({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="hint-tip" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function parseReviews(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((line) => {
      const [quote, attribution = ""] = line.split(/\s+[—–-]\s+/);
      return { quote: (quote || line).replace(/^["“]|["”]$/g, ""), attribution };
    });
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

function Field({ label, suffix, ...props }: React.ComponentProps<typeof Input> & { label: string; suffix: string }) {
  return (
    <div className="field-stack">
      <Label>{label}</Label>
      <div className="input-suffix">
        <Input {...props} />
        <span>{suffix}</span>
      </div>
    </div>
  );
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / image.width, h / image.height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h);
}

type Dims = {
  trimW: number;
  trimH: number;
  spineW: number;
  flapW: number;
  bleed: number;
  backX: number;
  spineX: number;
  frontX: number;
  frontFlapX: number;
  folds: number[];
  artW: number;
  totalW: number;
  totalH: number;
};

function drawPlaceholderCopy(
  ctx: CanvasRenderingContext2D,
  dims: Dims,
  copy: { title: string; author: string; blurb: string; reviews: string; isbn: string; bio: string },
) {
  const { backX, spineX, frontFlapX, flapW } = dims;
  const panelY = dims.bleed;
  const pad = Math.max(48, dims.trimW * 0.1);
  const maxCopy = dims.trimW - pad * 2;
  let y = panelY + pad;

  ctx.fillStyle = "rgba(7,13,20,.42)";
  ctx.fillRect(backX, panelY, dims.trimW, dims.trimH);
  ctx.fillStyle = "rgba(7,13,20,.18)";
  ctx.fillRect(spineX, panelY, dims.spineW, dims.trimH);
  ctx.fillStyle = "#fffdf4";
  ctx.textBaseline = "top";

  if (copy.blurb.trim() && flapW === 0) {
    const fontSize = Math.max(28, Math.round(dims.trimW * 0.038));
    ctx.font = `500 ${fontSize}px Georgia, serif`;
    wrapLines(ctx, copy.blurb.trim(), maxCopy, 7).forEach((text) => {
      ctx.fillText(text, backX + pad, y);
      y += fontSize * 1.42;
    });
    y += fontSize * 0.8;
  }

  parseReviews(copy.reviews).forEach((review) => {
    const quoteSize = Math.max(24, Math.round(dims.trimW * 0.032));
    ctx.font = `italic 500 ${quoteSize}px Georgia, serif`;
    wrapLines(ctx, `“${review.quote}”`, maxCopy, 3).forEach((text) => {
      ctx.fillText(text, backX + pad, y);
      y += quoteSize * 1.38;
    });
    if (review.attribution) {
      ctx.font = `700 ${Math.max(16, Math.round(dims.trimW * 0.02))}px Arial`;
      ctx.fillText(review.attribution.toUpperCase(), backX + pad, y + 6);
      y += quoteSize * 1.7;
    } else {
      y += quoteSize * 0.6;
    }
  });

  if (dims.spineW > 28) {
    ctx.save();
    ctx.translate(spineX + dims.spineW / 2, dims.totalH / 2);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,.45)";
    ctx.shadowBlur = Math.max(6, dims.spineW * 0.08);
    const titleSize = Math.round(Math.min(dims.spineW * 0.72, dims.trimH * 0.055));
    ctx.font = `800 ${titleSize}px Arial`;
    ctx.fillText(copy.title.toUpperCase(), 0, copy.author ? -titleSize * 0.28 : 0, dims.trimH * 0.86);
    if (copy.author) {
      ctx.font = `600 ${Math.round(titleSize * 0.42)}px Arial`;
      ctx.fillText(copy.author.toUpperCase(), 0, titleSize * 0.42, dims.trimH * 0.7);
    }
    ctx.restore();
  }

  const isbnDigits = copy.isbn.replace(/[^\dX]/gi, "");
  if (isbnDigits || copy.isbn.trim()) {
    const boxW = Math.max(220, dims.trimW * 0.28);
    const boxH = Math.max(90, dims.trimH * 0.09);
    const bx = backX + pad;
    const by = panelY + dims.trimH - pad - boxH;
    ctx.fillStyle = "#fffdf4";
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.fillStyle = "#111922";
    const barCount = Math.max(24, isbnDigits.length * 2);
    for (let i = 0; i < barCount; i++) {
      const wide = (isbnDigits.charCodeAt(i % Math.max(isbnDigits.length, 1)) || 48) % 3 === 0;
      ctx.fillRect(bx + 10 + i * ((boxW - 20) / barCount), by + 10, wide ? 3 : 1.5, boxH * 0.58);
    }
    ctx.font = `600 ${Math.max(14, Math.round(boxH * 0.16))}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(copy.isbn.trim() || isbnDigits, bx + boxW / 2, by + boxH - 10);
    ctx.textAlign = "start";
  }

  if (flapW > 40) {
    const flapPad = Math.max(28, flapW * 0.1);
    const flapSize = Math.max(18, Math.round(flapW * 0.055));
    ctx.fillStyle = "#fffdf4";
    ctx.textAlign = "start";
    ctx.textBaseline = "top";
    ctx.font = `700 ${Math.max(12, Math.round(flapSize * 0.7))}px Arial`;
    ctx.fillText(copy.author ? `ABOUT ${copy.author.toUpperCase()}` : "ABOUT THE AUTHOR", dims.bleed + flapPad, panelY + flapPad);
    ctx.font = `500 ${flapSize}px Georgia, serif`;
    wrapLines(ctx, copy.bio.trim() || "Author biography", flapW - flapPad * 2, 8).forEach((text, i) => {
      ctx.fillText(text, dims.bleed + flapPad, panelY + flapPad + flapSize * 1.4 + i * flapSize * 1.38);
    });
    ctx.font = `700 ${Math.max(12, Math.round(flapSize * 0.7))}px Arial`;
    ctx.fillText((copy.title || "FRONT FLAP").toUpperCase(), frontFlapX + flapPad, panelY + flapPad);
    ctx.font = `500 ${flapSize}px Georgia, serif`;
    wrapLines(ctx, copy.blurb.trim() || "Front-flap synopsis", flapW - flapPad * 2, 8).forEach((text, i) => {
      ctx.fillText(text, frontFlapX + flapPad, panelY + flapPad + flapSize * 1.4 + i * flapSize * 1.38);
    });
  }
}

function drawPrintMarks(ctx: CanvasRenderingContext2D, dims: Dims, dpi: number, jacket: boolean) {
  const lw = Math.max(1, Math.round(dpi / 220));
  const trimR = dims.totalW - dims.bleed;
  const trimB = dims.bleed + dims.trimH;
  const tick = Math.max(10, Math.round(dpi * 0.12));
  ctx.save();
  ctx.strokeStyle = "rgba(17,25,34,.55)";
  ctx.lineWidth = lw;
  ctx.setLineDash([]);
  for (const [x1, y1, x2, y2] of [
    [dims.bleed, 0, dims.bleed, dims.bleed],
    [trimR, 0, trimR, dims.bleed],
    [dims.bleed, trimB, dims.bleed, dims.totalH],
    [trimR, trimB, trimR, dims.totalH],
    [0, dims.bleed, dims.bleed, dims.bleed],
    [trimR, dims.bleed, dims.totalW, dims.bleed],
    [0, trimB, dims.bleed, trimB],
    [trimR, trimB, dims.totalW, trimB],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.setLineDash([Math.round(dpi * 0.045), Math.round(dpi * 0.03)]);
  ctx.strokeStyle = "rgba(17,25,34,.78)";
  ctx.font = `700 ${Math.max(11, Math.round(dpi * 0.042))}px Arial`;
  ctx.fillStyle = "rgba(17,25,34,.78)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  dims.folds.forEach((x, i) => {
    ctx.beginPath();
    ctx.moveTo(x, dims.bleed);
    ctx.lineTo(x, trimB);
    ctx.stroke();
    if (!(jacket && (i === 1 || i === 2))) {
      ctx.setLineDash([]);
      ctx.fillText("FOLD", x, dims.bleed + tick * 0.55);
      ctx.fillText("FOLD", x, trimB - tick * 0.55);
      ctx.setLineDash([Math.round(dpi * 0.045), Math.round(dpi * 0.03)]);
    }
  });
  ctx.setLineDash([10, 7]);
  ctx.strokeStyle = "rgba(17,25,34,.28)";
  ctx.strokeRect(dims.bleed, dims.bleed, dims.totalW - dims.bleed * 2, dims.trimH);
  ctx.restore();
}

function extendBleed(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  bleed: number,
  trimWidth: number,
  trimHeight: number,
) {
  if (bleed <= 0) return;
  ctx.drawImage(canvas, bleed, bleed, trimWidth, 1, bleed, 0, trimWidth, bleed);
  ctx.drawImage(canvas, bleed, bleed + trimHeight - 1, trimWidth, 1, bleed, bleed + trimHeight, trimWidth, bleed);
  ctx.drawImage(canvas, bleed, bleed, 1, trimHeight, 0, bleed, bleed, trimHeight);
  ctx.drawImage(canvas, bleed + trimWidth - 1, bleed, 1, trimHeight, bleed + trimWidth, bleed, bleed, trimHeight);
  ctx.drawImage(canvas, bleed, bleed, 1, 1, 0, 0, bleed, bleed);
  ctx.drawImage(canvas, bleed + trimWidth - 1, bleed, 1, 1, bleed + trimWidth, 0, bleed, bleed);
  ctx.drawImage(canvas, bleed, bleed + trimHeight - 1, 1, 1, 0, bleed + trimHeight, bleed, bleed);
  ctx.drawImage(canvas, bleed + trimWidth - 1, bleed + trimHeight - 1, 1, 1, bleed + trimWidth, bleed + trimHeight, bleed, bleed);
}

export default function Home() {
  const [config, setConfig] = useState<CoverConfig>(defaults);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverUrl, setCoverUrl] = useState("");
  const [generatedUrl, setGeneratedUrl] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [blurb, setBlurb] = useState("");
  const [bio, setBio] = useState("");
  const [reviews, setReviews] = useState("");
  const [isbn, setIsbn] = useState("");
  const [direction, setDirection] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState<ImageModel>(IMAGE_MODELS[0]);
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [panel, setPanel] = useState("simple");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const jacket = config.format === "jacket";
  const dims = useMemo(() => {
    const trimW = toPx(config.width, config);
    const trimH = toPx(config.height, config);
    const spineW = Math.max(1, toPx(config.spine, config));
    const bleed = toPx(config.bleed, config);
    const flapW = jacket ? Math.max(1, toPx(config.flap, config)) : 0;
    const backX = bleed + flapW;
    const spineX = backX + trimW;
    const frontX = spineX + spineW;
    const frontFlapX = frontX + trimW;
    const artW = flapW * 2 + trimW * 2 + spineW;
    return {
      trimW,
      trimH,
      spineW,
      flapW,
      bleed,
      backX,
      spineX,
      frontX,
      frontFlapX,
      folds: jacket ? [backX, spineX, frontX, frontFlapX] : [backX, spineX],
      artW,
      totalW: artW + bleed * 2,
      totalH: trimH + bleed * 2,
    };
  }, [config, jacket]);

  const innerDisplay = config.width * 2 + config.spine + (jacket ? config.flap * 2 : 0);
  const totalDisplay = innerDisplay + config.bleed * 2;
  const heightDisplay = config.height + config.bleed * 2;
  const foldPercents = (
    jacket
      ? [config.flap, config.flap + config.width, config.flap + config.width + config.spine, config.flap + config.width * 2 + config.spine]
      : [config.width, config.width + config.spine]
  ).map((value) => (value / innerDisplay) * 100);
  const ready = Boolean(coverUrl);
  const canDownload = status === "ready" && Boolean(generatedUrl);

  const updateConfig = useCallback((key: keyof CoverConfig, value: number | Unit | Format) => {
    setConfig((current) => ({ ...current, [key]: value }));
    setGeneratedUrl("");
    setStatus("idle");
  }, []);

  const applyCoverRatio = useCallback((ratio: number, unit: Unit) => {
    const height = unit === "in" ? 9 : 229;
    const width = Math.round(height * ratio * 1000) / 1000;
    setConfig((current) => ({ ...current, unit, width, height }));
  }, []);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const registration = context.registerTool(
      {
        name: "configure_book_cover",
        title: "Configure book cover",
        description: "Set trim size, spine, bleed, DPI, and units in the Bookwrap editor.",
        inputSchema: {
          type: "object",
          properties: {
            width: { type: "number", minimum: 1 },
            height: { type: "number", minimum: 1 },
            spine: { type: "number", minimum: 0.05 },
            bleed: { type: "number", minimum: 0 },
            flap: { type: "number", minimum: 0.5 },
            dpi: { type: "number", enum: [150, 300, 600] },
            unit: { type: "string", enum: ["in", "mm"] },
            format: { type: "string", enum: ["wrap", "jacket"] },
          },
          required: ["width", "height", "spine", "bleed", "dpi", "unit"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input: unknown) => {
          const next = input as CoverConfig;
          if (!next || !["in", "mm"].includes(next.unit) || ![150, 300, 600].includes(next.dpi)) {
            throw new Error("Invalid cover configuration");
          }
          setConfig(next);
          setGeneratedUrl("");
          setStatus("idle");
          return { configured: true, ...next };
        },
      },
      { signal: lifecycle.signal },
    );
    Promise.resolve(registration).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  useEffect(
    () => () => {
      if (coverUrl.startsWith("blob:")) URL.revokeObjectURL(coverUrl);
    },
    [coverUrl],
  );

  const acceptFile = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Choose a PNG, JPG, or WebP image.");
    if (file.size > 15 * 1024 * 1024) return setError("The cover image must be 15 MB or smaller.");
    if (coverUrl.startsWith("blob:")) URL.revokeObjectURL(coverUrl);
    const url = URL.createObjectURL(file);
    try {
      const image = await loadImage(url);
      applyCoverRatio(image.naturalWidth / Math.max(1, image.naturalHeight), config.unit);
      setCoverFile(file);
      setCoverUrl(url);
      setGeneratedUrl("");
      setStatus("idle");
      setError("");
    } catch {
      URL.revokeObjectURL(url);
      setError("Could not read that image. Try another file.");
    }
  };

  const generate = async () => {
    if (!coverFile) {
      setError("Upload the finished front cover first.");
      fileInput.current?.click();
      return;
    }
    if (!apiKey.trim()) {
      setStatus("error");
      setError("Add your OpenRouter API key to generate.");
      return;
    }

    setStatus("queued");
    setStatusMessage("Queued — preparing your front cover…");
    setError("");

    const form = new FormData();
    form.append("image", coverFile);
    form.append("direction", direction);
    form.append("title", title);
    form.append("author", author);
    form.append("blurb", blurb);
    form.append("bio", bio);
    form.append("reviews", reviews);
    form.append("isbn", isbn);
    form.append("apiKey", apiKey.trim());
    form.append("model", selectedModel.id);
    form.append("aspectRatios", selectedModel.aspectRatios.join(","));
    form.append("width", String(config.width));
    form.append("height", String(config.height));
    form.append("spine", String(config.spine));
    form.append("flap", String(config.flap));
    form.append("format", config.format);

    try {
      const response = await fetch("/api/generate", { method: "POST", body: form });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Generation failed. Please try again.");
      }
      if (!response.body) throw new Error("The generation stream could not be opened.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as {
            type: string;
            stage?: JobStatus;
            message?: string;
            image?: string;
            format?: string;
            error?: string;
            meta?: Partial<Record<"title" | "author" | "blurb" | "bio" | "reviews" | "isbn", string>>;
          };
          if (event.type === "status" && event.stage) {
            setStatus(event.stage);
            setStatusMessage(event.message || "");
          }
          if (event.type === "meta" && event.meta) {
            const meta = event.meta;
            setTitle((value) => value || meta.title || "");
            setAuthor((value) => value || meta.author || "");
            setBlurb((value) => value || meta.blurb || "");
            setBio((value) => value || meta.bio || "");
            setReviews((value) => value || meta.reviews || "");
            setIsbn((value) => value || meta.isbn || "");
          }
          if (event.type === "result" && event.image) {
            setStatus("compositing");
            setStatusMessage("Aligning spine and back to your front cover…");
            setGeneratedUrl(`data:image/${event.format || "png"};base64,${event.image}`);
            setStatus("ready");
            setStatusMessage(jacket ? "Jacket ready." : "Wrap ready.");
          }
          if (event.type === "error") throw new Error(event.error || "Generation failed. Please try again.");
        }
      }
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Generation failed. Please try again.");
    }
  };

  const compose = useCallback(async (marks = false) => {
    const canvas = canvasRef.current;
    if (!canvas || !coverUrl) return null;
    canvas.width = dims.totalW;
    canvas.height = dims.totalH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const front = await loadImage(coverUrl);
    const artwork = generatedUrl ? await loadImage(generatedUrl) : null;
    const { backX, frontX, artW } = dims;
    const panelY = dims.bleed;

    ctx.fillStyle = "#111922";
    ctx.fillRect(0, 0, dims.totalW, dims.totalH);

    // The model lays out flaps | back | spine | front at exact width shares, so stretch-fill
    // (not cover-crop) keeps those panels aligned with the trim geometry.
    if (artwork) ctx.drawImage(artwork, backX - dims.flapW, panelY, artW, dims.trimH);

    drawCover(ctx, front, frontX, panelY, dims.trimW, dims.trimH);

    // Generated artwork carries its own typography and barcode; canvas copy is only the
    // pre-generation placeholder.
    if (!artwork) drawPlaceholderCopy(ctx, dims, { title, author, blurb, reviews, isbn, bio });

    extendBleed(canvas, ctx, dims.bleed, artW, dims.trimH);
    if (marks) drawPrintMarks(ctx, dims, config.dpi, jacket);
    return canvas;
  }, [author, bio, blurb, config.dpi, coverUrl, dims, generatedUrl, isbn, jacket, reviews, title]);

  // Trim-only (no bleed) composite at preview resolution, so the 3D book shows the same
  // wrap that downloads produce instead of the raw model output.
  const [wrapPreviewUrl, setWrapPreviewUrl] = useState("");
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (!generatedUrl) {
        setWrapPreviewUrl("");
        return;
      }
      const source = await compose();
      if (!source || cancelled) return;
      const trimW = dims.trimW * 2 + dims.spineW;
      const scale = Math.min(1, 2400 / trimW);
      const preview = document.createElement("canvas");
      preview.width = Math.round(trimW * scale);
      preview.height = Math.round(dims.trimH * scale);
      // 3D book uses back | spine | front only — flaps stay on the print sheet.
      preview.getContext("2d")?.drawImage(source, dims.backX, dims.bleed, trimW, dims.trimH, 0, 0, preview.width, preview.height);
      if (!cancelled) setWrapPreviewUrl(preview.toDataURL("image/jpeg", 0.9));
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [compose, dims, generatedUrl]);

  const download = async (part: "wrap" | "front" | "spine" | "back") => {
    const source = await compose(true);
    if (!source) return;
    const crop = document.createElement("canvas");
    const c = crop.getContext("2d");
    if (!c) return;
    let sx = 0;
    let sw = dims.totalW;
    const sh = dims.totalH;
    if (part === "back") {
      sx = jacket ? dims.backX : 0;
      sw = jacket ? dims.trimW : dims.backX + dims.trimW;
    }
    if (part === "spine") {
      sx = dims.spineX;
      sw = dims.spineW;
    }
    if (part === "front") {
      sx = dims.frontX;
      sw = jacket ? dims.trimW : dims.trimW + dims.bleed;
    }
    crop.width = sw;
    crop.height = sh;
    c.drawImage(source, sx, 0, sw, sh, 0, 0, sw, sh);
    const link = document.createElement("a");
    link.download = `bookwrap-${part}-${config.dpi}dpi.png`;
    link.href = crop.toDataURL("image/png");
    link.click();
  };

  const reset = () => {
    if (coverUrl.startsWith("blob:")) URL.revokeObjectURL(coverUrl);
    setConfig(defaults);
    setCoverFile(null);
    setCoverUrl("");
    setGeneratedUrl("");
    setTitle("");
    setAuthor("");
    setBlurb("");
    setBio("");
    setReviews("");
    setIsbn("");
    setDirection("");
    setApiKey("");
    setSelectedModel(IMAGE_MODELS[0]);
    setStatus("idle");
    setStatusMessage("");
    setError("");
  };

  const activeStep = canDownload ? 3 : ready ? 2 : 1;
  const steps = [
    { n: 1, label: "Upload", done: ready },
    { n: 2, label: "Generate", done: canDownload },
    { n: 3, label: "Download", done: false },
  ];
  const generateLabel = isBusy(status) ? statusMessage || "Generating…" : jacket ? "Generate jacket" : "Generate wrap";

  return (
    <MotionConfig reducedMotion="user" transition={spring}>
    <TooltipProvider delayDuration={350}>
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <BookOpen />
          </span>
          <div>
            <strong>Bookwrap</strong>
            <small>{jacket ? "Print · fold · wrap" : "Front → spine → back"}</small>
          </div>
        </div>
        <nav className="step-nav" aria-label="Workflow">
          {steps.map((step) => {
            const active = step.n === activeStep;
            return (
              <span key={step.n} className={active ? "active" : step.done ? "done" : ""} aria-current={active ? "step" : undefined}>
                {active && <motion.span className="step-pill" layoutId="step-pill" transition={spring} />}
                <em>{step.done && !active ? <Check /> : step.n}</em>
                <span>{step.label}</span>
              </span>
            );
          })}
        </nav>
        <Hint label="Clear the upload, wrap, and settings">
          <motion.button className="text-btn" type="button" onClick={reset} whileTap={{ scale: 0.95 }}>
            Reset
          </motion.button>
        </Hint>
      </header>

      <section className={`hero ${ready ? "compact" : ""}`}>
        <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
          Turn a front cover into a dust jacket.
        </motion.h1>
        <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}>
          Upload your finished front. Generate flaps, spine, and back. Print the sheet, fold on the marks, and wrap the book.
        </motion.p>
      </section>

      <motion.section
        className={`workspace ${ready ? "" : "landing"}`}
        layout
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
      >
        <aside className="control-panel">
          <motion.div
            className={`dropzone ${ready ? "has-file" : ""} ${dragging ? "dragging" : ""}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDragEnter={() => setDragging(true)}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void acceptFile(event.dataTransfer.files[0]);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") fileInput.current?.click();
            }}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.985 }}
            animate={{ scale: dragging ? 1.015 : 1 }}
          >
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(event) => void acceptFile(event.target.files?.[0])}
            />
            <AnimatePresence mode="popLayout" initial={false}>
              {coverUrl ? (
                <motion.img
                  key={coverUrl}
                  src={coverUrl}
                  alt="Uploaded front cover"
                  initial={{ opacity: 0, scale: 0.8, rotate: -4 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                />
              ) : (
                <motion.div
                  key="icon"
                  className="upload-icon"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                >
                  <motion.span animate={dragging ? { y: [0, -3, 0] } : { y: 0 }} transition={dragging ? { repeat: Infinity, duration: 0.9 } : spring}>
                    <Upload />
                  </motion.span>
                </motion.div>
              )}
            </AnimatePresence>
            <div>
              <strong>{dragging ? "Release to upload" : coverFile?.name || "Drop your front cover here"}</strong>
              <span>{coverFile ? "Click to replace · proportions locked to this image" : "or click to browse · PNG, JPG, or WebP · max 15 MB"}</span>
            </div>
            <AnimatePresence>
              {ready && (
                <Hint label="Trim proportions locked to this image">
                  <motion.span
                    className="file-check"
                    initial={{ scale: 0, rotate: -30 }}
                    animate={{ scale: 1, rotate: 0 }}
                    exit={{ scale: 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 22 }}
                  >
                    <Check />
                  </motion.span>
                </Hint>
              )}
            </AnimatePresence>
          </motion.div>

          <div className="model-field">
            <Label>Image model</Label>
            <ModelPicker
              value={selectedModel}
              onChange={(model) => {
                setSelectedModel(model);
                setError("");
              }}
            />
          </div>

          <div className="field-stack api-key-field">
            <Label htmlFor="api-key">
              <KeyRound /> OpenRouter API key
            </Label>
            <div className="secret-input">
              <Input
                id="api-key"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-or-v1-…"
                maxLength={512}
                autoComplete="off"
                spellCheck={false}
              />
              <Hint label={showKey ? "Hide key" : "Show key"}>
                <motion.button
                  type="button"
                  aria-label={showKey ? "Hide API key" : "Show API key"}
                  onClick={() => setShowKey((value) => !value)}
                  whileTap={{ scale: 0.88 }}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={showKey ? "off" : "on"}
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.6 }}
                      transition={{ duration: 0.14 }}
                    >
                      {showKey ? <EyeOff /> : <Eye />}
                    </motion.span>
                  </AnimatePresence>
                </motion.button>
              </Hint>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {error && (
              <motion.div
                className="error-message"
                role="alert"
                initial={{ opacity: 0, height: 0, marginTop: -16 }}
                animate={{ opacity: 1, height: "auto", marginTop: 0 }}
                exit={{ opacity: 0, height: 0, marginTop: -16 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
                <motion.div initial={{ x: 0 }} animate={{ x: [0, -4, 4, -2, 0] }} transition={{ duration: 0.35, delay: 0.1 }}>
                  {error}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div whileTap={isBusy(status) ? undefined : { scale: 0.98 }}>
            <Button className="generate-button" onClick={() => void generate()} disabled={isBusy(status)}>
              {isBusy(status) ? <LoaderCircle className="spin" /> : <Sparkles />}
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={generateLabel} className="generate-label" {...fadeUp} transition={{ duration: 0.2 }}>
                  {generateLabel}
                </motion.span>
              </AnimatePresence>
            </Button>
          </motion.div>

          <AnimatePresence>
            {canDownload && (
              <motion.div
                className="download-row"
                initial="hidden"
                animate="show"
                exit="hidden"
                variants={{
                  hidden: { opacity: 0, height: 0 },
                  show: { opacity: 1, height: "auto", transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
                }}
              >
                {(["back", "spine", "front"] as const).map((part) => (
                  <motion.div key={part} variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }} whileTap={{ scale: 0.96 }}>
                    <Hint label={`Download the ${part} panel PNG with bleed`}>
                      <Button variant="outline" onClick={() => void download(part)}>
                        <Download /> {part[0].toUpperCase() + part.slice(1)}
                      </Button>
                    </Hint>
                  </motion.div>
                ))}
                <motion.div className="download-wrap-slot" variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }} whileTap={{ scale: 0.985 }}>
                  <Hint label={`Full ${dims.totalW.toLocaleString()} × ${dims.totalH.toLocaleString()} px print spread`}>
                    <Button className="download-wrap" onClick={() => void download("wrap")}>
                      <Download /> {jacket ? "Print jacket" : "Full wrap"}
                    </Button>
                  </Hint>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <Tabs value={panel} onValueChange={setPanel} className="options-tabs">
            <TabsList className="options-tablist">
              <TabsTrigger value="simple">Simple</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>

            <TabsContent value="simple" className="options-panel">
              <p className="simple-note">
                Dust jacket with fold marks. Trim follows your upload ({config.width.toFixed(2)} × {config.height.toFixed(2)} {config.unit}). Title, author, flap copy, reviews, and a placeholder barcode are read from your cover or drafted for you — edit any of them under Advanced.
              </p>
            </TabsContent>

            <TabsContent value="advanced" className="options-panel advanced-panel">
              <div className="unit-row">
                <Label>Format</Label>
                <Select value={config.format} onValueChange={(value) => updateConfig("format", value as Format)}>
                  <SelectTrigger className="unit-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="jacket">Dust jacket</SelectItem>
                    <SelectItem value="wrap">Paperback wrap</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="unit-row">
                <Label>Units</Label>
                <Select value={config.unit} onValueChange={(value) => updateConfig("unit", value as Unit)}>
                  <SelectTrigger className="unit-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">Inches</SelectItem>
                    <SelectItem value="mm">Millimeters</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="dimension-grid">
                <Field label="Trim width" suffix={config.unit} type="number" min="1" step="0.01" value={config.width} onChange={(event) => updateConfig("width", Number(event.target.value))} />
                <Field label="Trim height" suffix={config.unit} type="number" min="1" step="0.01" value={config.height} onChange={(event) => updateConfig("height", Number(event.target.value))} />
                <Field label="Spine" suffix={config.unit} type="number" min="0.05" step="0.01" value={config.spine} onChange={(event) => updateConfig("spine", Number(event.target.value))} />
                <Field label="Bleed" suffix={config.unit} type="number" min="0" step="0.001" value={config.bleed} onChange={(event) => updateConfig("bleed", Number(event.target.value))} />
                {jacket && <Field label="Flap" suffix={config.unit} type="number" min="0.5" step="0.05" value={config.flap} onChange={(event) => updateConfig("flap", Number(event.target.value))} />}
              </div>

              <div className="unit-row">
                <Label>Resolution</Label>
                <Select value={String(config.dpi)} onValueChange={(value) => updateConfig("dpi", Number(value))}>
                  <SelectTrigger className="unit-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="150">150 DPI</SelectItem>
                    <SelectItem value="300">300 DPI</SelectItem>
                    <SelectItem value="600">600 DPI</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="copy-grid">
                <div className="field-stack">
                  <Label>Book title</Label>
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Read from cover" />
                </div>
                <div className="field-stack">
                  <Label>Author</Label>
                  <Input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Read from cover" />
                </div>
                <div className="field-stack full">
                  <Label>{jacket ? "Front-flap synopsis" : "Back-cover copy"}</Label>
                  <Textarea value={blurb} onChange={(event) => setBlurb(event.target.value)} rows={3} placeholder="Drafted from your cover on generate" />
                </div>
                {jacket && (
                <div className="field-stack full">
                  <Label>Author bio</Label>
                  <Textarea value={bio} onChange={(event) => setBio(event.target.value)} rows={3} placeholder="Prints on the back flap" />
                </div>
                )}
                <div className="field-stack full">
                  <Label>Reviews</Label>
                  <Textarea value={reviews} onChange={(event) => setReviews(event.target.value)} rows={3} placeholder="Drafted from your cover on generate" />
                  <small className="field-hint">One quote per line, ending with — Attribution</small>
                </div>
                <div className="field-stack">
                  <Label>ISBN</Label>
                  <Input value={isbn} onChange={(event) => setIsbn(event.target.value)} placeholder="Placeholder barcode until set" />
                </div>
                <div className="field-stack full">
                  <Label>Art direction</Label>
                  <Textarea value={direction} onChange={(event) => setDirection(event.target.value)} rows={3} placeholder="Optional" />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </aside>

        {ready && (
        <motion.section
          className="preview-panel"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="preview-header">
            <div>
              <p className="eyebrow">Live preview</p>
              <h2>{jacket ? "Dust jacket" : "Cover preview"}</h2>
            </div>
            <Hint label={`${jacket ? "Flaps + back + spine + front" : "Back + spine + front"} with ${config.bleed} ${config.unit} bleed at ${config.dpi} DPI`}>
              <div className="size-readout" tabIndex={0}>
                <span>
                  {totalDisplay.toFixed(3)} × {heightDisplay.toFixed(3)} {config.unit}
                </span>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.strong
                    key={`${dims.totalW}x${dims.totalH}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2 }}
                  >
                    {dims.totalW.toLocaleString()} × {dims.totalH.toLocaleString()} px
                  </motion.strong>
                </AnimatePresence>
              </div>
            </Hint>
          </div>

          <Tabs defaultValue="book" className="preview-tabs">
            <TabsList className="preview-tab-list">
              <TabsTrigger value="book">3D book</TabsTrigger>
              <TabsTrigger value="spread">Print spread</TabsTrigger>
            </TabsList>
            <TabsContent value="book" className="preview-tab-content" asChild>
              <motion.div className="three-preview" initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
                <BookPreview3D
                  frontUrl={coverUrl}
                  wrapUrl={wrapPreviewUrl}
                  trimWidth={config.width}
                  trimHeight={config.height}
                  spineWidth={config.spine}
                />
                <AnimatePresence>
                  {isBusy(status) && (
                    <motion.div
                      className="three-job-status"
                      initial={{ opacity: 0, y: -10, scale: 0.94 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.94 }}
                    >
                      <LoaderCircle />
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.span key={statusMessage} {...fadeUp} transition={{ duration: 0.2 }}>
                          {statusMessage || "Generating your wrap…"}
                        </motion.span>
                      </AnimatePresence>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </TabsContent>
            <TabsContent value="spread" className="preview-tab-content" asChild>
              <motion.div className="flat-preview" {...fadeUp}>
              <div
                className="stage-labels"
                style={{
                  gridTemplateColumns: jacket
                    ? `${config.flap}fr ${config.width}fr ${config.spine}fr ${config.width}fr ${config.flap}fr`
                    : `${config.width}fr ${config.spine}fr ${config.width}fr`,
                }}
              >
                {jacket ? (
                  <>
                    <span>BACK FLAP</span>
                    <span>BACK</span>
                    <span>SPINE</span>
                    <span>FRONT</span>
                    <span>FRONT FLAP</span>
                  </>
                ) : (
                  <>
                    <span>BACK</span>
                    <span>SPINE</span>
                    <span>FRONT</span>
                  </>
                )}
              </div>
              <div className="stage-scroll">
                <motion.div
                  className={`cover-spread ${!ready ? "empty-spread" : ""} ${generatedUrl ? "has-art" : ""} ${jacket ? "is-jacket" : ""}`}
                  style={{
                    gridTemplateColumns: jacket
                      ? `${config.flap}fr ${config.width}fr ${config.spine}fr ${config.width}fr ${config.flap}fr`
                      : `${config.width}fr ${config.spine}fr ${config.width}fr`,
                    aspectRatio: `${innerDisplay} / ${config.height}`,
                  }}
                  layout
                >
                  {generatedUrl && <img className="wrap-art" src={generatedUrl} alt="" />}
                  {foldPercents.map((left, i) => (
                    <div key={left} className="fold-guide" style={{ left: `${left}%` }}>
                      {!(jacket && (i === 1 || i === 2)) && (
                        <>
                          <b>FOLD</b>
                          <b>FOLD</b>
                        </>
                      )}
                    </div>
                  ))}
                  {jacket && (
                  <div className="panel flap-panel">
                    {ready ? (
                      <>
                        <small>About the author</small>
                        <p>{bio || "Back flap tucks inside the cover"}</p>
                      </>
                    ) : (
                      <div className="empty-copy">
                        <strong>Back flap</strong>
                        <span>tucks inside</span>
                      </div>
                    )}
                  </div>
                  )}
                  <div className="panel back-panel">
                    {ready ? (
                      <>
                        {!jacket && <p className="back-copy">{blurb}</p>}
                        <div className="back-reviews">
                          {parseReviews(reviews).map((review) => (
                            <blockquote key={review.quote}>
                              <p>{review.quote}</p>
                              {review.attribution && <cite>{review.attribution}</cite>}
                            </blockquote>
                          ))}
                        </div>
                        {isbn && (
                          <div className="barcode">
                            <span />
                            <span />
                            <span />
                            <span />
                            <span />
                            <small>{isbn}</small>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="empty-copy">
                        <ImagePlus />
                        <strong>Spine + back</strong>
                        <span>appear after generate</span>
                      </div>
                    )}
                  </div>
                  <div className="panel spine-panel">
                    {ready ? (
                      <div className="spine-copy">
                        <strong>{title}</strong>
                        {author && <em>{author}</em>}
                      </div>
                    ) : (
                      <span>SPINE</span>
                    )}
                  </div>
                  <div className="panel front-panel">
                    {coverUrl ? (
                      <img src={coverUrl} alt="Front cover preview" />
                    ) : (
                      <div className="front-placeholder">
                        <span>FRONT</span>
                        <strong>
                          Upload
                          <br />
                          cover
                        </strong>
                      </div>
                    )}
                  </div>
                  {jacket && (
                  <div className="panel flap-panel">
                    {ready ? (
                      <>
                        <small>{title || "Front flap"}</small>
                        <p>{blurb || "Front flap tucks inside the cover"}</p>
                      </>
                    ) : (
                      <div className="empty-copy">
                        <strong>Front flap</strong>
                        <span>tucks inside</span>
                      </div>
                    )}
                  </div>
                  )}
                </motion.div>
              </div>
              </motion.div>
            </TabsContent>
          </Tabs>
        </motion.section>
        )}
      </motion.section>

      <canvas ref={canvasRef} hidden />
    </main>
    </TooltipProvider>
    </MotionConfig>
  );
}
