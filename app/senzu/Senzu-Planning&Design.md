# Senzu — Planning & Design Document

## Overview
A local-first image enhancement, upscaling, and generation web UI. Standalone Pinokio app (spun out from Z-Fusion). Named after the Dragon Ball Z Senzu beans (restoration theme).

## Architecture

```
Senzu/
├── pinokio.js              # Pinokio launcher UI — routes to install/start/reset/update
├── start_senzu.js          # Launch: ComfyUI → npm install → Express server (port 4242)
├── install.js              # Clone ComfyUI + custom nodes + pip deps + fs.link (Pinokio Drive)
├── reset.js / update.js    # Reset dependencies / pull latest
├── torch.js                # PyTorch + FlashAttention + Triton + SageAttention installer
└── app/
    ├── public/             # Frontend SPA (Alpine.js 3.14.8, self-hosted assets)
    │   ├── index.html      # Single-page app — Enhancer, Generate, Presets, Prompts, Models, Settings tabs
    │   ├── css/senzu.css   # 4 themes via CSS custom properties + responsive media queries
    │   ├── js/
    │   │   ├── app.js      # Alpine data component — all UI logic
    │   │   ├── api.js      # Fetch wrapper for backend API
    │   │   └── alpine.min.js
    │   └── img/            # Theme images (dragonball.png)
    ├── server/
    │   ├── index.js             # Express (127.0.0.1:4242) — all API routes
    │   ├── comfyui.js           # ComfyUI HTTP bridge (queue, history, download, text extraction)
    │   ├── workflowMap.js       # Param → ComfyUI node ID mappings (edit, upscale, krea2_t2i, prompt_enhancer)
    │   ├── presets.js           # Enhancer presets CRUD
    │   ├── prompts.js           # Prompt template library CRUD
    │   ├── model-packs.js       # Named model packs with category system (edit/generate)
    │   ├── settings.js          # App settings (save folder, autosave, theme, default_model_pack)
    │   ├── system-stats.js      # GPU/RAM monitoring via nvidia-smi
    │   ├── enhancer-prompts.js  # Prompt enhancer system prompts CRUD
    │   ├── gen-presets.js       # Generate tab presets CRUD
    │   └── gen-enhancer-prompts.js # Generate-specific enhancer prompts CRUD
    ├── workflows/
    │   ├── senzu_edit.json         # Klein 9B refinement (UNet, CLIP, VAE, 6× LoRA, prompt)
    │   ├── senzu_edit_gguf.json    # Same with GGUF model paths
    │   ├── senzu_upscale.json      # SeedVR2 DiT upscale (9 models, tiling, color correction)
    │   ├── senzu_krea2_t2i.json    # Krea2 Turbo T2I (resolution, 6× LoRA, inline enhancer)
    │   └── senzu_prompt_enhancer.json # Standalone prompt enhancer (TextGenerate, image ref, LLM/TE switch)
    └── data/                  # Auto-generated JSON files (gitignored)
```

## Stack

| Layer          | Choice                    | Rationale                                   |
|----------------|---------------------------|---------------------------------------------|
| Frontend       | Alpine.js 3.14.8 (no build)| Reactive, zero build step, CDN-free         |
| Backend        | Node.js + Express         | HTTP API for ComfyUI bridge                 |
| Image processing| sharp                     | Input downscale for SeedVR2                 |
| ComfyUI bridge | WorkflowMap + API JSON    | Explicit param→node ID injection            |
| ComfyUI        | External (127.0.0.1:8188) | Launched first by start_senzu.js            |
| Output storage | `outputs/senzu/`          | Temp cache + autosave to user folder        |

## Tabs

### Enhancer (`/app/public/index.html` — main tab)
Image enhancement & upscaling pipeline:
- **Full Chain** — Edit (Klein 9B) → Upscale (SeedVR2)
- **Edit Only** — Klein 9B refinement with 6× LoRA slots
- **Upscale Only** — SeedVR2 upscale with input downscale, tile controls, dynamic device detection (CUDA/MPS)

**Key features:**
- 6× LoRA configuration with compact number input (-∞ to +∞) and slider (-2 to +2)
- Model pack selector filtered to "edit" category
- Preset controls (save/load/overwrite)
- Prompt template library with edit/rename
- Multi-image input queue with before/after slider, zoom/pan/fullscreen
- Output navigation (prev/next/discard) with view/save/rerun actions
- Model nag banner (hidden when any pack is complete)

### Generate
Krea2 Turbo T2I image generation:
- Resolution selector: 4 base-size baskets (1024, 1280, 1536, HD)
  - HD basket: Desktop/Ultrawide/Super Ultrawide/Phone/Social/Video presets
  - Custom W×H sliders (512–2560, step 8)
