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
    │   │   ├── prompts.js    # CRUD for prompt templates
    │   │   ├── model-packs.js# CRUD for named model combinations
    │   │   └── settings.js   # App settings (save folder, autosave, theme, temp)
    │   ├── workflows/        # ComfyUI API-format workflow JSONs
    │   │   ├── senzu_edit.json
    │   │   ├── senzu_edit_gguf.json
    │   │   └── senzu_upscale.json
    │   └── data/
    │       ├── senzu-presets.json   # User presets (defaults: "Default")
    │       ├── senzu-model-packs.json # Model pack definitions
    │       ├── senzu-settings.json  # App-wide settings
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

### Short-term (completed)
- Expanded Model section — model packs with recommended downloads + custom composer
- App Settings tab — custom save folder, autosave, clear temp on start, theme placeholder
- Preset overhaul — richer cards, model pack selector, preset controls accordion
- Multi-image input queue with continuous background processing
- Output queue navigation (prev/next/discard) with in-viewer arrows
- Smart save filenames using original input name + processing type suffix
- Output storage as temp cache with autosave to user folder

### Short-term (next)
- Polish model card downloads and add starter UI themes
- Clean repo split (remove z-fusion parent, standalone Senzu)

### Medium-term
- Inpaint & Outpaint with mask drawing tools (see section below)
- Add video gen workflows and UX
- Add video post-processing workflows (color grade, upscale, interpolation, etc)
- Integrate the Breadboard local media browser

---

## Inpaint & Outpaint (Planned)

### Overview
Add two new workflow modes — Inpaint and Outpaint — allowing users to draw masks directly on the image in the output viewer. The mask is sent as a separate image blob to ComfyUI alongside the input image.

### Mode Buttons
Added alongside existing mode toggles:
```
[Full Chain] [Edit Only] [Upscale Only] [Inpaint] [Outpaint]
```
When Inpaint or Outpaint is active, the viewer switches from before/after comparison to mask-editing mode.

### Canvas Mask Overlay
A `<canvas>` element placed inside `.zoom-wrapper` alongside the two slider images. This means it shares the same zoom/pan CSS transform — drawing at any zoom level maps correctly to image pixels.

```html
<canvas x-show="params.mode === 'inpaint' || params.mode === 'outpaint'"
        class="mask-canvas" x-ref="maskCanvas"
        @mousedown="startMaskDraw" @mousemove="drawMask"
        @mouseup="stopMaskDraw" @mouseleave="stopMaskDraw">
</canvas>
```

CSS: `position: absolute; top:0; left:0; width:100%; height:100%; z-index:5; cursor:crosshair; pointer-events:auto`

The canvas `width`/`height` attributes are set to match image natural dimensions (inpaint) or expanded template dimensions (outpaint), while CSS fills the wrapper. This gives 1:1 pixel mapping.

### Coordinate Mapping
Mouse events must map from screen → container → wrapper (pre-transform) → canvas pixels:

```js
// Container coords
mx = e.clientX - containerRect.left
// Inverse zoom/pan to wrapper coords
wx = (mx - W/2) / zoomLevel - panX + W/2
// Map to canvas pixels (accounting for object-fit:contain letterboxing)
cx = (wx - offsetX) / displayW * canvasWidth
```

### Canvas Resolution
- **Inpaint**: Canvas dimensions = input image natural dimensions. 1 canvas pixel = 1 image pixel.
- **Outpaint**: Canvas is larger than the image, sized to the selected aspect ratio template. The input image is placed within the canvas. White pixels = regions to generate; black = preserved.

### Brush Tool
- Single color mask (white = inpaint/generate, black = keep)
- Adjustable brush size slider
- Undo stack: save `canvas.toDataURL()` before each stroke
- Clear mask: fill canvas with black
- Cursor shows brush circle matching size

State: `isDrawing`, `brushSize` (default 40px), `maskUndoStack[]`

### Slider Bar Visibility
Hidden when in mask-editing modes:
```html
<div x-show="inputPreview && params.mode !== 'inpaint' && params.mode !== 'outpaint'" class="slider-bar">
```

### Sidebar — Inpaint Mode
Replaces Edit Settings accordion content:
- Brush size slider
- Undo / Clear Mask buttons
- Prompt textarea (describe what to generate in the masked region)
- Prompt template dropdown (reused from existing system)

### Sidebar — Outpaint Mode
Same as Inpaint plus a template selector above:

Aspect ratio presets: 1:1, 4:5, 5:4, 9:16, 16:9, 3:2, plus custom width/height inputs.

Selecting a template resizes the canvas. The input image is placed centered by default.

A crop-style grid overlay appears over the image. User can:
- Drag corner/side handles to resize the grid
- Drag the entire grid to reposition it on the image
- The image can be zoomed (scale) but not moved independently

This follows the Krea.ai "Crop & Expand" pattern.

### Mask Export
When "Enhance" is clicked:
1. `canvas.toBlob('image/png')` → mask blob
2. Appended to FormData as `mask` field
3. API receives `req.files.mask` alongside `req.files.image`
4. Server passes mask path to ComfyUI inpainting/outpainting workflow via `workflowMap.js`

### Backend
- **`workflows/senzu_inpaint.json`**: ComfyUI workflow with VAE Encode (mask), Set Latent Noise Mask, etc.
- **`workflows/senzu_outpaint.json`**: Similar with outpaint-specific node config
- **`server/index.js`**: Update multer to accept `mask` field via `upload.fields([...])`
- **`workflowMap.js`**: Add mask node ID mappings

### Implementation Order
1. Add Inpaint/Outpaint mode buttons
2. `<canvas>` overlay + CSS + coordinate mapping
3. Mask state + drawing methods (brush, undo, clear)
4. Brush controls accordion in sidebar
5. Slider bar visibility condition
6. Mask export (toBlob → FormData → API)
7. Outpaint template selector + canvas expansion + grid overlay
8. Backend: mask handling, workflow JSONs, workflowMap

