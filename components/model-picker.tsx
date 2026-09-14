"use client";

import { useState } from "react";
import { Atom, Check, ChevronDown, Focus, Gauge, Route, Sparkles, Waves, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export type ImageModel = {
  id: string;
  provider: "openai" | "openrouter";
  name: string;
  providerLabel: string;
  description: string;
  badge: string;
  speed: "Fast" | "Balanced" | "Patient";
  icon: "openai" | "router" | "seedream";
};

export const IMAGE_MODELS: ImageModel[] = [
  { id: "gpt-image-2.5-sunburst", provider: "openai", name: "Sunburst", providerLabel: "OpenAI", description: "Highest-fidelity reference matching for finished covers.", badge: "Recommended", speed: "Patient", icon: "openai" },
  { id: "gpt-image-2.5-flare", provider: "openai", name: "Flare", providerLabel: "OpenAI", description: "Fast, high-quality extensions for quick iterations.", badge: "Fast", speed: "Fast", icon: "openai" },
  { id: "openai/gpt-image-2", provider: "openrouter", name: "GPT Image 2", providerLabel: "OpenRouter", description: "Flexible high-fidelity editing routed through OpenRouter.", badge: "Precise", speed: "Balanced", icon: "router" },
  { id: "bytedance-seed/seedream-4.5", provider: "openrouter", name: "Seedream 4.5", providerLabel: "OpenRouter", description: "Strong visual continuity with cinematic art direction.", badge: "Creative", speed: "Balanced", icon: "seedream" },
];

function ModelIcon({ kind, compact = false }: { kind: ImageModel["icon"]; compact?: boolean }) {
  const Icon = kind === "openai" ? Atom : kind === "router" ? Route : Waves;
  return <span className={`model-icon model-icon-${kind} ${compact ? "compact" : ""}`}><Icon /></span>;
}

export function ModelPicker({ value, onChange }: { value: ImageModel; onChange: (model: ImageModel) => void }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <button className="model-trigger" type="button" aria-label="Choose image model">
        <ModelIcon kind={value.icon} compact />
        <span className="model-trigger-copy"><strong>{value.name}</strong><small>{value.providerLabel} · {value.badge}</small></span>
        <ChevronDown className="model-chevron" />
      </button>
    </DialogTrigger>
    <DialogContent className="model-dialog sm:max-w-2xl">
      <DialogHeader><div className="dialog-kicker"><Sparkles /> Image model</div><DialogTitle>Choose how to extend your cover</DialogTitle><DialogDescription>Every model receives the uploaded front as a visual reference. Your key is used only for the selected provider.</DialogDescription></DialogHeader>
      <div className="model-groups">
        {(["openai", "openrouter"] as const).map((provider) => <section key={provider} className="model-group">
          <div className="model-group-title"><span>{provider === "openai" ? "Direct" : "Router"}</span><strong>{provider === "openai" ? "OpenAI" : "OpenRouter"}</strong><small>{provider === "openai" ? "Native image edit endpoint" : "One key, multiple image labs"}</small></div>
          <div className="model-list">{IMAGE_MODELS.filter((model) => model.provider === provider).map((model) => {
            const active = model.id === value.id;
            return <button key={model.id} type="button" className={`model-option ${active ? "selected" : ""}`} onClick={() => { onChange(model); setOpen(false); }}>
              <ModelIcon kind={model.icon} />
              <span className="model-option-copy"><span className="model-name-row"><strong>{model.name}</strong><em>{model.badge}</em></span><small>{model.description}</small><span className="model-stats"><span>{model.speed === "Fast" ? <Zap /> : model.speed === "Patient" ? <Focus /> : <Gauge />}{model.speed}</span><span>Reference image</span></span></span>
              <span className="model-check">{active && <Check />}</span>
            </button>;
          })}</div>
        </section>)}
      </div>
      <p className="model-footnote">Model availability and charges depend on your provider account.</p>
    </DialogContent>
  </Dialog>;
}
