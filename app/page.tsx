"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, Download, Eye, EyeOff, ImagePlus, KeyRound, LoaderCircle, Ruler, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { IMAGE_MODELS, ModelPicker, type ImageModel } from "@/components/model-picker";

type Unit = "in" | "mm";
type Format = "wrap" | "jacket";
type CoverConfig = { width: number; height: number; spine: number; bleed: number; flap: number; dpi: number; unit: Unit; format: Format };

declare global {
  interface Document {
    modelContext?: { registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => void | Promise<void> };
  }
}

const defaults: CoverConfig = { width: 6, height: 9, spine: 0.54, bleed: 0.125, flap: 3.25, dpi: 300, unit: "in", format: "jacket" };
const defaultReviews = `"A cartographer of impossible places." — The Atlantic\n"Quietly devastating and beautifully made." — Kirkus Reviews`;
const toInches = (value: number, unit: Unit) => unit === "in" ? value : value / 25.4;
const px = (value: number, config: CoverConfig) => Math.round(toInches(value, config.unit) * config.dpi);

function parseReviews(text: string) {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 3).map((line) => {
    const [quote, attribution = ""] = line.split(/\s+[—–-]\s+/);
    return { quote: (quote || line).replace(/^["“]|["”]$/g, ""), attribution };
  });
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

function Field({ label, suffix, ...props }: React.ComponentProps<typeof Input> & { label: string; suffix: string }) {
  return <div className="field-stack"><Label>{label}</Label><div className="input-suffix"><Input {...props} /><span>{suffix}</span></div></div>;
}

