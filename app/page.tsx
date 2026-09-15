"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  BookOpen,
  Check,
  ChevronDown,
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
import { IMAGE_MODELS, ModelPicker, type ImageModel } from "@/components/model-picker";

type Unit = "in" | "mm";
type CoverConfig = { width: number; height: number; spine: number; bleed: number; dpi: number; unit: Unit };
type JobStatus = "idle" | "queued" | "analyzing" | "generating" | "compositing" | "ready" | "error";

declare global {
  interface Document {
    modelContext?: {
      registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => void | Promise<void>;
    };
  }
}

const defaults: CoverConfig = { width: 6, height: 9, spine: 0.54, bleed: 0.125, dpi: 300, unit: "in" };
const defaultReviews =
  `"A cartographer of impossible places." — The Atlantic\n"Quietly devastating and beautifully made." — Kirkus Reviews`;
const examples = [
  { src: "/examples/cover-ocean.svg", title: "Tidal Chart", note: "Cinematic seascape" },
  { src: "/examples/cover-forest.svg", title: "North of Pine", note: "Muted woodland" },
  { src: "/examples/cover-noir.svg", title: "Glass Meridian", note: "Minimal noir" },
] as const;

const toInches = (value: number, unit: Unit) => (unit === "in" ? value : value / 25.4);
const toPx = (value: number, config: CoverConfig) => Math.round(toInches(value, config.unit) * config.dpi);
const isBusy = (status: JobStatus) => ["queued", "analyzing", "generating", "compositing"].includes(status);

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

function drawPanelSlice(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  sx: number,
  sw: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const safeW = Math.max(1, sw);
  const scale = Math.max(dw / safeW, dh / image.height);
  const sliceW = dw / scale;
  const sliceH = dh / scale;
  ctx.drawImage(image, sx + (safeW - sliceW) / 2, (image.height - sliceH) / 2, sliceW, sliceH, dx, dy, dw, dh);
}

