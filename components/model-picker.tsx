"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Check, ChevronDown, ChevronRight, ImageIcon, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type ImageModel = {
  id: string;
  name: string;
  description: string;
  badge: string;
  providerId: string;
  providerName: string;
  aspectRatios: string[];
};

export const IMAGE_MODELS: ImageModel[] = [
  { id: "google/gemini-3.1-flash-image", name: "Nano Banana 2", description: "Fast Gemini image generation and editing.", badge: "Gemini", providerId: "google", providerName: "Google", aspectRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"] },
  { id: "bytedance-seed/seedream-5-0-pro", name: "Seedream 5.0 Pro", description: "High-fidelity visual generation and editing.", badge: "Seedream", providerId: "bytedance-seed", providerName: "ByteDance Seed", aspectRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"] },
  { id: "openai/gpt-image-2.5-sunburst", name: "GPT Image 2.5 Sunburst", description: "Precision-oriented image generation and editing.", badge: "GPT Image", providerId: "openai", providerName: "OpenAI", aspectRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"] },
  { id: "openai/gpt-image-2.5-flare", name: "GPT Image 2.5 Flare", description: "Fast image generation for quick iterations.", badge: "GPT Image", providerId: "openai", providerName: "OpenAI", aspectRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"] },
];

const PROVIDER_LOGOS: Record<string, string> = {
  "black-forest-labs": "flux",
  "bytedance-seed": "bytedance-color",
  google: "google-color",
  krea: "krea",
  meta: "meta-color",
  microsoft: "microsoft-color",
  openai: "openai",
  qwen: "qwen-color",
  recraft: "recraft",
  "x-ai": "xai",
};

function parseModel(value: unknown): ImageModel | null {
  if (!value || typeof value !== "object") return null;
  const model = value as Record<string, unknown>;
  if (typeof model.id !== "string" || typeof model.name !== "string") return null;

  const architecture = model.architecture;
  if (!architecture || typeof architecture !== "object") return null;
  const inputs = (architecture as Record<string, unknown>).input_modalities;
  if (!Array.isArray(inputs) || !inputs.includes("image")) return null;

  const id = model.id;
  const [providerId = "openrouter"] = id.split("/");
  const providerPrefix = model.name.match(/^([^:]+):\s*/)?.[1];
  const providerName = providerPrefix || providerId.replaceAll("-", " ");
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
  const badge = providerId === "google" ? "Gemini" : providerId === "openai" ? "GPT Image" : providerId === "bytedance-seed" ? "Seedream" : providerName;

  return {
    id,
    name: model.name.replace(/^[^:]+:\s*/, ""),
    description,
    badge,
    providerId,
    providerName,
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

function ProviderLogo({ providerId, providerName, compact = false }: { providerId: string; providerName: string; compact?: boolean }) {
  const slug = PROVIDER_LOGOS[providerId];
  const style = slug
    ? ({ "--provider-logo": `url("https://unpkg.com/@lobehub/icons-static-svg@1.95.0/icons/${slug}.svg")` } as CSSProperties)
    : undefined;
  return <span className={`provider-logo ${compact ? "compact" : ""} ${slug ? "has-logo" : ""}`} style={style}>{providerName.slice(0, 1).toUpperCase()}</span>;
}

export function ModelPicker({ value, onChange }: { value: ImageModel; onChange: (model: ImageModel) => void }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ImageModel[]>(IMAGE_MODELS);
  const [query, setQuery] = useState("");
  const [selectedProvider, setSelectedProvider] = useState(value.providerId);
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
    return models.filter((model) => `${model.name} ${model.providerName} ${model.id}`.toLowerCase().includes(search));
  }, [models, query]);

  const providers = useMemo(() => {
    const grouped = new Map<string, { id: string; name: string; count: number }>();
    filteredModels.forEach((model) => {
      const provider = grouped.get(model.providerId);
      grouped.set(model.providerId, {
        id: model.providerId,
        name: model.providerName,
        count: (provider?.count || 0) + 1,
      });
    });
    return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredModels]);
  const activeProvider = providers.some((provider) => provider.id === selectedProvider)
    ? selectedProvider
    : providers[0]?.id;
  const visibleModels = filteredModels.filter((model) => model.providerId === activeProvider);

  return <Popover open={open} onOpenChange={(nextOpen) => {
    setOpen(nextOpen);
    if (nextOpen) setSelectedProvider(value.providerId);
  }}>
    <PopoverTrigger asChild>
      <button className="model-trigger" type="button" aria-label="Choose image model">
        <ProviderLogo providerId={value.providerId} providerName={value.providerName} compact />
        <span className="model-trigger-copy"><strong>{value.name}</strong><small>{value.providerName} via OpenRouter</small></span>
        <ChevronDown className="model-chevron" />
      </button>
    </PopoverTrigger>
    <PopoverContent className="model-popover" align="start" sideOffset={8}>
      <div className="model-search">
        <Search />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Nano Banana, Seedream, GPT Image…" />
      </div>
      <div className="model-menu">
        <div className="provider-list">
          {providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className={provider.id === activeProvider ? "active" : ""}
              onClick={() => setSelectedProvider(provider.id)}
              onPointerEnter={() => setSelectedProvider(provider.id)}
            >
              <ProviderLogo providerId={provider.id} providerName={provider.name} compact />
              <span>{provider.name}</span>
              <small>{provider.count}</small>
              <ChevronRight />
            </button>
          ))}
        </div>
        <div className="model-list">
          <div className="model-list-heading">
            <span>Models</span>
            <small>{visibleModels.length} image editors</small>
          </div>
          {visibleModels.map((model) => {
            const active = model.id === value.id;
            return <motion.button
              key={model.id}
              type="button"
              className={`model-option ${active ? "selected" : ""}`}
              onClick={() => { onChange(model); setOpen(false); }}
              whileTap={{ scale: 0.98 }}
            >
              <ProviderLogo providerId={model.providerId} providerName={model.providerName} compact />
              <span className="model-option-copy"><strong>{model.name}</strong><small>{model.description}</small></span>
              <span className="model-check">
                {active && <motion.span initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 500, damping: 22 }}><Check /></motion.span>}
              </span>
            </motion.button>;
          })}
          {visibleModels.length === 0 && <p className="model-empty"><ImageIcon /> No matching image models.</p>}
        </div>
      </div>
      <p className="model-footnote">{catalogError || "Availability and charges depend on your OpenRouter account."}</p>
    </PopoverContent>
  </Popover>;
}