export default function Home() {
  const [config, setConfig] = useState<CoverConfig>(defaults);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverUrl, setCoverUrl] = useState("");
  const [generatedUrl, setGeneratedUrl] = useState("");
  const [title, setTitle] = useState("The Last Meridian");
  const [author, setAuthor] = useState("Elena Vale");
  const [blurb, setBlurb] = useState("A cartographer finds a coastline that should not exist—and a route that may rewrite everything she knows about home.");
  const [bio, setBio] = useState("Elena Vale maps coastlines that refuse to stay put. She lives between two harbors and a drafting table.");
  const [reviews, setReviews] = useState(defaultReviews);
  const [isbn, setIsbn] = useState("978-1-394-22180-4");
  const [direction, setDirection] = useState("Continue the visual world naturally onto the spine and back. Keep the mood cinematic, premium, and restrained.");
  const [apiKey, setApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState<ImageModel>(IMAGE_MODELS[0]);
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<"idle" | "queued" | "analyzing" | "generating" | "compositing" | "ready" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const jacket = config.format === "jacket";
  const dims = useMemo(() => {
    const trimW = px(config.width, config), trimH = px(config.height, config), spineW = Math.max(1, px(config.spine, config)), bleed = px(config.bleed, config);
    const flapW = jacket ? Math.max(1, px(config.flap, config)) : 0;
    const innerW = flapW * 2 + trimW * 2 + spineW;
    const backX = bleed + flapW, spineX = backX + trimW, frontX = spineX + spineW, frontFlapX = frontX + trimW;
    return { trimW, trimH, spineW, flapW, bleed, backX, spineX, frontX, frontFlapX, folds: jacket ? [backX, spineX, frontX, frontFlapX] : [backX, spineX], totalW: innerW + bleed * 2, totalH: trimH + bleed * 2 };
  }, [config, jacket]);
  const innerDisplay = config.width * 2 + config.spine + (jacket ? config.flap * 2 : 0);
  const totalDisplay = innerDisplay + config.bleed * 2;
  const heightDisplay = config.height + config.bleed * 2;
  const foldPercents = (jacket
    ? [config.flap, config.flap + config.width, config.flap + config.width + config.spine, config.flap + config.width * 2 + config.spine]
    : [config.width, config.width + config.spine]
  ).map((x) => (x / innerDisplay) * 100);

  const updateConfig = useCallback((key: keyof CoverConfig, value: number | Unit | Format) => {
    setConfig((current) => ({ ...current, [key]: value })); setGeneratedUrl(""); setStatus("idle");
  }, []);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const registration = context.registerTool({
      name: "configure_book_cover", title: "Configure book cover",
      description: "Set trim size, spine, bleed, DPI, and units in the visible Bookwrap Studio editor.",
      inputSchema: { type: "object", properties: { width: { type: "number", minimum: 1 }, height: { type: "number", minimum: 1 }, spine: { type: "number", minimum: .05 }, bleed: { type: "number", minimum: 0 }, flap: { type: "number", minimum: .5 }, dpi: { type: "number", enum: [150, 300, 600] }, unit: { type: "string", enum: ["in", "mm"] }, format: { type: "string", enum: ["wrap", "jacket"] } }, required: ["width", "height", "spine", "bleed", "dpi", "unit"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input: unknown) => {
        const next = input as CoverConfig;
        if (!next || !["in", "mm"].includes(next.unit) || ![150, 300, 600].includes(next.dpi)) throw new Error("Invalid cover configuration");
        if (next.format && next.format !== "wrap" && next.format !== "jacket") throw new Error("Invalid cover configuration");
        setConfig(next); setGeneratedUrl(""); setStatus("idle"); return { configured: true, ...next };
      },
    }, { signal: lifecycle.signal });
    Promise.resolve(registration).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  useEffect(() => () => { if (coverUrl.startsWith("blob:")) URL.revokeObjectURL(coverUrl); }, [coverUrl]);

  const acceptFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Choose a PNG, JPG, or WebP image.");
    if (file.size > 15 * 1024 * 1024) return setError("The cover image must be 15 MB or smaller.");
    if (coverUrl.startsWith("blob:")) URL.revokeObjectURL(coverUrl);
    setCoverFile(file); setCoverUrl(URL.createObjectURL(file)); setGeneratedUrl(""); setStatus("idle"); setError("");
  };

  const generate = async () => {
    if (!coverFile) { setError("Upload the finished front cover first."); fileInput.current?.click(); return; }
    setStatus("queued"); setStatusMessage("Job accepted. Preparing your reference…"); setError("");
    const form = new FormData();
    if (!apiKey.trim()) { setStatus("error"); setError(`Add your ${selectedModel.providerLabel} API key to generate the matched artwork.`); return; }
    form.append("image", coverFile); form.append("direction", direction); form.append("title", title); form.append("author", author); form.append("blurb", blurb); form.append("reviews", reviews); form.append("isbn", isbn); form.append("apiKey", apiKey.trim()); form.append("model", selectedModel.id);
    form.append("width", String(config.width)); form.append("height", String(config.height)); form.append("spine", String(config.spine)); form.append("flap", String(config.flap)); form.append("format", config.format); form.append("unit", config.unit);
    try {
      const response = await fetch("/api/generate", { method: "POST", body: form });
      if (!response.ok) { const data = await response.json() as { error?: string }; throw new Error(data.error || "Generation failed. Please try again."); }
      if (!response.body) throw new Error("The generation stream could not be opened.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) { if (!line.trim()) continue; const event = JSON.parse(line) as { type: string; stage?: typeof status; message?: string; image?: string; format?: string; error?: string };
          if (event.type === "status" && event.stage) { setStatus(event.stage); setStatusMessage(event.message || ""); }
          if (event.type === "result" && event.image) { setStatus("compositing"); setStatusMessage("Building the exact-size print canvas…"); setGeneratedUrl(`data:image/${event.format || "png"};base64,${event.image}`); setStatus("ready"); setStatusMessage("Matched artwork ready."); }
          if (event.type === "error") throw new Error(event.error || "Generation failed. Please try again.");
        }
      }
    } catch (cause) { setStatus("error"); setError(cause instanceof Error ? cause.message : "Generation failed. Please try again."); }
  };

  const compose = useCallback(async () => {
    const canvas = canvasRef.current; if (!canvas || !coverUrl) return null;
    canvas.width = dims.totalW; canvas.height = dims.totalH;
    const ctx = canvas.getContext("2d"); if (!ctx) return null;
    const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; });
    const front = await load(coverUrl), artwork = generatedUrl ? await load(generatedUrl) : front;
    const coverCrop = (image: HTMLImageElement, x: number, y: number, w: number, h: number) => { const scale = Math.max(w / image.width, h / image.height), sw = w / scale, sh = h / scale; ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h); };
    coverCrop(artwork, 0, 0, dims.totalW, dims.totalH);
    const writeBlock = (x: number, width: number, lines: { text: string; font: string }[]) => {
      const pad = Math.max(36, width * .1), maxW = width - pad * 2;
      let y = dims.bleed + pad;
      ctx.fillStyle = "rgba(7,13,20,.36)"; ctx.fillRect(x, dims.bleed, width, dims.trimH);
      ctx.fillStyle = "#fffdf4"; ctx.textBaseline = "top"; ctx.textAlign = "start";
      for (const item of lines) {
        ctx.font = item.font;
        const size = Number(item.font.match(/(\d+)px/)?.[1] || 24);
        wrapLines(ctx, item.text, maxW, 8).forEach((text) => { ctx.fillText(text, x + pad, y); y += size * 1.4; });
        y += size * .35;
      }
      return { pad, y };
    };
    const body = Math.max(24, Math.round(dims.trimW * .034));
    const quote = Math.max(20, Math.round(dims.trimW * .028));
    if (jacket && dims.flapW > 40) {
      writeBlock(dims.bleed, dims.flapW, [
        { text: author ? `ABOUT ${author.toUpperCase()}` : "ABOUT THE AUTHOR", font: `700 ${Math.max(14, Math.round(body * .7))}px Arial` },
        { text: bio.trim() || "Author biography", font: `500 ${Math.max(18, Math.round(body * .85))}px Georgia, serif` },
      ]);
      writeBlock(dims.frontFlapX, dims.flapW, [
        { text: title.toUpperCase(), font: `700 ${Math.max(16, Math.round(body * .75))}px Arial` },
        { text: blurb.trim() || "Front-flap synopsis", font: `500 ${Math.max(18, Math.round(body * .85))}px Georgia, serif` },
      ]);
    }
    ctx.fillStyle = "rgba(7,13,20,.36)"; ctx.fillRect(dims.backX, dims.bleed, dims.trimW, dims.trimH);
    const backLines: { text: string; font: string }[] = [];
    if (!jacket && blurb.trim()) backLines.push({ text: blurb.trim(), font: `500 ${body}px Georgia, serif` });
    parseReviews(reviews).forEach((review) => {
      backLines.push({ text: `“${review.quote}”`, font: `italic 500 ${quote}px Georgia, serif` });
      if (review.attribution) backLines.push({ text: review.attribution.toUpperCase(), font: `700 ${Math.max(14, Math.round(quote * .7))}px Arial` });
    });
    writeBlock(dims.backX, dims.trimW, backLines);
    const isbnDigits = isbn.replace(/[^\dX]/gi, "");
    if (isbnDigits || isbn.trim()) {
      const boxW = Math.max(200, dims.trimW * .28), boxH = Math.max(80, dims.trimH * .08);
      const bx = dims.backX + Math.max(36, dims.trimW * .1), by = dims.bleed + dims.trimH - Math.max(36, dims.trimW * .1) - boxH;
      ctx.fillStyle = "#fffdf4"; ctx.fillRect(bx, by, boxW, boxH);
      ctx.fillStyle = "#111922";
      const barCount = Math.max(24, isbnDigits.length * 2);
      for (let i = 0; i < barCount; i++) ctx.fillRect(bx + 10 + i * ((boxW - 20) / barCount), by + 10, (isbnDigits.charCodeAt(i % isbnDigits.length) || 48) % 3 === 0 ? 3 : 1.5, boxH * .58);
      ctx.font = `600 ${Math.max(14, Math.round(boxH * .16))}px Arial`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.fillText(isbn.trim() || isbnDigits, bx + boxW / 2, by + boxH - 10); ctx.textAlign = "start";
    }
    if (dims.spineW > 28) {
      ctx.save();
      ctx.translate(dims.spineX + dims.spineW / 2, dims.totalH / 2);
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = "#fffdf4"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = Math.max(6, dims.spineW * .08);
      const titleSize = Math.round(Math.min(dims.spineW * .72, dims.trimH * .055));
      ctx.font = `800 ${titleSize}px Arial`;
      ctx.fillText(title.toUpperCase(), 0, author ? -titleSize * .28 : 0, dims.trimH * .86);
      if (author) { ctx.font = `600 ${Math.round(titleSize * .42)}px Arial`; ctx.fillText(author.toUpperCase(), 0, titleSize * .42, dims.trimH * .7); }
      ctx.restore();
    }
    coverCrop(front, dims.frontX, dims.bleed, dims.trimW, dims.trimH);
    const lw = Math.max(1, Math.round(config.dpi / 220));
    ctx.save();
    ctx.strokeStyle = "rgba(17,25,34,.55)"; ctx.lineWidth = lw;
    ctx.setLineDash([]);
    const trimR = dims.totalW - dims.bleed, trimB = dims.bleed + dims.trimH, tick = Math.max(10, Math.round(config.dpi * .12));
    for (const [x1, y1, x2, y2] of [
      [dims.bleed, 0, dims.bleed, dims.bleed], [trimR, 0, trimR, dims.bleed], [dims.bleed, trimB, dims.bleed, dims.totalH], [trimR, trimB, trimR, dims.totalH],
      [0, dims.bleed, dims.bleed, dims.bleed], [trimR, dims.bleed, dims.totalW, dims.bleed], [0, trimB, dims.bleed, trimB], [trimR, trimB, dims.totalW, trimB],
    ] as const) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
    ctx.setLineDash([Math.round(config.dpi * .045), Math.round(config.dpi * .03)]);
    ctx.strokeStyle = "rgba(17,25,34,.78)";
    ctx.font = `700 ${Math.max(11, Math.round(config.dpi * .042))}px Arial`;
    ctx.fillStyle = "rgba(17,25,34,.78)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const x of dims.folds) {
      ctx.beginPath(); ctx.moveTo(x, dims.bleed); ctx.lineTo(x, trimB); ctx.stroke();
      ctx.setLineDash([]); ctx.fillText("FOLD", x, dims.bleed + tick * .55); ctx.fillText("FOLD", x, trimB - tick * .55); ctx.setLineDash([Math.round(config.dpi * .045), Math.round(config.dpi * .03)]);
    }
    ctx.setLineDash([10, 7]); ctx.strokeStyle = "rgba(17,25,34,.28)";
    ctx.strokeRect(dims.bleed, dims.bleed, dims.totalW - dims.bleed * 2, dims.trimH);
    ctx.restore();
    return canvas;
  }, [author, bio, blurb, config.dpi, coverUrl, dims, generatedUrl, isbn, jacket, reviews, title]);

  const download = async (part: "wrap" | "front" | "spine" | "back") => {
    const source = await compose(); if (!source) return;
    const crop = document.createElement("canvas"), c = crop.getContext("2d"); if (!c) return;
    let sx = 0, sw = dims.totalW; const sh = dims.totalH;
    if (part === "back") { sx = jacket ? dims.backX : 0; sw = jacket ? dims.trimW : dims.backX + dims.trimW; }
    if (part === "spine") { sx = dims.spineX; sw = dims.spineW; }
    if (part === "front") { sx = dims.frontX; sw = jacket ? dims.trimW : dims.trimW + dims.bleed; }
    crop.width = sw; crop.height = sh; c.drawImage(source, sx, 0, sw, sh, 0, 0, sw, sh);
    const link = document.createElement("a"); link.download = `bookwrap-${part}-${config.dpi}dpi.png`; link.href = crop.toDataURL("image/png"); link.click();
  };

  const ready = Boolean(coverUrl);
  return <main className="app-shell">
    <header className="topbar"><div className="brand-lockup"><div className="brand-mark"><BookOpen /></div><div><strong>BOOKWRAP</strong><span>studio</span></div></div><div className="precision-pill"><span /> Print precision workspace</div><button className="text-button" onClick={() => setConfig(defaults)}>Reset</button></header>
    <section className="workspace">
      <aside className="control-panel">
        <div className="panel-intro"><p className="eyebrow">01 / Source</p><h1>Build the rest of your cover.</h1><p>Upload your finished front. AI extends it across the jacket — flaps, spine, and back — ready to print, fold, and wrap.</p></div>
        <div className={`dropzone ${ready ? "has-file" : ""}`} onClick={() => fileInput.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); acceptFile(e.dataTransfer.files[0]); }} role="button" tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => acceptFile(e.target.files?.[0])} />
          {coverUrl ? <img src={coverUrl} alt="Uploaded front cover" /> : <div className="upload-icon"><Upload /></div>}
          <div><strong>{coverFile?.name || "Drop your front cover"}</strong><span>{coverFile ? "Click to replace" : "PNG, JPG or WebP · max 15 MB"}</span></div>{ready && <Check className="file-check" />}
        </div>
        <div className="section-rule"><span>02 / Print size</span><Ruler /></div>
        <div className="unit-row"><Label>Format</Label><Select value={config.format} onValueChange={(v) => updateConfig("format", v as Format)}><SelectTrigger className="unit-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="jacket">Dust jacket</SelectItem><SelectItem value="wrap">Cover wrap</SelectItem></SelectContent></Select></div>
        <div className="unit-row"><Label>Units</Label><Select value={config.unit} onValueChange={(v) => updateConfig("unit", v as Unit)}><SelectTrigger className="unit-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="in">Inches</SelectItem><SelectItem value="mm">Millimeters</SelectItem></SelectContent></Select></div>
        <div className="dimension-grid">
          <Field label="Trim width" suffix={config.unit} type="number" min="1" step="0.01" value={config.width} onChange={(e) => updateConfig("width", Number(e.target.value))} />
          <Field label="Trim height" suffix={config.unit} type="number" min="1" step="0.01" value={config.height} onChange={(e) => updateConfig("height", Number(e.target.value))} />
          <Field label="Spine" suffix={config.unit} type="number" min="0.05" step="0.01" value={config.spine} onChange={(e) => updateConfig("spine", Number(e.target.value))} />
          <Field label="Bleed" suffix={config.unit} type="number" min="0" step="0.001" value={config.bleed} onChange={(e) => updateConfig("bleed", Number(e.target.value))} />
          {jacket && <Field label="Flap" suffix={config.unit} type="number" min="0.5" step="0.05" value={config.flap} onChange={(e) => updateConfig("flap", Number(e.target.value))} />}
        </div>
        <div className="unit-row dpi-row"><Label>Resolution</Label><Select value={String(config.dpi)} onValueChange={(v) => updateConfig("dpi", Number(v))}><SelectTrigger className="unit-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="150">150 DPI</SelectItem><SelectItem value="300">300 DPI</SelectItem><SelectItem value="600">600 DPI</SelectItem></SelectContent></Select></div>
        <div className="section-rule"><span>03 / Cover copy</span><ImagePlus /></div>
        <div className="copy-grid"><div className="field-stack"><Label>Book title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div><div className="field-stack"><Label>Author</Label><Input value={author} onChange={(e) => setAuthor(e.target.value)} /></div><div className="field-stack full"><Label>{jacket ? "Front-flap synopsis" : "Back-cover copy"}</Label><Textarea value={blurb} onChange={(e) => setBlurb(e.target.value)} rows={3} /></div>{jacket && <div className="field-stack full"><Label>Author bio</Label><Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} /><small className="field-hint">Prints on the back flap</small></div>}<div className="field-stack full"><Label>Reviews</Label><Textarea value={reviews} onChange={(e) => setReviews(e.target.value)} rows={3} /><small className="field-hint">One quote per line, ending with — Attribution</small></div><div className="field-stack"><Label>ISBN</Label><Input value={isbn} onChange={(e) => setIsbn(e.target.value)} /></div><div className="field-stack full"><Label>Art direction</Label><Textarea value={direction} onChange={(e) => setDirection(e.target.value)} rows={3} /></div></div>
        <div className="section-rule key-rule"><span>04 / Image model</span><KeyRound /></div>
        <ModelPicker value={selectedModel} onChange={(model) => { setSelectedModel(model); setApiKey(""); setError(""); }} />
        <div className="field-stack api-key-field"><Label htmlFor="api-key">{selectedModel.providerLabel} API key</Label><div className="secret-input"><Input id="api-key" type={showKey ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={selectedModel.provider === "openrouter" ? "sk-or-v1-…" : "sk-…"} autoComplete="off" spellCheck={false} /><button type="button" aria-label={showKey ? "Hide API key" : "Show API key"} onClick={() => setShowKey((shown) => !shown)}>{showKey ? <EyeOff /> : <Eye />}</button></div><small>Used for this live job only. Never queued or saved.</small></div>
        {error && <div className="error-message" role="alert">{error}</div>}
        <Button className="generate-button" onClick={generate} disabled={["queued","analyzing","generating","compositing"].includes(status)}>{["queued","analyzing","generating","compositing"].includes(status) ? <LoaderCircle className="spin" /> : <Sparkles />}{["queued","analyzing","generating","compositing"].includes(status) ? "Generation in progress…" : "Generate matched wrap"}</Button>
      </aside>
      <section className="preview-panel">
        <div className="preview-header"><div><p className="eyebrow">Live production preview</p><h2>{jacket ? "Dust jacket" : "Full cover spread"}</h2></div><div className="size-readout"><span>{totalDisplay.toFixed(3)} × {heightDisplay.toFixed(3)} {config.unit}</span><strong>{dims.totalW.toLocaleString()} × {dims.totalH.toLocaleString()} px</strong></div></div>
        <div className="stage"><div className="stage-labels" style={{ gridTemplateColumns: jacket ? `${config.flap}fr ${config.width}fr ${config.spine}fr ${config.width}fr ${config.flap}fr` : `${config.width}fr ${config.spine}fr ${config.width}fr` }}>{jacket ? <><span>BACK FLAP</span><span>BACK</span><span>SPINE</span><span>FRONT</span><span className="label-end">FRONT FLAP</span></> : <><span>BACK</span><span>SPINE</span><span className="label-end">FRONT</span></>}</div><div className={`cover-spread ${!ready ? "empty-spread" : ""} ${generatedUrl ? "has-art" : ""} ${jacket ? "is-jacket" : ""}`} style={{ gridTemplateColumns: jacket ? `${config.flap}fr ${config.width}fr ${config.spine}fr ${config.width}fr ${config.flap}fr` : `${config.width}fr ${config.spine}fr ${config.width}fr`, aspectRatio: `${innerDisplay} / ${config.height}` }}>
          {generatedUrl && <img className="wrap-art" src={generatedUrl} alt="" />}
          {jacket && <div className="panel flap-panel">{ready ? <><small>About the author</small><p>{bio}</p></> : <div className="empty-copy"><strong>Back flap</strong><span>tucks inside the cover</span></div>}</div>}
          <div className="panel back-panel">{ready ? <>{!jacket && <p className="back-copy">{blurb}</p>}<div className="back-reviews">{parseReviews(reviews).map((review) => <blockquote key={review.quote}><p>{review.quote}</p>{review.attribution && <cite>{review.attribution}</cite>}</blockquote>)}</div><div className="barcode"><span /><span /><span /><span /><span /><small>{isbn || "ISBN"}</small></div></> : <div className="empty-copy"><ImagePlus /><strong>Your matched artwork</strong><span>will continue here</span></div>}</div>
          <div className="panel spine-panel">{ready ? <div className="spine-copy"><strong>{title}</strong>{author && <em>{author}</em>}</div> : <span>SPINE</span>}</div>
          <div className="panel front-panel">{coverUrl ? <img src={coverUrl} alt="Front cover preview" /> : <div className="front-placeholder"><span>FRONT</span><strong>Upload<br />cover</strong><small>to begin</small></div>}</div>
          {jacket && <div className="panel flap-panel">{ready ? <><small>{title}</small><p>{blurb}</p></> : <div className="empty-copy"><strong>Front flap</strong><span>tucks inside the cover</span></div>}</div>}
          {foldPercents.map((left, i) => <i key={left} className="fold-guide" style={{ left: `${left}%` }}>{!(jacket && (i === 1 || i === 2)) && <><b>FOLD</b><b>FOLD</b></>}</i>)}
          <i className="bleed-line" />
          {["queued","analyzing","generating","compositing"].includes(status) && <div className="job-overlay"><span className="job-orbit"><LoaderCircle /></span><p><small>LIVE JOB · {selectedModel.name.toUpperCase()}</small><strong>{statusMessage || "Preparing generation…"}</strong><em>Keep this tab open — your key stays in memory only.</em></p></div>}
        </div><div className="dimension-line"><span /><strong>{totalDisplay.toFixed(3)} {config.unit} · cut outer edge · fold dashed lines</strong><span /></div></div>
        <div className="quality-strip"><div><span className="quality-icon">300</span><p><strong>Print resolution</strong><small>{config.dpi} DPI export</small></p></div><div><span className="quality-icon">↔</span><p><strong>{jacket ? "Dust jacket" : "Exact geometry"}</strong><small>{jacket ? "Flaps, folds & bleed marks" : "Trim, spine & bleed guides"}</small></p></div><div><span className="quality-icon">AI</span><p><strong>Style matched</strong><small>{generatedUrl ? "Artwork generated" : "Ready after upload"}</small></p></div></div>
        <div className="export-bar"><div><p className="eyebrow">Production export</p><strong>{status === "ready" ? (jacket ? "Print, fold on the marks, and wrap the book." : "Your wrap is ready for preflight.") : "Generate artwork, then export exact-size PNGs."}</strong></div><div className="export-actions"><Button variant="outline" onClick={() => download("front")} disabled={!ready}><Download /> Front</Button><Button variant="outline" onClick={() => download("spine")} disabled={status !== "ready"}><Download /> Spine</Button><Button variant="outline" onClick={() => download("back")} disabled={status !== "ready"}><Download /> Back</Button><Button className="download-wrap" onClick={() => download("wrap")} disabled={status !== "ready"}><Download /> {jacket ? "Print jacket" : "Full wrap"}</Button></div></div>
      </section>
    </section><canvas ref={canvasRef} hidden />
  </main>;
}