export default function Home() {
  const [config, setConfig] = useState<CoverConfig>(defaults);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverUrl, setCoverUrl] = useState("");
  const [coverRatio, setCoverRatio] = useState(6 / 9);
  const [generatedUrl, setGeneratedUrl] = useState("");
  const [title, setTitle] = useState("The Last Meridian");
  const [author, setAuthor] = useState("Elena Vale");
  const [blurb, setBlurb] = useState(
    "A cartographer finds a coastline that should not exist—and a route that may rewrite everything she knows about home.",
  );
  const [reviews, setReviews] = useState(defaultReviews);
  const [isbn, setIsbn] = useState("978-1-394-22180-4");
  const [direction, setDirection] = useState(
    "Continue the visual world naturally onto the spine and back. Match colors and lighting at the front edge so the wrap feels seamless.",
  );
  const [apiKey, setApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState<ImageModel>(IMAGE_MODELS[0]);
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [panel, setPanel] = useState("simple");
  const fileInput = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const dims = useMemo(() => {
    const trimW = toPx(config.width, config);
    const trimH = toPx(config.height, config);
    const spineW = Math.max(1, toPx(config.spine, config));
    const bleed = toPx(config.bleed, config);
    return {
      trimW,
      trimH,
      spineW,
      bleed,
      totalW: trimW * 2 + spineW + bleed * 2,
      totalH: trimH + bleed * 2,
    };
  }, [config]);

  const totalDisplay = config.width * 2 + config.spine + config.bleed * 2;
  const heightDisplay = config.height + config.bleed * 2;
  const ready = Boolean(coverUrl);
  const canDownload = status === "ready" && Boolean(generatedUrl);

  const updateConfig = useCallback((key: keyof CoverConfig, value: number | Unit) => {
    setConfig((current) => ({ ...current, [key]: value }));
    setGeneratedUrl("");
    setStatus("idle");
  }, []);

  const applyCoverRatio = useCallback((ratio: number, unit: Unit) => {
    const height = unit === "in" ? 9 : 229;
    const width = Math.round(height * ratio * 1000) / 1000;
    setCoverRatio(ratio);
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
            dpi: { type: "number", enum: [150, 300, 600] },
            unit: { type: "string", enum: ["in", "mm"] },
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
      setError(`Add your ${selectedModel.providerLabel} API key to generate.`);
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
    form.append("reviews", reviews);
    form.append("isbn", isbn);
    form.append("apiKey", apiKey.trim());
    form.append("model", selectedModel.id);
    form.append("width", String(config.width));
    form.append("height", String(config.height));
    form.append("spine", String(config.spine));
    form.append("unit", config.unit);
    form.append("aspect", String(coverRatio));

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
          };
          if (event.type === "status" && event.stage) {
            setStatus(event.stage);
            setStatusMessage(event.message || "");
          }
          if (event.type === "result" && event.image) {
            setStatus("compositing");
            setStatusMessage("Aligning spine and back to your front cover…");
            setGeneratedUrl(`data:image/${event.format || "png"};base64,${event.image}`);
            setStatus("ready");
            setStatusMessage("Wrap ready.");
          }
          if (event.type === "error") throw new Error(event.error || "Generation failed. Please try again.");
        }
      }
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Generation failed. Please try again.");
    }
  };

  const compose = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !coverUrl) return null;
    canvas.width = dims.totalW;
    canvas.height = dims.totalH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const front = await loadImage(coverUrl);
    const artwork = generatedUrl ? await loadImage(generatedUrl) : null;
    const backX = dims.bleed;
    const spineX = dims.bleed + dims.trimW;
    const frontX = dims.bleed + dims.trimW + dims.spineW;
    const panelY = dims.bleed;

    ctx.fillStyle = "#111922";
    ctx.fillRect(0, 0, dims.totalW, dims.totalH);

    if (artwork) {
      const artUnits = dims.trimW * 2 + dims.spineW;
      const artBackW = (artwork.width * dims.trimW) / artUnits;
      const artSpineW = (artwork.width * dims.spineW) / artUnits;
      drawPanelSlice(ctx, artwork, 0, artBackW, 0, 0, dims.bleed + dims.trimW, dims.totalH);
      drawPanelSlice(ctx, artwork, artBackW, artSpineW, spineX, 0, dims.spineW, dims.totalH);
      drawPanelSlice(
        ctx,
        artwork,
        artBackW + artSpineW,
        artwork.width - artBackW - artSpineW,
        frontX,
        0,
        dims.trimW + dims.bleed,
        dims.totalH,
      );
    }

    drawCover(ctx, front, frontX, panelY, dims.trimW, dims.trimH);

    if (!artwork) {
      ctx.fillStyle = "rgba(7,13,20,.42)";
      ctx.fillRect(backX, panelY, dims.trimW, dims.trimH);
      ctx.fillStyle = "rgba(7,13,20,.18)";
      ctx.fillRect(spineX, 0, dims.spineW, dims.totalH);
    } else {
      ctx.fillStyle = "rgba(7,13,20,.28)";
      ctx.fillRect(backX, panelY, dims.trimW, dims.trimH);
    }

    const pad = Math.max(48, dims.trimW * 0.1);
    const maxCopy = dims.trimW - pad * 2;
    let y = panelY + pad;
    ctx.fillStyle = "#fffdf4";
    ctx.textBaseline = "top";

    if (blurb.trim()) {
      const fontSize = Math.max(28, Math.round(dims.trimW * 0.038));
      ctx.font = `500 ${fontSize}px Georgia, serif`;
      wrapLines(ctx, blurb.trim(), maxCopy, 7).forEach((text) => {
        ctx.fillText(text, backX + pad, y);
        y += fontSize * 1.42;
      });
      y += fontSize * 0.8;
    }

    parseReviews(reviews).forEach((review) => {
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

    const isbnDigits = isbn.replace(/[^\dX]/gi, "");
    if (isbnDigits || isbn.trim()) {
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
      ctx.fillText(isbn.trim() || isbnDigits, bx + boxW / 2, by + boxH - 10);
      ctx.textAlign = "start";
    }

    if (dims.spineW > 28) {
      ctx.save();
      ctx.translate(spineX + dims.spineW / 2, dims.totalH / 2);
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = "#fffdf4";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,.45)";
      ctx.shadowBlur = Math.max(6, dims.spineW * 0.08);
      const titleSize = Math.round(Math.min(dims.spineW * 0.72, dims.trimH * 0.055));
      ctx.font = `800 ${titleSize}px Arial`;
      ctx.fillText(title.toUpperCase(), 0, author ? -titleSize * 0.28 : 0, dims.trimH * 0.86);
      if (author) {
        ctx.font = `600 ${Math.round(titleSize * 0.42)}px Arial`;
        ctx.fillText(author.toUpperCase(), 0, titleSize * 0.42, dims.trimH * 0.7);
      }
      ctx.restore();
    }

    ctx.strokeStyle = "rgba(0,0,0,.22)";
    ctx.lineWidth = Math.max(1, Math.round(config.dpi / 150));
    ctx.setLineDash([12, 8]);
    ctx.strokeRect(dims.bleed, dims.bleed, dims.totalW - dims.bleed * 2, dims.trimH);
    ctx.setLineDash([]);
    return canvas;
  }, [author, blurb, config.dpi, coverUrl, dims, generatedUrl, isbn, reviews, title]);

  const download = async (part: "wrap" | "front" | "spine" | "back") => {
    const source = await compose();
    if (!source) return;
    const crop = document.createElement("canvas");
    const c = crop.getContext("2d");
    if (!c) return;
    let sx = 0;
    let sw = dims.totalW;
    const sh = dims.totalH;
    if (part === "back") sw = dims.trimW + dims.bleed;
    if (part === "spine") {
      sx = dims.bleed + dims.trimW;
      sw = dims.spineW;
    }
    if (part === "front") {
      sx = dims.bleed + dims.trimW + dims.spineW;
      sw = dims.trimW + dims.bleed;
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
    setCoverRatio(6 / 9);
    setGeneratedUrl("");
    setStatus("idle");
    setStatusMessage("");
    setError("");
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <BookOpen />
          </span>
          <div>
            <strong>Bookwrap</strong>
            <small>Front → spine → back</small>
          </div>
        </div>
        <nav className="step-nav" aria-label="Workflow">
          <span className={ready ? "done" : "active"}>
            <em>1</em>
            <span>Upload</span>
          </span>
          <span className={canDownload ? "done" : isBusy(status) ? "active" : ""}>
            <em>2</em>
            <span>Generate</span>
          </span>
          <span className={canDownload ? "active" : ""}>
            <em>3</em>
            <span>Download</span>
          </span>
        </nav>
        <button className="text-btn" type="button" onClick={reset}>
          Reset
        </button>
      </header>

      <section className="hero">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          Turn a front cover into a full wrap.
        </motion.h1>
        <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.05 }}>
          Upload your finished front. Generate a matching spine and back at the same proportions. Download print-ready PNGs.
        </motion.p>
      </section>

      <section className="workspace">
        <aside className="control-panel">
          <div
            className={`dropzone ${ready ? "has-file" : ""}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void acceptFile(event.dataTransfer.files[0]);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") fileInput.current?.click();
            }}
          >
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(event) => void acceptFile(event.target.files?.[0])}
            />
            {coverUrl ? <img src={coverUrl} alt="Uploaded front cover" /> : <div className="upload-icon"><Upload /></div>}
            <div>
              <strong>{coverFile?.name || "Drop your front cover"}</strong>
              <span>{coverFile ? "Click to replace · proportions locked to this image" : "PNG, JPG, or WebP · max 15 MB"}</span>
            </div>
            {ready && <Check className="file-check" />}
          </div>

          <div className="field-stack api-key-field">
            <Label htmlFor="api-key">
              <KeyRound /> {selectedModel.providerLabel} API key
            </Label>
            <div className="secret-input">
              <Input
                id="api-key"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={selectedModel.provider === "openrouter" ? "sk-or-v1-…" : "sk-…"}
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" aria-label={showKey ? "Hide API key" : "Show API key"} onClick={() => setShowKey((value) => !value)}>
                {showKey ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </div>

          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}

          <Button className="generate-button" onClick={() => void generate()} disabled={isBusy(status)}>
            {isBusy(status) ? <LoaderCircle className="spin" /> : <Sparkles />}
            {isBusy(status) ? statusMessage || "Generating…" : "Generate wrap"}
          </Button>

          <AnimatePresence>
            {canDownload && (
              <motion.div
                className="download-row"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
              >
                <Button variant="outline" onClick={() => void download("back")}>
                  <Download /> Back
                </Button>
                <Button variant="outline" onClick={() => void download("spine")}>
                  <Download /> Spine
                </Button>
                <Button variant="outline" onClick={() => void download("front")}>
                  <Download /> Front
                </Button>
                <Button className="download-wrap" onClick={() => void download("wrap")}>
                  <Download /> Full wrap
                </Button>
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
                Trim size follows your upload ({config.width.toFixed(2)} × {config.height.toFixed(2)} {config.unit}). Open Advanced for spine, bleed, copy, and model.
              </p>
            </TabsContent>

            <TabsContent value="advanced" className="options-panel advanced-panel">
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
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} />
                </div>
                <div className="field-stack">
                  <Label>Author</Label>
                  <Input value={author} onChange={(event) => setAuthor(event.target.value)} />
                </div>
                <div className="field-stack full">
                  <Label>Back-cover copy</Label>
                  <Textarea value={blurb} onChange={(event) => setBlurb(event.target.value)} rows={3} />
                </div>
                <div className="field-stack full">
                  <Label>Reviews</Label>
                  <Textarea value={reviews} onChange={(event) => setReviews(event.target.value)} rows={3} />
                  <small className="field-hint">One quote per line, ending with — Attribution</small>
                </div>
                <div className="field-stack">
                  <Label>ISBN</Label>
                  <Input value={isbn} onChange={(event) => setIsbn(event.target.value)} />
                </div>
                <div className="field-stack full">
                  <Label>Art direction</Label>
                  <Textarea value={direction} onChange={(event) => setDirection(event.target.value)} rows={3} />
                </div>
              </div>

              <div className="advanced-model">
                <Label>Image model</Label>
                <ModelPicker
                  value={selectedModel}
                  onChange={(model) => {
                    setSelectedModel(model);
                    setApiKey("");
                    setError("");
                  }}
                />
              </div>
            </TabsContent>
          </Tabs>
        </aside>

        <section className="preview-panel">
          <div className="preview-header">
            <div>
              <p className="eyebrow">Live preview</p>
              <h2>Full wrap</h2>
            </div>
            <div className="size-readout">
              <span>
                {totalDisplay.toFixed(3)} × {heightDisplay.toFixed(3)} {config.unit}
              </span>
              <strong>
                {dims.totalW.toLocaleString()} × {dims.totalH.toLocaleString()} px
              </strong>
            </div>
          </div>

          <div className="stage">
            <div className="stage-labels">
              <span>BACK</span>
              <span>SPINE</span>
              <span>FRONT</span>
            </div>
            <div className="stage-scroll">
              <motion.div
                className={`cover-spread ${!ready ? "empty-spread" : ""} ${generatedUrl ? "has-art" : ""}`}
                style={{
                  gridTemplateColumns: `${config.width}fr ${config.spine}fr ${config.width}fr`,
                  aspectRatio: `${totalDisplay} / ${heightDisplay}`,
                }}
                layout
              >
                {generatedUrl && <img className="wrap-art" src={generatedUrl} alt="" />}
              <div className="panel back-panel">
                {ready ? (
                  <>
                    <p className="back-copy">{blurb}</p>
                    <div className="back-reviews">
                      {parseReviews(reviews).map((review) => (
                        <blockquote key={review.quote}>
                          <p>{review.quote}</p>
                          {review.attribution && <cite>{review.attribution}</cite>}
                        </blockquote>
                      ))}
                    </div>
                    <div className="barcode">
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                      <small>{isbn || "ISBN"}</small>
                    </div>
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
              <i className="bleed-line" />
              {isBusy(status) && (
                <div className="job-overlay">
                  <span className="job-orbit">
                    <LoaderCircle />
                  </span>
                  <p>
                    <small>LIVE · {selectedModel.name.toUpperCase()}</small>
                    <strong>{statusMessage || "Working…"}</strong>
                  </p>
                </div>
                )}
              </motion.div>
            </div>
          </div>
        </section>
      </section>

      <section className="examples">
        <div className="examples-header">
          <h2>Example fronts</h2>
          <p>Try the flow with a sample, or drop in your own cover.</p>
        </div>
        <div className="examples-grid">
          {examples.map((example, index) => (
            <motion.button
              key={example.src}
              type="button"
              className="example-card"
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              whileHover={{ y: -4 }}
              onClick={async () => {
                const response = await fetch(example.src);
                const blob = await response.blob();
                const file = new File([blob], `${example.title.toLowerCase().replace(/\s+/g, "-")}.svg`, {
                  type: blob.type || "image/svg+xml",
                });
                await acceptFile(file);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              <img src={example.src} alt={`${example.title} sample cover`} />
              <div>
                <strong>{example.title}</strong>
                <span>{example.note}</span>
              </div>
              <em>
                Use sample <ChevronDown />
              </em>
            </motion.button>
          ))}
        </div>
      </section>

      <canvas ref={canvasRef} hidden />
    </main>
  );
}
