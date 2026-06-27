"""
Z-Image Generation Module

Provides the Z-Image Turbo generation tab with Text→Image, Image→Image,
and Prompt Assistant functionality.
"""
import os
import logging
import random
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

import gradio as gr
import httpx

# Import from lora_ui for DUMMY_LORA constant
from modules.lora_ui import DUMMY_LORA, ensure_dummy_lora

# Import from model_ui for model selection components
from modules.model_ui import (
    create_model_ui,
    create_quick_preset_selector,
    setup_model_handlers,
    get_model_inputs,
    validate_models,
)

from modules.joycaption_ui import create_joycaption_ui, setup_joycaption_handlers

if TYPE_CHECKING:
    from modules import SharedServices

logger = logging.getLogger(__name__)

# Module metadata
TAB_ID = "zimage"
TAB_LABEL = "⚡Image"
TAB_ORDER = 0

# Fallback sampler/scheduler lists (used if ComfyUI not available)
FALLBACK_SAMPLERS = ["euler", "euler_ancestral", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_3m_sde", "res_multistep"]
FALLBACK_SCHEDULERS = ["simple", "normal", "karras", "exponential", "sgm_uniform"]

# Preferred defaults (will be selected if available)
PREFERRED_SAMPLER = "euler"
PREFERRED_SCHEDULER = "simple"

# Generation cancellation flag (set by stop button, checked by batch loop)
_cancel_generation = False

# Session temp directory for results (auto-cleaned on exit)
# Using a persistent TemporaryDirectory so files have nice names for Gradio download
_results_temp_dir = tempfile.TemporaryDirectory(prefix="zimage_results_")

# Resolution presets by base size - format: "WxH ( AR )"
RES_CHOICES = {
    "1024": [
        "1024x1024 ( 1:1 )",
        "1152x896 ( 9:7 )",
        "896x1152 ( 7:9 )",
        "1152x864 ( 4:3 )",
        "864x1152 ( 3:4 )",
        "1248x832 ( 3:2 )",
        "832x1248 ( 2:3 )",
        "1280x720 ( 16:9 )",
        "720x1280 ( 9:16 )",
        "1344x576 ( 21:9 )",
        "576x1344 ( 9:21 )",
    ],
    "1280": [
        "1280x1280 ( 1:1 )",
        "1440x1120 ( 9:7 )",
        "1120x1440 ( 7:9 )",
        "1472x1104 ( 4:3 )",
        "1104x1472 ( 3:4 )",
        "1536x1024 ( 3:2 )",
        "1024x1536 ( 2:3 )",
        "1536x864 ( 16:9 )",
        "864x1536 ( 9:16 )",
        "1680x720 ( 21:9 )",
        "720x1680 ( 9:21 )",
    ],
    "1536": [
        "1536x1536 ( 1:1 )",
        "1728x1344 ( 9:7 )",
        "1344x1728 ( 7:9 )",
        "1728x1296 ( 4:3 )",
        "1296x1728 ( 3:4 )",
        "1872x1248 ( 3:2 )",
        "1248x1872 ( 2:3 )",
        "2048x1152 ( 16:9 )",
        "1152x2048 ( 9:16 )",
        "2016x864 ( 21:9 )",
        "864x2016 ( 9:21 )",
    ],
}

def parse_resolution(res_string: str) -> tuple[int, int]:
    """Parse resolution string like '1024x1024 ( 1:1 )' into (width, height)."""
    # Extract WxH part before the parenthesis
    dims = res_string.split("(")[0].strip()
    w, h = dims.split("x")
    return int(w), int(h)

def get_resolution_dropdown_choices(base: str) -> list[tuple[str, str]]:
    """Get formatted dropdown choices with landscape/portrait grouping."""
    choices = RES_CHOICES.get(base, RES_CHOICES["1024"])
    # First item is always square
    result = [choices[0]]  # Square
    # Add landscape options (indices 1,3,5,7,9 - odd width > height)
    result.append("── Landscape ──")
    for i in [1, 3, 5, 7, 9]:
        result.append(choices[i])
    # Add portrait options (indices 2,4,6,8,10 - odd height > width)
    result.append("── Portrait ──")
    for i in [2, 4, 6, 8, 10]:
        result.append(choices[i])
    return result



def new_random_seed():
    """Generate a new random seed."""
    return random.randint(0, 999999999999)


def get_workflow_file(gen_type: str, use_gguf: bool, clip_type: str = "lumina2") -> str:
    """Determine which workflow file to use based on settings.
    
    Always uses lora workflows - loras are disabled by setting strength to 0.
    
    Args:
        gen_type: "t2i" or "i2i"
        use_gguf: Whether to use GGUF workflow variant
        clip_type: "lumina2" for Z-Image, "flux2" for Flux2 Klein, "krea2" for Krea2
        
    Returns:
        Workflow filename matching pattern:
        - Z-Image: z_image_{gguf_}?{gen_type}_lora.json
        - Flux2: flux2_klein_{gguf_}?{gen_type}_lora.json
        - Krea2:  krea2_{gen_type}_lora.json
    """
    if clip_type == "flux2":
        parts = ["flux2_klein"]
    elif clip_type == "krea2":
        parts = ["krea2"]
    else:
        parts = ["z_image"]
    if use_gguf:
        parts.append("gguf")
    parts.append(gen_type)
    parts.append("lora")  # Always use lora workflow
    return "_".join(parts) + ".json"


def extract_png_metadata(image_path: str) -> dict:
    """Extract ComfyUI metadata from PNG text chunks.
    
    Returns dict with 'prompt', 'workflow', and parsed generation params if available.
    """
    from PIL import Image
    import json
    
    result = {
        "prompt_text": "",
        "resolved_prompt": None,
        "params": {},
        "raw_prompt": None,
        "raw_workflow": None,
        "error": None
    }
    
    try:
        with Image.open(image_path) as img:
            # PNG text chunks are in img.info
            if not hasattr(img, 'info') or not img.info:
                result["error"] = "No metadata found in image"
                return result
            
            # Get raw metadata
            raw_prompt = img.info.get("prompt")
            raw_workflow = img.info.get("workflow")

            if raw_prompt:
                result["raw_prompt"] = raw_prompt
                try:
                    prompt_data = json.loads(raw_prompt)
                    # ComfyUI prompt is a dict of node_id -> node_data
                    # Look for text encoder / CLIP nodes that contain the prompt
                    for node_id, node_data in prompt_data.items():
                        if isinstance(node_data, dict):
                            inputs = node_data.get("inputs", {})
                            class_type = node_data.get("class_type", "")
                            
                            # Extract prompt text from various node types
                            if "text" in inputs and isinstance(inputs["text"], str):
                                if len(inputs["text"]) > len(result["prompt_text"]):
                                    result["prompt_text"] = inputs["text"]
                            
                            # Extract generation params from sampler nodes
                            if "KSampler" in class_type or "sampler" in class_type.lower():
                                if "seed" in inputs:
                                    result["params"]["seed"] = inputs["seed"]
                                if "steps" in inputs:
                                    result["params"]["steps"] = inputs["steps"]
                                if "cfg" in inputs:
                                    result["params"]["cfg"] = inputs["cfg"]
                                if "sampler_name" in inputs:
                                    result["params"]["sampler"] = inputs["sampler_name"]
                                if "scheduler" in inputs:
                                    result["params"]["scheduler"] = inputs["scheduler"]
                                if "shift" in inputs:
                                    result["params"]["shift"] = inputs["shift"]
                                if "denoise" in inputs:
                                    result["params"]["denoise"] = inputs["denoise"]
                            
                            # Extract dimensions from empty latent or image nodes
                            if "width" in inputs and "height" in inputs:
                                result["params"]["width"] = inputs["width"]
                                result["params"]["height"] = inputs["height"]
                            
                            # Extract model names
                            if "unet_name" in inputs:
                                result["params"]["diffusion"] = inputs["unet_name"]
                            if "clip_name" in inputs:
                                result["params"]["text_encoder"] = inputs["clip_name"]
                            
                            # Extract LoRA info from loader nodes
                            if "LoraLoader" in class_type or "lora" in class_type.lower():
                                lora_name = inputs.get("lora_name")
                                strength = inputs.get("strength_model", inputs.get("strength", 1.0))
                                if lora_name and lora_name != "none.safetensors":
                                    if "loras" not in result["params"]:
                                        result["params"]["loras"] = []
                                    result["params"]["loras"].append({
                                        "name": lora_name,
                                        "strength": strength
                                    })
                                
                except json.JSONDecodeError:
                    result["error"] = "Could not parse prompt metadata"

            # extra_pnginfo values are written by SaveImage as json.dumps(value),
            # so a plain string like "a cat" is stored as the JSON string '"a cat"'
            # (with wrapping quotes). We must json.loads() to unwrap it.
            raw_resolved = img.info.get("resolved_prompt")
            if raw_resolved:
                try:
                    resolved = json.loads(raw_resolved)
                except (json.JSONDecodeError, TypeError):
                    resolved = raw_resolved
                # Only store if it differs from the template prompt — if no wildcards
                # were expanded, they'll be identical and there's nothing useful to show.
                if resolved != result["prompt_text"]:
                    result["resolved_prompt"] = resolved
                    
            if raw_workflow:
                result["raw_workflow"] = raw_workflow
            
            if not raw_prompt and not raw_workflow:
                result["error"] = "No ComfyUI metadata found"
                
    except Exception as e:
        result["error"] = f"Error reading image: {str(e)}"
    
    return result


def format_metadata_display(metadata: dict) -> str:
    """Format extracted metadata for display."""
    lines = []
    
    if metadata.get("error"):
        return f"⚠️ {metadata['error']}"
    
    if metadata.get("prompt_text"):
        lines.append(f"📝 Prompt:\n{metadata['prompt_text']}\n")

    if metadata.get("resolved_prompt"):
        lines.append(f"📝 Resolved Prompt:\n{metadata['resolved_prompt']}\n")

    params = metadata.get("params", {})
    if params:
        lines.append("⚙️ Settings:")
        if "seed" in params:
            lines.append(f"  Seed: {params['seed']}")
        if "steps" in params:
            lines.append(f"  Steps: {params['steps']}")
        if "cfg" in params:
            lines.append(f"  CFG: {params['cfg']}")
        if "sampler" in params:
            lines.append(f"  Sampler: {params['sampler']}")
        if "scheduler" in params:
            lines.append(f"  Scheduler: {params['scheduler']}")
        if "shift" in params:
            lines.append(f"  Shift: {params['shift']}")
        if "width" in params and "height" in params:
            lines.append(f"  Size: {params['width']}x{params['height']}")
        if "denoise" in params:
            lines.append(f"  Denoise: {params['denoise']}")
        if "diffusion" in params:
            lines.append(f"  Model: {params['diffusion']}")
        if "loras" in params and params["loras"]:
            lines.append("\n🎨 LoRAs:")
            for lora in params["loras"]:
                lines.append(f"  {lora['name']} (strength: {lora['strength']})")
    
    if not lines:
        return "No generation parameters found in metadata"
    
    return "\n".join(lines)


def save_image_to_outputs(image_path: str, prompt: str, outputs_dir: Path, subfolder: str = None) -> str:
    """Save image to outputs folder with prompt and short timestamp.
    
    Args:
        image_path: Path to the source image
        prompt: Prompt text used for filename
        outputs_dir: Base outputs directory from SharedServices
        subfolder: Optional subfolder within outputs_dir
        
    Returns:
        Path to the saved image file
    """
    timestamp = datetime.now().strftime("%H%M%S")
    safe_prompt = "".join(c if c.isalnum() or c in " -_" else "" for c in prompt[:30]).strip()
    safe_prompt = safe_prompt.replace(" ", "_") if safe_prompt else "image"
    
    # Use subfolder if specified
    target_dir = outputs_dir / subfolder if subfolder else outputs_dir
    target_dir.mkdir(parents=True, exist_ok=True)
    
    # Format: prompt_HHMMSS.png (timestamp at end, less obtrusive)
    filename = f"{safe_prompt}_{timestamp}.png"
    output_path = target_dir / filename
    shutil.copy2(image_path, output_path)
    logger.info(f"Saved to: {output_path}")
    return str(output_path)


async def download_image_from_url(url: str) -> str:
    """Download image from ComfyUI URL to a local temp file."""
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        response.raise_for_status()
        suffix = Path(url).suffix or ".png"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
            f.write(response.content)
            return f.name


def copy_to_temp_with_name(image_path: str, prompt: str, seed: int) -> str:
    """Copy image to session temp dir with a meaningful name for Gradio download."""
    timestamp = datetime.now().strftime("%H%M%S")
    safe_prompt = "".join(c if c.isalnum() or c in " -_" else "" for c in prompt[:30]).strip()
    safe_prompt = safe_prompt.replace(" ", "_") if safe_prompt else "image"
    filename = f"{safe_prompt}_{seed}_{timestamp}.png"
    temp_path = Path(_results_temp_dir.name) / filename
    shutil.copy2(image_path, temp_path)
    return str(temp_path)


def fetch_comfyui_options(kit) -> dict:
    """Fetch available samplers and schedulers from ComfyUI's object_info API."""
    result = {
        "samplers": FALLBACK_SAMPLERS.copy(),
        "schedulers": FALLBACK_SCHEDULERS.copy()
    }
    
    if kit is None:
        return result
    
    try:
        with httpx.Client(timeout=5) as client:
            response = client.get(f"{kit.comfyui_url}/object_info/KSampler")
            if response.status_code == 200:
                data = response.json()
                ksampler_info = data.get("KSampler", {}).get("input", {}).get("required", {})
                
                # Extract sampler names
                sampler_info = ksampler_info.get("sampler_name", [])
                if sampler_info and isinstance(sampler_info[0], list):
                    result["samplers"] = sampler_info[0]
                
                # Extract scheduler names
                scheduler_info = ksampler_info.get("scheduler", [])
                if scheduler_info and isinstance(scheduler_info[0], list):
                    result["schedulers"] = scheduler_info[0]
                    
                logger.info(f"Loaded {len(result['samplers'])} samplers, {len(result['schedulers'])} schedulers from ComfyUI")
    except Exception as e:
        logger.warning(f"Could not fetch ComfyUI options, using fallbacks: {e}")
    
    return result


async def generate_image(
    services: "SharedServices",
    prompt: str,
    negative_prompt: str,
    gen_type: str,
    clip_type: str,
    use_gguf: bool,
    # t2i params
    width: int, height: int,
    # i2i params
    input_image, megapixels: float, denoise: float,
    # common params
    steps: int, seed: int, randomize_seed: bool,
    cfg: float, shift: float,
    sampler_name: str, scheduler: str,
    # model params
    unet_name: str, clip_name: str, vae_name: str,
    # lora params (6 slots with enable flags)
    lora1_enabled: bool, lora1_name: str, lora1_strength: float,
    lora2_enabled: bool, lora2_name: str, lora2_strength: float,
    lora3_enabled: bool, lora3_name: str, lora3_strength: float,
    lora4_enabled: bool, lora4_name: str, lora4_strength: float,
    lora5_enabled: bool, lora5_name: str, lora5_strength: float,
    lora6_enabled: bool, lora6_name: str, lora6_strength: float,
    # output params
    autosave: bool,
    # batch params
    batch_count: int = 1,
    # seed variance params
    sv_enabled: bool = False,
    sv_noise_insert: str = "noise on beginning steps",
    sv_randomize_percent: float = 50.0,
    sv_strength: float = 20.0,
    sv_steps_switchover_percent: float = 20.0,
    sv_seed: int = 0,
    sv_mask_starts_at: str = "beginning",
    sv_mask_percent: float = 0.0
):
    """Generate images using the selected workflow. Yields (gallery_images, status, seed) tuples."""
    # Get paths from services
    diffusion_dir = services.models_dir / "diffusion_models"
    text_encoders_dir = services.models_dir / "text_encoders"
    vae_dir = services.models_dir / "vae"
    outputs_dir = services.get_outputs_dir()
    
    # Handle seed early so we can yield it immediately
    base_seed = new_random_seed() if randomize_seed else int(seed)
    batch_count = max(1, min(int(batch_count), 100))  # Clamp to 1-100
    
    # Validate models exist before attempting generation
    models_valid, error_msg = validate_models(
        unet_name, clip_name, vae_name,
        diffusion_dir, text_encoders_dir, vae_dir
    )
    if not models_valid:
        yield [], f"❌ {error_msg}", base_seed
        return
    
    # Validate i2i has input image
    if gen_type == "i2i" and input_image is None:
        yield [], "❌ Please upload an input image for Image→Image", base_seed
        return
    
    # Select workflow
    workflow_file = get_workflow_file(gen_type, use_gguf, clip_type)
    workflow_path = services.workflows_dir / workflow_file
    
    if not workflow_path.exists():
        yield [], f"❌ Workflow not found: {workflow_file}", base_seed
        return
    
    # Allow empty prompt - model will generate without guidance
    prompt_text = prompt.strip() if prompt else ""
    
    logger.info(f"Using workflow: {workflow_file}")
    logger.info(f"Batch generation: {batch_count} images starting at seed={base_seed}")
    
    # Yield initial state
    status_prefix = f"[1/{batch_count}] " if batch_count > 1 else ""
    yield [], f"⏳ {status_prefix}Generating...", base_seed
    
    generated_images = []
    total_duration = 0.0
    
    try:
        global _cancel_generation
        _cancel_generation = False  # Reset at start of generation
        
        for i in range(batch_count):
            # Check for cancellation
            if _cancel_generation:
                _cancel_generation = False  # Reset for next run
                yield generated_images, "⏹️ Generation cancelled", base_seed
                return
            
            current_seed = base_seed + i
            
            # Update status for batch progress
            if batch_count > 1:
                yield generated_images, f"⏳ [{i+1}/{batch_count}] Generating (seed: {current_seed})...", base_seed
            
            # Build params dict
            params = {
                "prompt": prompt_text,
                "negative_prompt": negative_prompt.strip() if negative_prompt else "",
                "steps": int(steps),
                "seed": int(current_seed),
                "cfg": cfg,
                "sampler_name": sampler_name,
                "scheduler": scheduler,
                "unet_name": unet_name,
                "clip_name": clip_name,
                "clip_type": clip_type,
                "vae_name": vae_name,
            }
            
            # Add shift param only for Z-Image (Flux2 workflows don't use it)
            if clip_type != "flux2":
                params["shift"] = shift
            
            # Debug: log generation params
            logger.info(f"Generation params: seed={params['seed']}, steps={params['steps']}, cfg={params['cfg']}, shift={params.get('shift', 'N/A')}, sampler={params['sampler_name']}, scheduler={params['scheduler']}")
            
            # Add type-specific params
            if gen_type == "t2i":
                params["width"] = int(width)
                params["height"] = int(height)
            else:  # i2i
                params["image"] = input_image
                params["megapixels"] = megapixels
                params["denoise"] = denoise
            
            # Add lora params (6 slots - use dummy lora with strength 0 when disabled)
            params["lora1_name"] = lora1_name if (lora1_enabled and lora1_name) else DUMMY_LORA
            params["lora1_strength"] = lora1_strength if (lora1_enabled and lora1_name) else 0
            params["lora2_name"] = lora2_name if (lora2_enabled and lora2_name) else DUMMY_LORA
            params["lora2_strength"] = lora2_strength if (lora2_enabled and lora2_name) else 0
            params["lora3_name"] = lora3_name if (lora3_enabled and lora3_name) else DUMMY_LORA
            params["lora3_strength"] = lora3_strength if (lora3_enabled and lora3_name) else 0
            params["lora4_name"] = lora4_name if (lora4_enabled and lora4_name) else DUMMY_LORA
            params["lora4_strength"] = lora4_strength if (lora4_enabled and lora4_name) else 0
            params["lora5_name"] = lora5_name if (lora5_enabled and lora5_name) else DUMMY_LORA
            params["lora5_strength"] = lora5_strength if (lora5_enabled and lora5_name) else 0
            params["lora6_name"] = lora6_name if (lora6_enabled and lora6_name) else DUMMY_LORA
            params["lora6_strength"] = lora6_strength if (lora6_enabled and lora6_name) else 0
            
            # Debug: log lora params (first 3 for brevity)
            # logger.info(f"LoRA params: lora1={params['lora1_name']} ({params['lora1_strength']}), lora2={params['lora2_name']} ({params['lora2_strength']}), lora3={params['lora3_name']} ({params['lora3_strength']})")
            
            # Add seed variance params
            # When disabled, pass "disabled" to make the node a passthrough
            params["sv_noise_insert"] = sv_noise_insert if sv_enabled else "disabled"
            params["sv_randomize_percent"] = sv_randomize_percent
            params["sv_strength"] = sv_strength
            params["sv_steps_switchover_percent"] = sv_steps_switchover_percent
            # Use main seed if sv_seed is 0, otherwise use the specified variance seed
            params["sv_seed"] = current_seed if sv_seed == 0 else int(sv_seed)
            params["sv_mask_starts_at"] = sv_mask_starts_at
            params["sv_mask_percent"] = sv_mask_percent
            
            # Execute workflow using services.kit
            result = await services.kit.execute(str(workflow_path), params)
            
            if result.status == "error":
                if batch_count == 1:
                    yield [], f"❌ Generation failed: {result.msg}", base_seed
                    return
                else:
                    # Continue batch on error, just log it
                    logger.warning(f"Batch item {i+1} failed: {result.msg}")
                    continue
            
            if not result.images:
                if batch_count == 1:
                    yield [], "❌ No images generated", base_seed
                    return
                else:
                    continue
            
            # Get image
            image_path = result.images[0]
            if image_path.startswith("http"):
                image_path = await download_image_from_url(image_path)
            
            # Copy to temp with meaningful name so Gradio download button works nicely
            image_path = copy_to_temp_with_name(image_path, prompt_text or "image", current_seed)
            
            # Track duration
            if result.duration:
                total_duration += result.duration
            
            # Autosave each image as it completes
            if autosave:
                save_image_to_outputs(image_path, prompt_text or "image", outputs_dir)
            
            # Add to gallery with caption showing seed
            generated_images.append((image_path, f"seed: {current_seed}"))
            
            # Yield progress update
            if batch_count > 1:
                yield generated_images, f"✓ [{i+1}/{batch_count}] Complete", base_seed
        
        # Final status
        if not generated_images:
            yield [], "❌ No images generated", base_seed
            return
        
        # Build final status message
        count_str = f"{len(generated_images)} images" if len(generated_images) > 1 else ""
        time_str = f"{total_duration:.1f}s" if total_duration else ""
        save_str = "Saved" if autosave else ""
        
        status_parts = [p for p in [count_str, time_str, save_str] if p]
        status = "✓ " + " | ".join(status_parts) if status_parts else "✓ Done"
        
        yield generated_images, status, base_seed
        
    except Exception as e:
        logger.error(f"Error: {e}", exc_info=True)
        if "connect" in str(e).lower():
            yield generated_images or [], "❌ Cannot connect to ComfyUI", base_seed
        else:
            yield generated_images or [], f"❌ {str(e)}", base_seed


def create_tab(services: "SharedServices") -> gr.TabItem:
    """
    Create the Z-Image generation tab with all UI components and event handlers.
    
    Args:
        services: SharedServices instance with all dependencies
        
    Returns:
        gr.TabItem containing the complete Z-Image generation interface
    """
    # Get directories
    loras_dir = services.models_dir / "loras"
    
    # Ensure dummy lora exists
    ensure_dummy_lora(loras_dir)
    
    # Get ComfyUI options for samplers/schedulers
    comfyui_options = fetch_comfyui_options(services.kit)
    samplers = comfyui_options["samplers"]
    schedulers = comfyui_options["schedulers"]
    
    # Determine if setup banner should be shown (model_ui will handle detection)
    # For now, we'll let the model accordion open state indicate setup needed
    show_setup_banner = False  # model_ui handles this internally
    
    with gr.TabItem(TAB_LABEL, id=TAB_ID) as tab:
        # Setup banner - shown when no models installed
        setup_banner = gr.Markdown(
            "⚠️ **Setup Required** — Select a model preset and download models from the **🔧 Models** section.",
            visible=show_setup_banner,
            elem_classes=["setup-banner"]
        )
        
        with gr.Row():
            with gr.Column(scale=1):
                prompt = gr.Textbox(
                    label="Prompt",
                    placeholder="Describe your image...",
                    lines=3
                )
                
                # Generation type tabs
                with gr.Tabs():
                    with gr.TabItem("Text → Image"):
                        with gr.Row():
                            generate_t2i_btn = gr.Button("⚡ Generate", variant="primary", size="sm", scale=3)
                            enhance_btn = gr.Button("✨ Enhance", variant="huggingface", size="sm", scale=1)
                        with gr.Group():                        
                            with gr.Row():
                                width = gr.Slider(label="Width", value=1024, minimum=512, maximum=2048, step=32)
                                height = gr.Slider(label="Height", value=1024, minimum=512, maximum=2048, step=32)
                                  
                            with gr.Row():
                                res_base = gr.Radio(
                                    choices=["1024", "1280", "1536"],
                                    value="1024",
                                    label="Resolution",
                                    show_label=False,
                                    scale=1,
                                    min_width=180,
                                    elem_classes=["res-radio-compact"]
                                )
                                res_preset = gr.Dropdown(
                                    choices=get_resolution_dropdown_choices("1024"),
                                    value="1024x1024 ( 1:1 )",
                                    label="Aspect Ratio",
                                    show_label=False,
                                    scale=1,
                                    interactive=True
                                )
                    
                    with gr.TabItem("Image → Image"):
                        input_image = gr.Image(label="Input Image", type="filepath", height=360)
                        with gr.Row():
                            generate_i2i_btn = gr.Button("⚡ Generate", variant="primary", size="sm", scale=3)
                            i2i_describe_btn = gr.Button("🖼️ Describe", variant="huggingface", size="sm", scale=1)
                        with gr.Row():                                    
                            i2i_assist_status = gr.Textbox(
                                value="💡 Use Describe to generate a prompt describing your image. A low denoise img2img pass can greatly enhance existing images. Add a character LoRA for powerful transformations!",
                                lines=2.5,
                                interactive=False,
                                show_label=False
                            )
                        with gr.Row():
                            megapixels = gr.Slider(label="Megapixels", info="Scales against input image to maintain aspect ratio", value=1.5, minimum=0.5, maximum=3.0, step=0.1)
                            denoise = gr.Slider(label="Denoise", value=0.67, minimum=0.0, maximum=1.0, step=0.01)
                
                # Quick model preset selector (outside accordion for easy access)
                quick_preset, clip_type_state, presets_state = create_quick_preset_selector(
                    settings_manager=services.settings,
                    label="Model Preset",
                )
                
                # Generation settings - compact group
                with gr.Accordion("Settings"):
                    with gr.Group():
                        with gr.Row():
                            steps = gr.Slider(label="Steps", value=8, minimum=1, maximum=50, step=1)
                            cfg = gr.Slider(label="CFG", value=1.0, minimum=1.0, maximum=10.0, step=0.5)
                            shift = gr.Slider(label="Shift", value=3.0, minimum=1.0, maximum=10.0, step=0.5)
                    with gr.Group():
                        with gr.Row():
                            sampler_name = gr.Dropdown(label="Sampler", choices=samplers, value=PREFERRED_SAMPLER if PREFERRED_SAMPLER in samplers else samplers[0], scale=2)
                            scheduler = gr.Dropdown(label="Scheduler", choices=schedulers, value=PREFERRED_SCHEDULER if PREFERRED_SCHEDULER in schedulers else schedulers[0], scale=2)
                    with gr.Row():                                   
                        seed = gr.Number(label="Seed", value=new_random_seed(), minimum=0, step=1, scale=1)
                        randomize_seed = gr.Checkbox(label="🎲", value=True, scale=0, min_width=60)
                        batch_count = gr.Slider(label="Batch", value=1, minimum=1, maximum=100, step=1, scale=2, info="Images to generate")
                    negative_prompt = gr.Textbox(
                        label="Negative Prompt",
                        placeholder="Optional. Only effective when CFG > 1",
                        lines=1
                    )
                
                # Seed Variance - adds noise to text embeddings for more variation
                with gr.Accordion("🎲 Seed Variance", open=False):
                    gr.Markdown("*Add controlled noise to text embeddings for more variation across seeds*")
                    with gr.Row():
                        sv_enabled = gr.Checkbox(label="Enable", value=False, scale=0, min_width=80)
                        sv_noise_insert = gr.Dropdown(
                            label="Noise Insert",
                            choices=["noise on beginning steps", "noise on ending steps", "noise on all steps"],
                            value="noise on beginning steps",
                            scale=2,
                            info="Which steps use noisy embeddings"
                        )
                    with gr.Row():
                        sv_randomize_percent = gr.Slider(
                            label="Randomize %",
                            value=50.0, minimum=0.0, maximum=100.0, step=1,
                            info="Percentage of embedding values to add noise to"
                        )
                        sv_strength = gr.Slider(
                            label="Strength",
                            value=20.0, minimum=0.0, maximum=100.0, step=0.5,
                            info="Scale of the random noise"
                        )
                    with gr.Row():
                        sv_steps_switchover_percent = gr.Slider(
                            label="Steps Switchover %",
                            value=20.0, minimum=0.0, maximum=100.0, step=1,
                            info="When to switch between noisy and original embeddings"
                        )
                        sv_seed = gr.Number(
                            label="Variance Seed",
                            value=0, minimum=0, step=1,
                            info="Seed for noise generation (0 = use main seed)"
                        )
                    with gr.Row():
                        sv_mask_starts_at = gr.Dropdown(
                            label="Mask Starts At",
                            choices=["beginning", "end"],
                            value="beginning",
                            info="Which part of prompt to protect from noise"
                        )
                        sv_mask_percent = gr.Slider(
                            label="Mask %",
                            value=0.0, minimum=0.0, maximum=100.0, step=1,
                            info="Percentage of prompt protected from noise"
                        )
                
                # LoRA settings (6 slots with progressive reveal via lora_ui module)
                from modules.lora_ui import create_lora_ui, setup_lora_handlers, get_lora_inputs
                lora_components = create_lora_ui(loras_dir, accordion_open=False, initial_visible=1)
                
                # Model selection - using model_ui module for preset-based selection
                model_components = create_model_ui(
                    models_dir=services.models_dir,
                    accordion_label="🔧 Models",
                    accordion_open=show_setup_banner,
                    settings_manager=services.settings,
                    quick_preset_dropdown=quick_preset,
                    clip_type_state=clip_type_state,
                    presets_state=presets_state,
                )
                                    
            # Right column - output
            with gr.Column(scale=1):
                output_gallery = gr.Gallery(
                    label="Generated Images",
                    columns=4,
                    rows=2,
                    height=400,
                    object_fit="contain",
                    show_download_button=True,
                    show_share_button=False,
                    preview=True,
                    elem_id="output-gallery"
                )
                
                # Hidden state for selected gallery image
                selected_gallery_image = gr.State(value=None)
                
                with gr.Row():
                    save_btn = gr.Button("💾 Save", size="sm", variant="primary")
                    send_to_upscale_btn = gr.Button("🔍 Send to Upscale", size="sm", variant="huggingface")
                    open_folder_btn = gr.Button("📂 Open Folder", size="sm")
                
                with gr.Row():
                    autosave = gr.Checkbox(label="Auto-save", value=False, elem_classes="checkbox-compact")
                    gen_status = gr.Textbox(label="Status", interactive=False, show_label=False, lines=2)
                with gr.Row():
                    stop_btn = gr.Button("⏹️ Stop Generation", size="sm", variant="stop")
                    unload_btn = gr.Button("🗑️ Unload Comfyui Models", size="sm")
                
                # System monitor (UI only - timer is shared in app.py)
                from modules.system_monitor_ui import create_monitor_textboxes
                gpu_monitor, cpu_monitor = create_monitor_textboxes()

                # JoyCaption — image captioning accordion
                # show_image_input=True: zimage has no single shared image, so include the input
                jc = create_joycaption_ui(
                    accordion_label="🎨 JoyCaption",
                    accordion_open=False,
                    show_image_input=True,
                )
                
                # Image metadata reader
                with gr.Accordion("🔍 Read Image Metadata", open=False):
                    gr.Markdown("*Drop a ComfyUI-generated image to extract prompt & settings*")
                    meta_image = gr.Image(label="Drop image here", type="filepath", height=250)
                    meta_output = gr.Textbox(label="Metadata", lines=10, interactive=False, placeholder="Note that comfyui images not generated in z-fusion may not have compatible metadata, ie from workflows with parameters set in custom nodes etc.  SeedVR2 upscaled images don't contain generation metadata.", show_copy_button=True)
                    with gr.Row():
                        meta_to_prompt_btn = gr.Button("📋 Copy Prompt", size="sm", variant="huggingface")
                        meta_to_settings_btn = gr.Button("⚙️ Apply Settings", size="sm", variant="primary")
                
                # Camera prompts helper
                with gr.Accordion("📷 Camera Prompts", open=False):
                    gr.Markdown("*Visual reference for camera angles, shots, and compositions*")
                    open_camera_prompts_btn = gr.Button("🔗 Open Camera Prompts Generator", size="sm")
                
                # Getting Started guide
                with gr.Accordion("ℹ️ Getting Started", open=False):
                    gr.Markdown("""
**First Time Setup**
1. Download models in **🔧 Models** section (left panel)
2. Choose **GGUF** for lower VRAM (8GB) or **Standard** for full precision (16GB+)
3. Click the download button — check Pinokio's `->_ Terminal` button (top bar) for progress

**Already have ComfyUI via Pinokio?**  
Your models & LoRAs are automatically shared — no re-download needed!

**✨ Prompt Enhance**
- Click **Enhance** next to Generate to expand simple prompts into detailed descriptions
- Use **Describe** in Image→Image to generate prompts from uploaded images
- Defaults work great, but you can change LLMs in the **⚙️ LLM Settings** tab

**🎲 Wildcards**
Add variety to your prompts with random substitutions:
- `__name__` → Replaced with random line from `wildcards/name.txt`
- `{option1|option2|option3}` → Random inline selection
- Example: `A __camera__ of a {man|woman} with __eyecolor__`

The **seed determines which options are selected** — same prompt + seed = same result. This means you can recreate any image perfectly from its metadata, even when using wildcards!

Manage wildcard files in **🛠️ App Settings → 🎲 Wildcards**, where you can also test prompts before generating.

**🎲 Seed Variance**
Distilled "turbo" models can produce similar images across different seeds, especially with detailed prompts. Seed Variance fixes this by adding controlled noise to text embeddings, giving you more diverse outputs.
- **When to use**: Enable when your batch generations look too similar
- **Start with**: Strength 15-30, Randomize 50%, Switchover 20%
- **Key insight**: Detailed prompts = more variation (more values to randomize)
- **Advanced**: Use masking to protect important parts of your prompt from noise

**Tips**
- Default settings are tuned for the Z-Image Turbo model
- Use 🧹 **Unload ComfyUI Models** to keep Z-Fusion active while freeing resources for other activities.
- Check the GPU/CPU monitor to track resource usage
""")
        
        # ===== EVENT HANDLERS =====
        _setup_event_handlers(
            services=services,
            # UI components
            prompt=prompt,
            setup_banner=setup_banner,
            # T2I components
            generate_t2i_btn=generate_t2i_btn,
            width=width,
            height=height,
            res_base=res_base,
            res_preset=res_preset,
            # I2I components
            generate_i2i_btn=generate_i2i_btn,
            input_image=input_image,
            i2i_describe_btn=i2i_describe_btn,
            i2i_assist_status=i2i_assist_status,
            megapixels=megapixels,
            denoise=denoise,
            # Prompt enhance
            enhance_btn=enhance_btn,
            # Settings
            steps=steps,
            cfg=cfg,
            shift=shift,
            sampler_name=sampler_name,
            scheduler=scheduler,
            seed=seed,
            randomize_seed=randomize_seed,
            batch_count=batch_count,
            negative_prompt=negative_prompt,
            # Seed variance
            sv_enabled=sv_enabled,
            sv_noise_insert=sv_noise_insert,
            sv_randomize_percent=sv_randomize_percent,
            sv_strength=sv_strength,
            sv_steps_switchover_percent=sv_steps_switchover_percent,
            sv_seed=sv_seed,
            sv_mask_starts_at=sv_mask_starts_at,
            sv_mask_percent=sv_mask_percent,
            # LoRA (using lora_ui module)
            lora_components=lora_components,
            # Models (using model_ui module)
            model_components=model_components,
            # Output
            output_gallery=output_gallery,
            selected_gallery_image=selected_gallery_image,
            save_btn=save_btn,
            send_to_upscale_btn=send_to_upscale_btn,
            open_folder_btn=open_folder_btn,
            autosave=autosave,
            stop_btn=stop_btn,
            unload_btn=unload_btn,
            gen_status=gen_status,
            # Metadata reader
            meta_image=meta_image,
            meta_output=meta_output,
            meta_to_prompt_btn=meta_to_prompt_btn,
            meta_to_settings_btn=meta_to_settings_btn,
            open_camera_prompts_btn=open_camera_prompts_btn,
            # JoyCaption
            jc=jc,
            # Directories
            loras_dir=loras_dir,
            # Valid options for metadata apply
            samplers=samplers,
            schedulers=schedulers,
        )
    
    # Register monitor components for shared timer in app.py
    # (must be done here in create_tab where gpu_monitor/cpu_monitor are in scope)
    services.inter_module.register_component("zimage_gpu_monitor", gpu_monitor)
    services.inter_module.register_component("zimage_cpu_monitor", cpu_monitor)
    
    return tab


def _setup_event_handlers(
    services: "SharedServices",
    # All UI components passed as kwargs
    **components
):
    """Set up all event handlers for the Z-Image tab."""
    import subprocess
    import sys
    import webbrowser
    
    # Extract components
    prompt = components["prompt"]
    setup_banner = components["setup_banner"]
    generate_t2i_btn = components["generate_t2i_btn"]
    width = components["width"]
    height = components["height"]
    res_base = components["res_base"]
    res_preset = components["res_preset"]
    generate_i2i_btn = components["generate_i2i_btn"]
    input_image = components["input_image"]
    i2i_describe_btn = components["i2i_describe_btn"]
    i2i_assist_status = components["i2i_assist_status"]
    megapixels = components["megapixels"]
    denoise = components["denoise"]
    enhance_btn = components["enhance_btn"]
    steps = components["steps"]
    cfg = components["cfg"]
    shift = components["shift"]
    sampler_name = components["sampler_name"]
    scheduler = components["scheduler"]
    seed = components["seed"]
    randomize_seed = components["randomize_seed"]
    batch_count = components["batch_count"]
    negative_prompt = components["negative_prompt"]
    sv_enabled = components["sv_enabled"]
    sv_noise_insert = components["sv_noise_insert"]
    sv_randomize_percent = components["sv_randomize_percent"]
    sv_strength = components["sv_strength"]
    sv_steps_switchover_percent = components["sv_steps_switchover_percent"]
    sv_seed = components["sv_seed"]
    sv_mask_starts_at = components["sv_mask_starts_at"]
    sv_mask_percent = components["sv_mask_percent"]
    # LoRA components from lora_ui module
    lora_components = components["lora_components"]
    # Model components from model_ui module
    model_components = components["model_components"]
    output_gallery = components["output_gallery"]
    selected_gallery_image = components["selected_gallery_image"]
    save_btn = components["save_btn"]
    send_to_upscale_btn = components["send_to_upscale_btn"]
    open_folder_btn = components["open_folder_btn"]
    autosave = components["autosave"]
    stop_btn = components["stop_btn"]
    unload_btn = components["unload_btn"]
    gen_status = components["gen_status"]
    meta_image = components["meta_image"]
    meta_output = components["meta_output"]
    meta_to_prompt_btn = components["meta_to_prompt_btn"]
    meta_to_settings_btn = components["meta_to_settings_btn"]
    open_camera_prompts_btn = components["open_camera_prompts_btn"]
    loras_dir = components["loras_dir"]
    samplers = components["samplers"]
    schedulers = components["schedulers"]
    
    # Set up model handlers using model_ui module
    setup_model_handlers(model_components, services.models_dir, settings_manager=services.settings)
    
    # Set up JoyCaption handlers (standalone image input — show_image_input=True)
    jc = components.get("jc")
    if jc is not None:
        setup_joycaption_handlers(jc, services, prompt_target=components["prompt"])
        # Sync i2i input_image → jc.image so captioning reflects the loaded image
        input_image = components["input_image"]
        input_image.change(
            fn=lambda img: img,
            inputs=[input_image],
            outputs=[jc.image],
        )
    
    # Prompt Enhance button - outputs to gen_status
    if services.prompt_assistant:
        enhance_btn.click(
            fn=services.prompt_assistant.enhance_prompt,
            inputs=[prompt],
            outputs=[prompt, gen_status]
        )
        
        # I2I tab describe button - clears prompt first, then describes image
        i2i_describe_btn.click(
            fn=lambda: ("", "👁️ Preparing..."),
            outputs=[prompt, i2i_assist_status]
        ).then(
            fn=services.prompt_assistant.describe_image,
            inputs=[input_image, prompt],
            outputs=[prompt, i2i_assist_status]
        )
    
    # Resolution preset handlers
    def on_res_base_change(base):
        """Update dropdown choices when resolution base changes, keeping same AR if possible."""
        new_choices = get_resolution_dropdown_choices(base)
        # Default to square for the new base
        default_value = RES_CHOICES[base][0]
        return gr.update(choices=new_choices, value=default_value), *parse_resolution(default_value)
    
    def on_res_preset_change(preset):
        """Update width/height sliders when preset is selected."""
        # Skip divider labels
        if preset.startswith("──"):
            return gr.update(), gr.update()
        w, h = parse_resolution(preset)
        return w, h
    
    res_base.change(
        fn=on_res_base_change,
        inputs=[res_base],
        outputs=[res_preset, width, height]
    )
    
    res_preset.change(
        fn=on_res_preset_change,
        inputs=[res_preset],
        outputs=[width, height]
    )
    
    # Set up LoRA handlers using lora_ui module
    from modules.lora_ui import setup_lora_handlers, get_lora_inputs, scan_loras
    setup_lora_handlers(lora_components, loras_dir)
    lora_inputs = get_lora_inputs(lora_components)
    
    # Metadata reader handlers
    # Store extracted metadata for use by buttons
    extracted_metadata = gr.State(value={})
    
    def on_meta_image_change(image_path):
        """Extract and display metadata when image is uploaded."""
        if not image_path:
            return "", {}
        metadata = extract_png_metadata(image_path)
        display = format_metadata_display(metadata)
        return display, metadata
    
    meta_image.change(
        fn=on_meta_image_change,
        inputs=[meta_image],
        outputs=[meta_output, extracted_metadata]
    )
    
    def copy_prompt_from_metadata(metadata):
        """Copy extracted prompt to the main prompt field."""
        if metadata and metadata.get("prompt_text"):
            return metadata["prompt_text"]
        return gr.update()
    
    meta_to_prompt_btn.click(
        fn=copy_prompt_from_metadata,
        inputs=[extracted_metadata],
        outputs=[prompt]
    )
    
    # Get current valid options for validation
    available_loras = scan_loras(loras_dir)
    
    def apply_settings_from_metadata(metadata):
        """Apply extracted settings to the UI controls including prompt and LoRAs.
        
        Only applies values that are valid for the current setup (e.g., installed LoRAs,
        available samplers/schedulers).
        """
        # 28 outputs: prompt, seed, randomize_seed, steps, cfg, shift, sampler, scheduler, width, height,
        #             lora1-6 (enabled, name, strength) = 18 lora outputs
        no_update = [gr.update()] * 28
        
        if not metadata:
            return no_update
        
        params = metadata.get("params", {})
        prompt_text = metadata.get("prompt_text", "")
        loras_from_meta = params.get("loras", [])
        
        # Build LoRA updates (6 slots) - only apply if LoRA exists locally
        lora_updates = []
        for i in range(6):
            if i < len(loras_from_meta):
                lora = loras_from_meta[i]
                lora_name = lora["name"]
                # Check if this LoRA exists in our collection
                if lora_name in available_loras:
                    lora_updates.extend([
                        gr.update(value=True),  # enabled
                        gr.update(value=lora_name),  # name
                        gr.update(value=lora["strength"]),  # strength
                    ])
                else:
                    # LoRA not found - skip it (don't enable, don't change name)
                    logger.warning(f"LoRA not found locally, skipping: {lora_name}")
                    lora_updates.extend([
                        gr.update(value=False),  # disabled
                        gr.update(),  # keep current name
                        gr.update(),  # keep current strength
                    ])
            else:
                # Clear unused slots
                lora_updates.extend([
                    gr.update(value=False),  # disabled
                    gr.update(),  # keep name
                    gr.update(),  # keep strength
                ])
        
        # Only apply sampler/scheduler if they're in our available lists
        sampler_update = gr.update()
        if "sampler" in params and params["sampler"] in samplers:
            sampler_update = gr.update(value=params["sampler"])
        elif "sampler" in params:
            logger.warning(f"Sampler not available, skipping: {params['sampler']}")
        
        scheduler_update = gr.update()
        if "scheduler" in params and params["scheduler"] in schedulers:
            scheduler_update = gr.update(value=params["scheduler"])
        elif "scheduler" in params:
            logger.warning(f"Scheduler not available, skipping: {params['scheduler']}")
        
        # Helper to check if a value is a usable number (not a node reference like ['67', 0])
        def is_valid_number(val):
            return isinstance(val, (int, float)) and not isinstance(val, bool)
        
        def is_valid_int(val):
            return isinstance(val, int) and not isinstance(val, bool)
        
        return (
            gr.update(value=prompt_text) if prompt_text else gr.update(),
            gr.update(value=int(params["seed"])) if "seed" in params and is_valid_number(params["seed"]) else gr.update(),
            gr.update(value=False) if "seed" in params and is_valid_number(params["seed"]) else gr.update(),  # Only uncheck if we have a valid seed
            gr.update(value=int(params["steps"])) if "steps" in params and is_valid_int(params["steps"]) else gr.update(),
            gr.update(value=params["cfg"]) if "cfg" in params and is_valid_number(params["cfg"]) else gr.update(),
            gr.update(value=params["shift"]) if "shift" in params and is_valid_number(params["shift"]) else gr.update(),
            sampler_update,
            scheduler_update,
            gr.update(value=int(params["width"])) if "width" in params and is_valid_int(params["width"]) else gr.update(),
            gr.update(value=int(params["height"])) if "height" in params and is_valid_int(params["height"]) else gr.update(),
            *lora_updates
        )
    
    # Build lora output components list for metadata apply
    lora_output_components = []
    for slot in lora_components.slots:
        lora_output_components.extend([slot.enabled, slot.name, slot.strength])
    
    meta_to_settings_btn.click(
        fn=apply_settings_from_metadata,
        inputs=[extracted_metadata],
        outputs=[
            prompt, seed, randomize_seed, steps, cfg, shift, sampler_name, scheduler, width, height,
            *lora_output_components
        ]
    )
    
    # Shared inputs for both generate buttons
    # Model inputs: clip_type_state, use_gguf, unet_name, clip_name, vae_name
    # The wrapper functions extract clip_type and use_gguf first, then pass the rest as *args
    # So common_inputs order must match generate_image signature after clip_type and use_gguf:
    # steps, seed, randomize_seed, cfg, shift, sampler_name, scheduler, unet_name, clip_name, vae_name, loras...
    
    common_inputs = [
        negative_prompt,                   # negative_prompt - passed to generate_image
        model_components.clip_type_state,  # clip_type - extracted by wrapper
        model_components.use_gguf,         # use_gguf - extracted by wrapper
        steps, seed, randomize_seed, cfg, shift,
        sampler_name, scheduler,
        model_components.unet_name, model_components.clip_name, model_components.vae_name,
        # 6 lora slots (enabled, name, strength) via lora_inputs
        *lora_inputs,
        autosave,
        batch_count,
        # Seed variance params
        sv_enabled, sv_noise_insert, sv_randomize_percent, sv_strength,
        sv_steps_switchover_percent, sv_seed, sv_mask_starts_at, sv_mask_percent
    ]
    
    # Wrapper functions for async generate (async generators)
    # Returns (gallery, status, seed, selected_image) - selected_image is always None to clear stale selection
    async def generate_t2i(p, w, h, neg, clip_type, gguf, *args):
        async for gallery, status, seed_val in generate_image(services, p, neg, "t2i", clip_type, gguf, w, h, None, 2.0, 0.67, *args):
            yield gallery, status, seed_val, None  # Clear selected_gallery_image on each yield
    
    async def generate_i2i(p, img, mp, dn, neg, clip_type, gguf, *args):
        async for gallery, status, seed_val in generate_image(services, p, neg, "i2i", clip_type, gguf, 1024, 1024, img, mp, dn, *args):
            yield gallery, status, seed_val, None  # Clear selected_gallery_image on each yield
    
    # T2I generate - clears selected_gallery_image to prevent stale selection bug
    generate_t2i_btn.click(
        fn=generate_t2i,
        inputs=[prompt, width, height] + common_inputs,
        outputs=[output_gallery, gen_status, seed, selected_gallery_image]
    )
    
    # I2I generate - clears selected_gallery_image to prevent stale selection bug
    generate_i2i_btn.click(
        fn=generate_i2i,
        inputs=[prompt, input_image, megapixels, denoise] + common_inputs,
        outputs=[output_gallery, gen_status, seed, selected_gallery_image]
    )
    
    # Unload models
    async def unload_models() -> str:
        """Unload all models from ComfyUI to free VRAM."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{services.kit.comfyui_url}/free",
                    json={"unload_models": True, "free_memory": True}
                )
                if response.status_code == 200:
                    return "✓ ComfyUI models unloaded, VRAM freed"
                return f"❌ Failed: {response.status_code}"
        except Exception as e:
            return f"❌ Error: {e}"
    
    unload_btn.click(
        fn=unload_models,
        outputs=[gen_status]
    )
    
    # Stop generation (interrupt ComfyUI and cancel batch loop)
    async def stop_generation() -> str:
        """Interrupt current ComfyUI generation and cancel batch loop."""
        global _cancel_generation
        _cancel_generation = True  # Signal batch loop to stop
        try:
            async with httpx.AsyncClient() as client:
                # Interrupt current generation
                response = await client.post(f"{services.kit.comfyui_url}/interrupt")
                if response.status_code == 200:
                    return "⏹️ Stopping generation..."
                return f"❌ Failed: {response.status_code}"
        except Exception as e:
            return f"❌ Error: {e}"
    
    stop_btn.click(
        fn=stop_generation,
        outputs=[gen_status]
    )
    
    # Save selected image from gallery (or first if none selected)
    def save_selected_image(selected_img, gallery_data, prompt_text):
        image_to_save = None
        
        # Prefer explicitly selected image
        if selected_img:
            image_to_save = selected_img
        # Fall back to first gallery image
        elif gallery_data:
            item = gallery_data[0]
            image_to_save = item[0] if isinstance(item, (list, tuple)) else item
        
        if not image_to_save:
            return "❌ No image to save"
        
        outputs_dir = services.get_outputs_dir()
        saved_path = save_image_to_outputs(image_to_save, prompt_text or "image", outputs_dir)
        return f"✓ Saved: {Path(saved_path).name}"
    
    save_btn.click(
        fn=save_selected_image,
        inputs=[selected_gallery_image, output_gallery, prompt],
        outputs=[gen_status]
    )
    
    # Track gallery selection for "Send to Upscale"
    def on_gallery_select(evt: gr.SelectData, gallery_data):
        """Store the selected image path when user clicks on gallery item."""
        if gallery_data and evt.index < len(gallery_data):
            item = gallery_data[evt.index]
            image_path = item[0] if isinstance(item, (list, tuple)) else item
            return image_path
        return None
    
    output_gallery.select(
        fn=on_gallery_select,
        inputs=[output_gallery],
        outputs=[selected_gallery_image]
    )
    
    # Register components for post-load cross-module wiring of "Send to X" buttons
    # The actual click handlers are wired up in app.py after all modules are loaded
    services.inter_module.register_component("zimage_send_to_upscale_btn", send_to_upscale_btn)
    services.inter_module.register_component("zimage_selected_gallery_image", selected_gallery_image)
    services.inter_module.register_component("zimage_output_gallery", output_gallery)
    services.inter_module.register_component("zimage_gen_status", gen_status)
    services.inter_module.register_component("zimage_prompt", prompt)
    services.inter_module.register_component("zimage_seed", seed)
    services.inter_module.register_component("zimage_randomize_seed", randomize_seed)
    
    # Open folder helpers
    def open_folder(folder_path: Path):
        """Cross-platform folder opener."""
        folder_path.mkdir(parents=True, exist_ok=True)
        if sys.platform == "win32":
            os.startfile(folder_path)
        elif sys.platform == "darwin":
            subprocess.run(["open", str(folder_path)])
        else:
            subprocess.run(["xdg-open", str(folder_path)])
    
    def open_outputs_folder():
        open_folder(services.get_outputs_dir())
    
    open_folder_btn.click(fn=open_outputs_folder, outputs=[])
    
    # Camera prompts - open in browser
    def open_camera_prompts():
        camera_html = services.app_dir / "CameraPromptsGenerator" / "index.html"
        if camera_html.exists():
            webbrowser.open(camera_html.as_uri())
            return "✓ Opened in browser"
        return "❌ Camera prompts not found"
    
    open_camera_prompts_btn.click(fn=open_camera_prompts)