- Model pack selector filtered to "generate" category
- Chain Enhancer toggle (runs standalone prompt enhancer before T2I)
- Standalone "Create Prompt" button with image reference, LLM/TE model switch
- 6× LoRA configuration (same UI as Enhancer)
- Seed control with randomize toggle
- Generate presets (save/load/overwrite)
- Generate enhancer prompt presets
- Zoom/pan/fullscreen viewer with output navigation, save-to-folder, send-to-enhancer

**Workflow chain:** Prompt Enhancer (optional) → Krea2 T2I

### Presets
- **Enhancer Presets** — save/apply/delete with card display (mode badge, LoRA count, resolution, steps/CFG/MP)
- **Generate Presets** — same pattern for generate settings (resolution, steps, enhancer toggle)

### Prompts
- **Prompt Templates** — CRUD with edit/rename (click populates name+content)
- **Enhancer Prompt Library** — system prompt templates for prompt enhancer

### Models
- **Model Packs** — split by category:
  - Enhancer section: FP8 Standard, Q8 High Quality, Q4 Low VRAM (Flux2 Klein, each with LoRAs)
  - Generate section: Krea2 Standard, Z-Image Standard, Klein Standard (no LoRAs)
- Category system: packs tagged `category: "edit"` or `"generate"`, filter dropdowns per tab
- Custom pack composer with GGUF mode + category switch
- Quality notes section (macOS/AMD guidance, gated official model info)

### Settings
- Save folder + autosave toggle
- Clear temp on start
- UI theme selector (Default, Pinokio Dark, Pinokio Light, Dragon Ball Z, Light Mode)

## Theming
CSS custom property system with 5 themes via `[data-theme="..."]` attribute:
- **Default** — purple neon on obsidian (#7c4dff)
- **Pinokio Dark** — gold accent (#e1b261 / #c2b28a), muted bronze buttons
- **Pinokio Light** — light warm background, navy buttons with gold text
- **Dragon Ball Z** — gold/red/blue on dark warm obsidian, shadowy dragon ball glow
- **Light Mode** — white cards, dark text, purple accent

Theme applied to `<html data-theme="...">` — anti-FOUC script in `<head>`, reactive via `applyTheme()`.

## Model Packs (Category System)
All packs have `category: "edit"` or `"generate"`:
- **Edit** packs: Flux2 Klein models (FP8/Q8/Q4) with Adonis Refine + Consistency V2 LoRAs
- **Generate** packs: Krea2 Turbo, Z-Image Turbo, Klein 9B (no LoRAs)

Enhancer/Generate tabs filter model pack dropdowns by category. Custom packs tagged via toggle switch.

## Prompt Enhancer
Two modes:
1. **Chain Enhancer** — toggle on Generate tab glass-card. Runs standalone enhancer before T2I generation. Uses frontend `api.enhancePrompt()` call.
2. **Standalone** — "Create Prompt" button in Prompt Enhancer accordion. Supports image reference upload, LLM vs TE model selection. Result populates prompt textarea.

Backend: `POST /api/enhance-prompt` → `senzu_prompt_enhancer.json` workflow → returns `enhanced_prompt` text from PreviewAny node output.

## System Monitor
Compact inline display in header (GPU temp + VRAM + RAM). Polled every 5s via `/api/system-stats`. Hidden when no NVIDIA GPU detected.

## Key Design Decisions

### Offline-first
All frontend assets self-hosted (Alpine.js 3.14.8, Font Awesome 6.4.0). No CDN calls.

### Security
- Express binds to `127.0.0.1` only (Pinokio's reverse proxy handles LAN)
- `crypto.randomUUID()` fallback for LAN/HTTP contexts
- `FileReader.readAsDataURL()` for image previews (works in all contexts)

### Before/After Slider
- Drag only from handle circle (no conflict with panning)
- Pan via left-click drag, active only when zoom > 1x

### Sidebar Collapse
`display: none` + `grid-column: 1 / -1` for browser compatibility

### Alpine.js Compatibility
- `document.querySelector()` over `this.$refs`
- `.indexOf() !== -1` over `.includes()` in templates
- Named methods over inline expressions

## Future Roadmap

### Short-term
- Inpaint & Outpaint with mask drawing tools
- Wildcard system for prompt templates
- LoRA trigger word management
- Preview prompt in Enhancer tab during processing

### Medium-term
- Video upscale workflows
- Video post-processing (color grade, interpolation)
- Batch/folder processing
- Breadboard local media browser integration

### Long-term
- Additional model packs (Z-Image, Flux2 Dev)
- Community preset/prompt sharing
- Workflow editor (visual node graph)
