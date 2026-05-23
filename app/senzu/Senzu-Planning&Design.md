# Senzu — Planning & Design Document

## Overview
A local-first image enhancement and upscaling web UI bundled as a Pinokio-launched module within the Z-Fusion ecosystem. Named after the Dragon Ball Z Senzu beans (restoration theme) — aligns with the enhance/restore/upscale mission.

## Architecture

```
Z-Fusion2.git/
├── pinokio.js              # Top-level Pinokio menu — routes to start_pf.js for Senzu
├── start_senzu.js          # Pinokio launch script: starts ComfyUI → installs deps → starts Senzu server
└── app/senzu/              # Senzu application root
    ├── app/
    │   ├── public/         # Frontend SPA (Alpine.js, self-hosted assets)
    │   │   ├── index.html  # Main single-page application
    │   │   ├── css/
    │   │   │   ├── senzu.css
    │   │   │   └── fontawesome/   # Self-hosted Font Awesome 6.4.0
    │   │   ├── js/
    │   │   │   ├── app.js         # Alpine component — all UI logic
    │   │   │   ├── api.js         # Fetch wrapper for backend API
    │   │   │   └── alpine.min.js  # Self-hosted Alpine.js 3.14.8
    │   │   └── webfonts/          # Font Awesome webfont files
    │   ├── server/
    │   │   ├── index.js      # Express server (port 4242), API routes
    │   │   ├── comfyui.js    # ComfyUI HTTP bridge (queue prompt, poll history, download)
    │   │   ├── workflowMap.js# Maps API params → ComfyUI node IDs + fields
    │   │   ├── presets.js    # CRUD for user preset profiles
    │   │   └── prompts.js    # CRUD for prompt templates
    │   ├── workflows/        # ComfyUI API-format workflow JSONs
    │   │   ├── senzu_edit.json
    │   │   ├── senzu_edit_gguf.json
    │   │   └── senzu_upscale.json
    │   └── data/
    │       ├── senzu-presets.json   # User presets (default: "Senzu Detail")
    │       └── prompts.json         # Prompt template library
    ├── senzu_UI_plans.txt
    └── Senzu-Planning&Design.md      # This document
```

## Stack

| Layer          | Choice                    | Rationale                                   |
|----------------|---------------------------|---------------------------------------------|
| Frontend       | Alpine.js (no build)      | Reactive, zero build step, CDN-free         |
| Backend        | Node.js + Express         | HTTP API for ComfyUI bridge                 |
| ComfyUI bridge | WorkflowMap + API JSON    | Senzu-native workflows with explicit param→node mapping |
| ComfyUI        | External (127.0.0.1:8188) | Launched first by start_senzu.js; Senzu connects to it |
| Output storage | `outputs/senzu/`          | Server root-relative outputs directory       |

## Workflow Pipeline

### Modes
1. **Full Chain** — Edit (Klein 9B) → Upscale (SeedVR2), two sequential ComfyUI queues
2. **Edit Only** — Single Klein 9B refinement pass
3. **Upscale Only** — Single SeedVR2 upscale from input

### Workflow Mapping
Params are injected into workflow JSONs via `workflowMap.js`:
- `senzu_edit.json` — Klein 9B flux refinement (UNet, CLIP, LoRAs, prompt, steps, CFG, megapixels)
- `senzu_edit_gguf.json` — Same edit with GGUF model path variants (low VRAM)
- `senzu_upscale.json` — SeedVR2 DiT upscale (resolution, tiling, color correction, attention mode)

## Key Design Decisions

### Offline-first
All frontend assets are self-hosted (Alpine.js 3.14.8, Font Awesome 6.4.0 CSS + webfonts). No CDN calls

### Before/After Slider
- Slider drag only activates from the handle circle (prevents conflict with image panning)
- Pan via left-click drag, active only when zoom > 1x

### Sidebar Collapse
Uses `display: none` + `grid-column: 1 / -1` for broader browser compatibility

### Alpine.js Compatibility
- Uses `document.querySelector()` instead of `this.$refs`
- Uses `.indexOf() !== -1` instead of `.includes()` in template expressions
- Event listeners registered via `document.addEventListener()` in `init()` rather than `@mouseup`/`@touchend` on `<body>`
- Named methods (`toggleSidebar()`) instead of inline expressions (`sidebarOpen = !sidebarOpen`)

## Future Roadmap (Post-v1)

### Short-term
- Expanded Model section - move model selectors from main page to models page. save selected model sets (dit, clip, vae) as presets for main page selection.
- Add app Settings tab - custom save location; temp file cleanup management; theme options, etc
- UI themes!
- Cropping and outpainting input tools 
- Batch/folder processing

### Medium-term
- Add video gen workflows and UX
- Add video post-processing workflows (color grade, upscale, interpolation, etc)
- Integrate the Breadboard local media browser

