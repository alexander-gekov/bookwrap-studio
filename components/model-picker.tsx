"use client";

import { useEffect, useMemo, useState } from "react";
import { Atom, Check, ChevronDown, ImageIcon, Route, Search, Sparkles, Waves } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type ImageModel = {
  id: string;
  name: string;
  description: string;
  badge: string;
  icon: "google" | "openai" | "router" | "seedream";
  aspectRatios: string[];
};

export const IMAGE_MODELS: ImageModel[] = [
  { id: "google/gemini-3.1-flash-image", name: "Nano Banana 2", description: "Fast Gemini image generation and editing.", badge: "Gemini", icon: "google", aspectRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"] },
  { id: "bytedance-seed/seedream-5-0-pro", name: "Seedream 5.0 Pro", description: "High-fidelity visual generation and editing.", badge: "Seedream", icon: "seedream", aspectRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"] },
  { id: "openai/gpt-image-2.5-sunburst", name: "GPT Image 2.5 Sunburst", description: "Precision-oriented image generation and editing.", badge: "GPT Image", icon: "openai", aspectRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"] },
  { id: "openai/gpt-image-2.5-flare", name: "GPT Image 2.5 Flare", description: "Fast image generation for quick iterations.", badge: "GPT Image", icon: "openai", aspectRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"] },
];

function parseModel(value: unknown): ImageModel | null {
  if (!value || typeof value !== "object") return null;
  const model = value as Record<string, unknown>;
  if (typeof model.id !== "string" || typeof model.name !== "string") return null;

  const architecture = model.architecture;
  if (!architecture || typeof architecture !== "object") return null;
  const inputs = (architecture as Record<string, unknown>).input_modalities;
  if (!Array.isArray(inputs) || !inputs.includes("image")) return null;

  const id = model.id;
  const description = typeof model.description === "string" ? model.description : "Image generation and editing through OpenRouter.";
  const supportedParameters =
    model.supported_parameters && typeof model.supported_parameters === "object"
      ? (model.supported_parameters as Record<string, unknown>)
      : {};
  const aspectRatio = supportedParameters.aspect_ratio;
  const aspectRatioValues =
    aspectRatio && typeof aspectRatio === "object"
      ? (aspectRatio as Record<string, unknown>).values
      : undefined;
  const aspectRatios = Array.isArray(aspectRatioValues)
    ? aspectRatioValues.filter((value): value is string => typeof value === "string")
    : [];
  const icon = id.startsWith("google/")
    ? "google"
    : id.startsWith("openai/")
      ? "openai"
      : id.startsWith("bytedance-seed/")
        ? "seedream"
        : "router";
  const badge =
    icon === "google"
      ? "Gemini"
      : icon === "openai"
        ? "GPT Image"
        : icon === "seedream"
          ? "Seedream"
          : id.split("/")[0] || "OpenRouter";

  return {
    id,
    name: model.name.replace(/^[^:]+:\s*/, ""),
    description,
    badge,
    icon,
    aspectRatios,
  };
}

function modelPriority(model: ImageModel) {
  if (model.id.includes("gemini-3.1-flash-image")) return 0;
  if (model.id.includes("seedream-5-0")) return 1;
  if (model.id.includes("gpt-image-2.5")) return 2;
  if (model.id.includes("gemini") || model.id.includes("seedream") || model.id.includes("gpt-image")) return 3;
  return 4;
}

function ModelIcon({ kind, compact = false }: { kind: ImageModel["icon"]; compact?: boolean }) {
  const Icon = kind === "openai" ? Atom : kind === "seedream" ? Waves : kind === "google" ? Sparkles : Route;
  return <span className={`model-icon model-icon-${kind} ${compact ? "compact" : ""}`}><Icon /></span>;
}

export function ModelPicker({ value, onChange }: { value: ImageModel; onChange: (model: ImageModel) => void }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ImageModel[]>(IMAGE_MODELS);
  const [query, setQuery] = useState("");
  const [catalogError, setCatalogError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("https://openrouter.ai/api/v1/images/models", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Catalog unavailable");
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object") throw new Error("Invalid catalog");
        const data = (payload as Record<string, unknown>).data;
        if (!Array.isArray(data)) throw new Error("Invalid catalog");
        const available = data
          .map(parseModel)
          .filter((model): model is ImageModel => model !== null)
          .sort((a, b) => modelPriority(a) - modelPriority(b) || a.name.localeCompare(b.name));
        if (available.length === 0) throw new Error("No image-editing models found");
        setModels(available);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCatalogError("Showing popular models; the live catalog could not be loaded.");
      });
    return () => controller.abort();
  }, []);

  const filteredModels = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return models;
    return models.filter((model) => `${model.name} ${model.badge} ${model.id}`.toLowerCase().includes(search));
  }, [models, query]);

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <button className="model-trigger" type="button" aria-label="Choose image model">
        <ModelIcon kind={value.icon} compact />
        <span className="model-trigger-copy"><strong>{value.name}</strong><small>OpenRouter · {value.badge}</small></span>
        <ChevronDown className="model-chevron" />
      </button>
    </DialogTrigger>
    <DialogContent className="model-dialog sm:max-w-2xl">
      <DialogHeader><div className="dialog-kicker"><Sparkles /> OpenRouter image model</div><DialogTitle>Choose how to extend your cover</DialogTitle><DialogDescription>Live models that accept an image reference. One OpenRouter key works with every option.</DialogDescription></DialogHeader>
      <div className="model-search">
        <Search />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Nano Banana, Seedream, GPT Image…" />
      </div>
      <div className="model-groups">
        <section className="model-group">
          <div className="model-group-title"><span>Live</span><strong>OpenRouter</strong><small>{filteredModels.length} image-editing models</small></div>
          <div className="model-list">{filteredModels.map((model) => {
            const active = model.id === value.id;
            return <button key={model.id} type="button" className={`model-option ${active ? "selected" : ""}`} onClick={() => { onChange(model); setOpen(false); }}>
              <ModelIcon kind={model.icon} />
              <span className="model-option-copy"><span className="model-name-row"><strong>{model.name}</strong><em>{model.badge}</em></span><small>{model.description}</small></span>
              <span className="model-check">{active && <Check />}</span>
            </button>;
          })}{filteredModels.length === 0 && <p className="model-empty"><ImageIcon /> No matching image models.</p>}</div>
        </section>
      </div>
      <p className="model-footnote">{catalogError || "Availability and charges depend on your OpenRouter account."}</p>
    </DialogContent>
  </Dialog>;
}
