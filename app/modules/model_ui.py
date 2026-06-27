"""
Model UI Components

Reusable Gradio components for model selection across modules.
Provides a consistent UI pattern for diffusion model, text encoder, and VAE selection
with user-customizable presets for different model families (Z-Image, Flux2 Klein, etc.).

Key Features:
- User-customizable model presets with custom names
- Quick preset selector for main UI (outside accordion)
- Base types that determine clip_type and workflow selection
- Standard/GGUF mode per preset
- Model download management
- Add/delete preset functionality
"""

import logging
import os
import shutil
import subprocess
import sys
import uuid
import webbrowser
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Optional, Callable

import gradio as gr
from huggingface_hub import hf_hub_download

if TYPE_CHECKING:
    from modules import SharedServices

logger = logging.getLogger(__name__)

# File extensions by mode
STANDARD_EXTENSIONS = (".safetensors", ".ckpt", ".pt")
GGUF_EXTENSIONS = (".gguf",)
ALL_MODEL_EXTENSIONS = (".safetensors", ".ckpt", ".pt", ".gguf")


# =============================================================================
# BASE MODEL TYPES
# =============================================================================
# Base types define the underlying model architecture and determine:
# - clip_type for workflow selection
# - download configuration
# - default model suggestions

@dataclass
class BaseModelType:
    """Configuration for a base model type (architecture)."""
    id: str                          # Unique identifier
    label: str                       # Display name
    clip_type: str                   # "lumina2" or "flux2" for workflow selection
    
    # Default model filenames (standard mode)
    default_diffusion: str
    default_te: str
    default_vae: str
    # Optional secondary diffusion default (tried if default_diffusion not found)
    default_diffusion2: str = ""
    
    # Default model filenames (GGUF mode)
    default_diffusion_gguf: str = ""
    default_te_gguf: str = ""
    
    # Download configuration (list of MODEL_DOWNLOADS keys)
    download_keys_standard: list = field(default_factory=list)
    download_keys_gguf: list = field(default_factory=list)
    download_keys_gguf_bf16: list = field(default_factory=list)  # BF16 GGUF alternative (for Klein 9B)
    
    # Whether this type supports GGUF mode
    supports_gguf: bool = True
    
    # Whether this type supports edit workflows
    supports_edit: bool = False
    
    # Description shown in UI
    description: str = ""


# Define available base types
BASE_MODEL_TYPES = {
    "zimage": BaseModelType(
        id="zimage",
        label="Z-Image",
        clip_type="lumina2",
        default_diffusion="z_image_turbo_bf16.safetensors",
        default_te="qwen_3_4b.safetensors",
        default_vae="ae.safetensors",
        default_diffusion_gguf="z-image-turbo-q4_k_m.gguf",
        default_te_gguf="Qwen3-4B-Q4_K_M.gguf",
        download_keys_standard=["zimage_diffusion_bf16", "zimage_te_bf16", "zimage_vae"],
        download_keys_gguf=["zimage_diffusion_gguf", "zimage_te_gguf", "zimage_vae"],
        supports_gguf=True,
        description="Z-Image architecture (Lumina2-based)"
    ),
    "flux2_klein_4b": BaseModelType(
        id="flux2_klein_4b",
        label="Flux2 Klein 4B",
        clip_type="flux2",
        default_diffusion="flux-2-klein-4b-fp8.safetensors",
        default_te="qwen_3_4b.safetensors",
        default_vae="flux2-vae.safetensors",
        default_diffusion_gguf="flux-2-klein-4b-Q4_K_M.gguf",
        default_te_gguf="Qwen3-4B-Q4_K_M.gguf",
        download_keys_standard=["flux2_klein_4b_diffusion", "zimage_te_bf16", "flux2_vae"],
        download_keys_gguf=["flux2_klein_4b_diffusion_gguf", "zimage_te_gguf", "flux2_vae"],
        supports_gguf=True,
        supports_edit=True,
        description="Flux2 Klein 4B (uses 4B Qwen TE)"
    ),
    "flux2_klein_9b": BaseModelType(
        id="flux2_klein_9b",
        label="Flux2 Klein 9B",
        clip_type="flux2",
        default_diffusion="flux-2-klein-9b.safetensors",
        default_diffusion2="flux-2-klein-9b-fp8.safetensors",
        default_te="qwen_3_8b_fp8mixed.safetensors",
        default_vae="flux2-vae.safetensors",
        default_diffusion_gguf="flux-2-klein-9b-Q4_K_M.gguf",
        default_te_gguf="Qwen3-8B-Q4_K_M.gguf",
        download_keys_standard=["flux2_klein_9b_diffusion", "flux2_te_8b_bf16", "flux2_vae"],
        download_keys_gguf=["flux2_klein_9b_diffusion_gguf", "flux2_te_8b_gguf", "flux2_vae"],
        download_keys_gguf_bf16=["flux2_klein_9b_diffusion_gguf_bf16", "flux2_te_8b_gguf_bf16", "flux2_vae"],
        supports_gguf=True,
        supports_edit=True,
        description="Flux2 Klein 9B (uses 8B Qwen TE)"
    ),
    "krea2": BaseModelType(
        id="krea2",
        label="Krea2",
        clip_type="krea2",
        default_diffusion="krea2_turbo_fp8_scaled.safetensors",
        default_te="qwen3vl_4b_fp8_scaled.safetensors",
        default_vae="qwen_image_vae.safetensors",
        download_keys_standard=["krea2_diffusion", "krea2_te", "krea2_vae"],
        supports_gguf=False,
        description="Krea2 architecture (Qwen3-VL-4B based)"
    ),
}

BASE_TYPE_ORDER = ["zimage", "flux2_klein_4b", "flux2_klein_9b", "krea2"]


# =============================================================================
# USER PRESET DATA STRUCTURE
# =============================================================================

@dataclass
class UserPreset:
    """A user-customizable model preset."""
    id: str                    # Unique identifier (uuid)
    name: str                  # User-defined display name
    base_type: str             # Base model type ID (determines clip_type)
    use_gguf: bool             # Whether using GGUF mode
    diffusion: str             # Diffusion model filename
    text_encoder: str          # Text encoder filename
    vae: str                   # VAE filename
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "base_type": self.base_type,
            "use_gguf": self.use_gguf,
            "diffusion": self.diffusion,
            "text_encoder": self.text_encoder,
            "vae": self.vae,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> "UserPreset":
        return cls(
            id=data.get("id", str(uuid.uuid4())),
            name=data.get("name", "Unnamed"),
            base_type=data.get("base_type", "zimage"),
            use_gguf=data.get("use_gguf", False),
            diffusion=data.get("diffusion", ""),
            text_encoder=data.get("text_encoder", ""),
            vae=data.get("vae", ""),
        )
    
    @property
    def clip_type(self) -> str:
        """Get clip_type from base model type."""
        base = BASE_MODEL_TYPES.get(self.base_type, BASE_MODEL_TYPES["zimage"])
        return base.clip_type
    
    @property
    def supports_edit(self) -> bool:
        """Check if this preset's base type supports edit workflows."""
        base = BASE_MODEL_TYPES.get(self.base_type, BASE_MODEL_TYPES["zimage"])
        return base.supports_edit


def create_default_presets() -> list[UserPreset]:
    """Create default presets from base types."""
    presets = []
    for base_id in BASE_TYPE_ORDER:
        base = BASE_MODEL_TYPES[base_id]
        presets.append(UserPreset(
            id=f"default_{base_id}",
            name=f"⚡ {base.label}" if base_id == "zimage" else f"🎨 {base.label}" if base_id == "krea2" else f"🌊 {base.label}",
            base_type=base_id,
            use_gguf=False,
            diffusion=base.default_diffusion,
            text_encoder=base.default_te,
            vae=base.default_vae,
        ))
    return presets


def load_user_presets(settings_manager) -> tuple[list[UserPreset], str]:
    """Load user presets from settings. Returns (presets, active_preset_id)."""
    if settings_manager is None:
        presets = create_default_presets()
        return presets, presets[0].id if presets else ""
    
    data = settings_manager.get("model_presets_v2", None)
    if data is None:
        # Migration: check for old model_defaults format
        old_defaults = settings_manager.get("model_defaults", None)
        if old_defaults:
            # Migrate old format to new
            presets = create_default_presets()
            # Update the matching preset with old settings
            old_preset_id = old_defaults.get("preset", "zimage")
            for p in presets:
                if p.base_type == old_preset_id:
                    p.use_gguf = old_defaults.get("use_gguf", False)
                    p.diffusion = old_defaults.get("diffusion", p.diffusion)
                    p.text_encoder = old_defaults.get("text_encoder", p.text_encoder)
                    p.vae = old_defaults.get("vae", p.vae)
                    break
            return presets, presets[0].id
        else:
            presets = create_default_presets()
            return presets, presets[0].id if presets else ""
    
    presets = [UserPreset.from_dict(p) for p in data.get("presets", [])]
    active_id = data.get("active_preset", "")
    
    # Ensure we have at least the default presets
    if not presets:
        presets = create_default_presets()
        active_id = presets[0].id if presets else ""
    else:
        # Ensure all default presets exist (in case new base types were added)
        default_presets = create_default_presets()
        existing_default_ids = {p.id for p in presets if p.id.startswith("default_")}
        for dp in default_presets:
            if dp.id not in existing_default_ids:
                presets.append(dp)
                logger.info(f"Added missing default preset: {dp.name}")
            else:
                # Refresh default preset fields that come from BASE_MODEL_TYPES
                # (handles cases where defaults changed, e.g. diffusion filename update)
                for p in presets:
                    if p.id == dp.id:
                        p.name = dp.name
                        p.diffusion = dp.diffusion
                        p.text_encoder = dp.text_encoder
                        p.vae = dp.vae
                        break
    
    # Validate active_id exists
    if active_id and not any(p.id == active_id for p in presets):
        active_id = presets[0].id if presets else ""
    
    return presets, active_id


def save_user_presets(settings_manager, presets: list[UserPreset], active_id: str):
    """Save user presets to settings."""
    if settings_manager is None:
        return
    
    data = {
        "presets": [p.to_dict() for p in presets],
        "active_preset": active_id,
    }
    settings_manager.set("model_presets_v2", data)
    logger.info(f"Saved {len(presets)} presets, active: {active_id}")


def get_preset_by_id(presets: list[UserPreset], preset_id: str) -> UserPreset | None:
    """Find preset by ID."""
    for p in presets:
        if p.id == preset_id:
            return p
    return None


# =============================================================================
# MODEL DOWNLOADS CONFIGURATION
# =============================================================================

MODEL_DOWNLOADS = {
    # Z-Image Standard
    "zimage_diffusion_bf16": {
        "repo_id": "Comfy-Org/z_image_turbo",
        "filename": "split_files/diffusion_models/z_image_turbo_bf16.safetensors",
        "local_name": "z_image_turbo_bf16.safetensors",
        "folder_key": "diffusion",
        "label": "Z-Image Diffusion (bf16)",
        "size_gb": 12,
    },
    "zimage_te_bf16": {
        "repo_id": "Comfy-Org/z_image_turbo",
        "filename": "split_files/text_encoders/qwen_3_4b.safetensors",
        "local_name": "qwen_3_4b.safetensors",
        "folder_key": "text_encoder",
        "label": "Qwen3 4B TE (bf16)",
        "size_gb": 8,
    },
    "zimage_vae": {
        "repo_id": "Comfy-Org/z_image_turbo",
        "filename": "split_files/vae/ae.safetensors",
        "local_name": "ae.safetensors",
        "folder_key": "vae",
        "label": "Z-Image VAE",
        "size_gb": 0.3,
    },
    # Z-Image GGUF
    "zimage_diffusion_gguf": {
        "repo_id": "gguf-org/z-image-gguf",
        "filename": "z-image-turbo-q4_k_m.gguf",
        "local_name": "z-image-turbo-q4_k_m.gguf",
        "folder_key": "diffusion",
        "label": "Z-Image Diffusion (Q4)",
        "size_gb": 4.5,
    },
    "zimage_te_gguf": {
        "repo_id": "Qwen/Qwen3-4B-GGUF",
        "filename": "Qwen3-4B-Q4_K_M.gguf",
        "local_name": "Qwen3-4B-Q4_K_M.gguf",
        "folder_key": "text_encoder",
        "label": "Qwen3 4B TE (Q4)",
        "size_gb": 2.5,
    },
    # Flux2 VAE (shared by all Flux2 presets)
    "flux2_vae": {
        "repo_id": "Comfy-Org/flux2-dev",
        "filename": "split_files/vae/flux2-vae.safetensors",
        "local_name": "flux2-vae.safetensors",
        "folder_key": "vae",
        "label": "Flux2 VAE",
        "size_gb": 0.3,
    },
    # Flux2 Klein 4B Standard
    "flux2_klein_4b_diffusion": {
        "repo_id": "black-forest-labs/FLUX.2-klein-4B-fp8",
        "filename": "flux-2-klein-4b-fp8.safetensors",
        "local_name": "flux-2-klein-4b-fp8.safetensors",
        "folder_key": "diffusion",
        "label": "Klein 4B (fp8)",
        "size_gb": 4,
    },
    # Flux2 Klein 9B Standard (GATED!)
    "flux2_klein_9b_diffusion": {
        "repo_id": "black-forest-labs/FLUX.2-klein-9B",
        "filename": "flux-2-klein-9b-fp8.safetensors",
        "local_name": "flux-2-klein-9b-fp8.safetensors",
        "folder_key": "diffusion",
        "label": "Klein 9B (fp8)",
        "size_gb": 9,
        "is_gated": True,
        "gated_url": "https://huggingface.co/black-forest-labs/FLUX.2-klein-9b-fp8/tree/main",
    },
    # Flux2 Klein 4B GGUF Q4
    "flux2_klein_4b_diffusion_gguf": {
        "repo_id": "unsloth/FLUX.2-klein-4B-GGUF",
        "filename": "flux-2-klein-4b-Q4_K_M.gguf",
        "local_name": "flux-2-klein-4b-Q4_K_M.gguf",
        "folder_key": "diffusion",
        "label": "Klein 4B (Q4)",
        "size_gb": 2.5,
    },
    # Flux2 Klein 9B GGUF Q4
    "flux2_klein_9b_diffusion_gguf": {
        "repo_id": "unsloth/FLUX.2-klein-9B-GGUF",
        "filename": "flux-2-klein-9b-Q4_K_M.gguf",
        "local_name": "flux-2-klein-9b-Q4_K_M.gguf",
        "folder_key": "diffusion",
        "label": "Klein 9B (Q4)",
        "size_gb": 6,
    },
    # Flux2 Klein 9B GGUF BF16 (full precision, ungated alternative)
    "flux2_klein_9b_diffusion_gguf_bf16": {
        "repo_id": "unsloth/FLUX.2-klein-9B-GGUF",
        "filename": "flux-2-klein-9b-BF16.gguf",
        "local_name": "flux-2-klein-9b-BF16.gguf",
        "folder_key": "diffusion",
        "label": "Klein 9B (BF16 GGUF)",
        "size_gb": 18,
    },
    # Qwen3 8B TE Standard (for Flux2 Klein 9B)
    "flux2_te_8b_bf16": {
        "repo_id": "Comfy-Org/vae-text-encorder-for-flux-klein-9b",
        "filename": "split_files/text_encoders/qwen_3_8b_fp8mixed.safetensors",
        "local_name": "qwen_3_8b_fp8mixed.safetensors",
        "folder_key": "text_encoder",
        "label": "Qwen3 8B TE (fp8)",
        "size_gb": 8,
    },
    # Qwen3 8B TE GGUF Q4
    "flux2_te_8b_gguf": {
        "repo_id": "unsloth/Qwen3-8B-GGUF",
        "filename": "Qwen3-8B-Q4_K_M.gguf",
        "local_name": "Qwen3-8B-Q4_K_M.gguf",
        "folder_key": "text_encoder",
        "label": "Qwen3 8B TE (Q4)",
        "size_gb": 5,
    },
    # Qwen3 8B TE GGUF BF16 (full precision)
    "flux2_te_8b_gguf_bf16": {
        "repo_id": "unsloth/Qwen3-8B-GGUF",
        "filename": "Qwen3-8B-BF16.gguf",
        "local_name": "Qwen3-8B-BF16.gguf",
        "folder_key": "text_encoder",
        "label": "Qwen3 8B TE (BF16 GGUF)",
        "size_gb": 16,
    },
    # Krea2 Standard
    "krea2_diffusion": {
        "repo_id": "Comfy-Org/Krea-2",
        "filename": "diffusion_models/krea2_turbo_fp8_scaled.safetensors",
        "local_name": "krea2_turbo_fp8_scaled.safetensors",
        "folder_key": "diffusion",
        "label": "Krea2 Diffusion (fp8)",
        "size_gb": 13,
    },
    "krea2_te": {
        "repo_id": "Comfy-Org/Krea-2",
        "filename": "text_encoders/qwen3vl_4b_fp8_scaled.safetensors",
        "local_name": "qwen3vl_4b_fp8_scaled.safetensors",
        "folder_key": "text_encoder",
        "label": "Qwen3-VL 4B TE (fp8)",
        "size_gb": 5,
    },
    "krea2_vae": {
        "repo_id": "Comfy-Org/Krea-2",
        "filename": "vae/qwen_image_vae.safetensors",
        "local_name": "qwen_image_vae.safetensors",
        "folder_key": "vae",
        "label": "Krea2 VAE",
        "size_gb": 0.25,
    },
}


# =============================================================================
# DOWNLOAD HELPERS
# =============================================================================

def get_download_size(keys: list) -> float:
    """Calculate total download size in GB for a list of download keys."""
    total = 0.0
    for key in keys:
        info = MODEL_DOWNLOADS.get(key, {})
        total += info.get("size_gb", 0)
    return total


def has_gated_model(keys: list) -> tuple[bool, str | None]:
    """Check if any model in the list is gated. Returns (is_gated, gated_url)."""
    for key in keys:
        info = MODEL_DOWNLOADS.get(key, {})
        if info.get("is_gated", False):
            return True, info.get("gated_url")
    return False, None


def get_download_button_label(base_type_id: str, is_gguf: bool, include_size: bool = True) -> str:
    """Generate download button label with model name, mode, and size."""
    base = BASE_MODEL_TYPES.get(base_type_id, BASE_MODEL_TYPES["zimage"])
    keys = base.download_keys_gguf if is_gguf else base.download_keys_standard
    
    # Check if gated
    is_gated, _ = has_gated_model(keys)
    if is_gated:
        return f"⚠️ {base.label} (Gated - Manual Download)"
    
    # Build label
    mode_suffix = " Q4" if is_gguf else ""
    size = get_download_size(keys)
    
    if include_size:
        return f"⬇️ Download {base.label}{mode_suffix} ({size:.0f}GB)"
    return f"⬇️ Download {base.label}{mode_suffix}"


def get_individual_button_labels(base_type_id: str, is_gguf: bool) -> tuple[str, str, str]:
    """Get labels for individual download buttons (diffusion, TE, VAE)."""
    base = BASE_MODEL_TYPES.get(base_type_id, BASE_MODEL_TYPES["zimage"])
    keys = base.download_keys_gguf if is_gguf else base.download_keys_standard
    
    diff_label = "⬇️ Diffusion"
    te_label = "⬇️ Text Encoder"
    vae_label = "⬇️ VAE"
    
    for key in keys:
        info = MODEL_DOWNLOADS.get(key, {})
        folder = info.get("folder_key")
        size = info.get("size_gb", 0)
        is_gated = info.get("is_gated", False)
        
        if folder == "diffusion":
            if is_gated:
                diff_label = f"🔗 Diffusion (Gated)"
            else:
                diff_label = f"⬇️ Diffusion ({size:.1f}GB)" if size < 10 else f"⬇️ Diffusion ({size:.0f}GB)"
        elif folder == "text_encoder":
            te_label = f"⬇️ TE ({size:.1f}GB)" if size < 10 else f"⬇️ TE ({size:.0f}GB)"
        elif folder == "vae":
            vae_label = f"⬇️ VAE ({size:.1f}GB)"
    
    return diff_label, te_label, vae_label


# =============================================================================
# MODEL SCANNING UTILITIES
# =============================================================================

def scan_models(folder: Path, extensions: tuple = ALL_MODEL_EXTENSIONS, name_filter: str = None) -> list:
    """Scan folder recursively for model files, returning relative paths."""
    if not folder.exists():
        return []
    models = []
    for ext in extensions:
        for f in folder.rglob(f"*{ext}"):
            rel_path = str(f.relative_to(folder))
            if name_filter is None or name_filter.lower() in rel_path.lower():
                models.append(rel_path)
    return sorted(models)


def get_models_by_mode(folder: Path, is_gguf: bool) -> list:
    """Get models filtered by mode (standard vs GGUF)."""
    extensions = GGUF_EXTENSIONS if is_gguf else STANDARD_EXTENSIONS
    return scan_models(folder, extensions)


def get_default_model(choices: list, preferred: str, fallbacks: list = None) -> str | None:
    """Get default model from choices.

    Match priority:
    1. Exact filename match for preferred
    2. Exact stem match for preferred (handles extension differences)
    3. Repeat 1+2 for each entry in fallbacks list
    4. None — never silently picks a wrong model
    """
    if not choices:
        return None

    def _match(name: str) -> str | None:
        if not name:
            return None
        if name in choices:
            return name
        stem = name.rsplit(".", 1)[0].lower()
        for c in choices:
            if c.rsplit(".", 1)[0].lower() == stem:
                return c
        return None

    result = _match(preferred)
    if result:
        return result

    for fb in (fallbacks or []):
        result = _match(fb)
        if result:
            return result

    return None


def check_model_exists(folder: Path, filename: str) -> bool:
    """Check if a model file exists."""
    return (folder / filename).exists() if filename else False


def validate_models(unet_name: str, clip_name: str, vae_name: str,
                   diffusion_dir: Path, text_encoders_dir: Path, vae_dir: Path) -> tuple[bool, str]:
    """Validate that selected model files exist. Returns (valid, error_message)."""
    missing = []
    if not check_model_exists(diffusion_dir, unet_name):
        missing.append(f"Diffusion: {unet_name}")
    if not check_model_exists(text_encoders_dir, clip_name):
        missing.append(f"Text Encoder: {clip_name}")
    if not check_model_exists(vae_dir, vae_name):
        missing.append(f"VAE: {vae_name}")
    
    if missing:
        return False, "Missing models:\n• " + "\n• ".join(missing)
    return True, ""


# =============================================================================
# MODEL DOWNLOAD FUNCTIONS
# =============================================================================

def download_model(model_key: str, models_dir: Path, progress=None) -> str:
    """Download a model from HuggingFace Hub to the appropriate folder."""
    if model_key not in MODEL_DOWNLOADS:
        return f"❌ Unknown model: {model_key}"
    
    info = MODEL_DOWNLOADS[model_key]
    repo_id = info["repo_id"]
    filename = info["filename"]
    local_name = info["local_name"]
    folder_key = info["folder_key"]
    label = info["label"]
    
    folder_map = {
        "diffusion": models_dir / "diffusion_models",
        "text_encoder": models_dir / "text_encoders",
        "vae": models_dir / "vae",
    }
    folder = folder_map.get(folder_key, models_dir)
    dest_path = folder / local_name
    
    if dest_path.exists():
        return f"✓ {label} already installed"
    
    folder.mkdir(parents=True, exist_ok=True)
    
    try:
        logger.info(f"Downloading {label}: {repo_id}/{filename}")
        if progress:
            progress(0, desc=f"Downloading {label}...")
        
        downloaded_path = hf_hub_download(
            repo_id=repo_id,
            filename=filename,
            local_dir=folder,
            local_dir_use_symlinks=False,
        )
        
        downloaded_path = Path(downloaded_path)
        if downloaded_path != dest_path and downloaded_path.exists():
            shutil.move(str(downloaded_path), str(dest_path))
            for parent in downloaded_path.parents:
                if parent != folder and parent.is_dir() and not any(parent.iterdir()):
                    parent.rmdir()
        
        logger.info(f"Downloaded: {dest_path}")
        if progress:
            progress(1, desc="Done")
        return f"✓ {label} downloaded"
        
    except Exception as e:
        logger.error(f"Download failed for {label}: {e}")
        return f"❌ {label} failed: {e}"


def download_base_type_models(base_type_id: str, is_gguf: bool, models_dir: Path, progress=None) -> str:
    """Download all models for a base type."""
    if base_type_id not in BASE_MODEL_TYPES:
        return f"❌ Unknown base type: {base_type_id}"
    
    base = BASE_MODEL_TYPES[base_type_id]
    keys = base.download_keys_gguf if is_gguf else base.download_keys_standard
    
    if not keys:
        return f"❌ No download configuration for {base.label}"
    
    results = []
    for i, key in enumerate(keys):
        if progress:
            progress(i / len(keys), desc=f"Downloading {MODEL_DOWNLOADS.get(key, {}).get('label', key)}...")
        result = download_model(key, models_dir, progress)
        results.append(result)
    
    if progress:
        progress(1, desc="Done")
    return "\n".join(results)


def open_folder(folder_path: Path):
    """Cross-platform folder opener."""
    folder_path.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        os.startfile(folder_path)
    elif sys.platform == "darwin":
        subprocess.run(["open", str(folder_path)])
    else:
        subprocess.run(["xdg-open", str(folder_path)])


# =============================================================================
# UI COMPONENT DATACLASSES
# =============================================================================

@dataclass 
class ModelComponents:
    """Container for model selection UI components."""
    # Quick preset selector (for main UI, outside accordion)
    quick_preset: gr.Dropdown
    
    # Inside accordion - editing controls
    base_type_dropdown: gr.Dropdown
    use_gguf: gr.Radio
    unet_name: gr.Dropdown
    clip_name: gr.Dropdown
    vae_name: gr.Dropdown
    
    # Preset management
    preset_name_input: gr.Textbox
    save_preset_btn: gr.Button
    delete_preset_btn: gr.Button
    
    # Status
    status_text: gr.Textbox
    
    # Download section
    download_btn: gr.Button
    download_bf16_btn: gr.Button  # BF16 GGUF alternative (for Klein 9B)
    dl_diffusion_btn: gr.Button
    dl_te_btn: gr.Button
    dl_vae_btn: gr.Button
    open_diffusion_btn: gr.Button
    open_te_btn: gr.Button
    open_vae_btn: gr.Button
    
    # Hidden states
    clip_type_state: gr.State
    presets_state: gr.State  # Stores list of UserPreset dicts
    
    # Configuration flags
    edit_only: bool = False  # Whether to filter for edit-compatible presets only


def get_base_type_choices(edit_only: bool = False) -> list:
    """Get base type choices for dropdown."""
    choices = []
    for bid in BASE_TYPE_ORDER:
        base = BASE_MODEL_TYPES[bid]
        if edit_only and not base.supports_edit:
            continue
        choices.append((base.label, bid))
    return choices


def get_preset_dropdown_choices(presets: list[UserPreset], edit_only: bool = False, include_manual: bool = True) -> list:
    """Get preset choices for quick selector dropdown.
    
    Args:
        presets: List of user presets
        edit_only: If True, only include presets that support edit workflows
        include_manual: If True, add a "Manual" option at the top that uses current model selections
    """
    choices = []
    
    # Add manual option first (uses whatever is currently selected in dropdowns)
    if include_manual:
        choices.append(("— Manual [Selected in Model section below] —", ""))
    
    for p in presets:
        if edit_only and not p.supports_edit:
            continue
        choices.append((p.name, p.id))
    return choices


# =============================================================================
# QUICK PRESET SELECTOR (for main UI)
# =============================================================================

def create_quick_preset_selector(
    settings_manager=None,
    label: str = "Model Preset",
    edit_only: bool = False,
    default_to_manual: bool = False,
) -> tuple[gr.Dropdown, gr.State, gr.State]:
    """
    Create a quick preset selector dropdown for the main UI.
    
    Args:
        settings_manager: Settings manager for loading presets
        label: Label for the dropdown
        edit_only: If True, only show presets that support edit workflows
        default_to_manual: If True, default to "Manual" mode instead of active preset
    
    Returns:
        Tuple of (dropdown, clip_type_state, presets_state)
    """
    presets, active_id = load_user_presets(settings_manager)
    
    # Filter presets if edit_only
    if edit_only:
        filtered_presets = [p for p in presets if p.supports_edit]
        # If active preset doesn't support edit, select first that does
        if not any(p.id == active_id for p in filtered_presets):
            active_id = filtered_presets[0].id if filtered_presets else ""
    else:
        filtered_presets = presets
    
    # Default to manual mode if requested
    if default_to_manual:
        active_id = ""
    
    active_preset = get_preset_by_id(presets, active_id)
    
    # For manual mode or edit_only, default clip_type to flux2
    default_clip_type = "flux2" if (not active_preset or edit_only) else active_preset.clip_type
    
    quick_preset = gr.Dropdown(
        label=label,
        choices=get_preset_dropdown_choices(presets, edit_only),
        value=active_id,
        scale=1,
    )
    
    clip_type_state = gr.State(value=active_preset.clip_type if active_preset else default_clip_type)
    presets_state = gr.State(value=[p.to_dict() for p in presets])
    
    return quick_preset, clip_type_state, presets_state


# =============================================================================
# MODEL ACCORDION UI
# =============================================================================

def create_model_ui(
    models_dir: Path,
    accordion_label: str = "🔧 Models",
    accordion_open: bool = False,
    settings_manager=None,
    quick_preset_dropdown: gr.Dropdown = None,
    clip_type_state: gr.State = None,
    presets_state: gr.State = None,
    edit_only: bool = False,
) -> ModelComponents:
    """
    Create the model configuration accordion UI.
    
    Args:
        models_dir: Path to ComfyUI models directory
        accordion_label: Label for the accordion
        accordion_open: Whether accordion starts open
        settings_manager: Settings manager for loading/saving presets
        quick_preset_dropdown: External quick preset dropdown to sync with
        clip_type_state: External clip_type state to sync with
        presets_state: External presets state to sync with
        edit_only: If True, only show base types that support edit workflows
        
    Returns:
        ModelComponents dataclass with all UI components
    """
    diffusion_dir = models_dir / "diffusion_models"
    text_encoders_dir = models_dir / "text_encoders"
    vae_dir = models_dir / "vae"
    
    # Load presets
    presets, active_id = load_user_presets(settings_manager)
    active_preset = get_preset_by_id(presets, active_id)
    
    if active_preset is None and presets:
        active_preset = presets[0]
        active_id = active_preset.id
    
    # For edit_only mode, ensure we have an edit-compatible preset selected
    if edit_only and active_preset and not active_preset.supports_edit:
        # Find first edit-compatible preset
        for p in presets:
            if p.supports_edit:
                active_preset = p
                active_id = p.id
                break
    
    # Get initial model lists
    is_gguf = active_preset.use_gguf if active_preset else False
    base_type = active_preset.base_type if active_preset else "flux2_klein_4b"
    
    # Ensure base_type is valid for edit_only mode
    if edit_only:
        base = BASE_MODEL_TYPES.get(base_type)
        if not base or not base.supports_edit:
            # Active preset isn't edit-compatible — fall back to first that is
            for bid in BASE_TYPE_ORDER:
                if BASE_MODEL_TYPES[bid].supports_edit:
                    base_type = bid
                    break
    
    diff_models = get_models_by_mode(diffusion_dir, is_gguf) or [""]
    te_models = get_models_by_mode(text_encoders_dir, is_gguf) or [""]
    vae_models = scan_models(vae_dir, STANDARD_EXTENSIONS) or [""]
    
    # Check if any models are missing
    needs_setup = not (diff_models and te_models and vae_models)
    
    with gr.Accordion(accordion_label, open=accordion_open or needs_setup):
        gr.Markdown("*Configure and save model presets for quick switching.*")
        
        # If no external quick_preset provided, create internal one
        if quick_preset_dropdown is None:
            quick_preset = gr.Dropdown(
                label="Active Preset",
                choices=get_preset_dropdown_choices(presets, edit_only),
                value="",  # Default to Manual mode
            )
        else:
            quick_preset = quick_preset_dropdown
        
        gr.Markdown("---")
        
        # Base type and mode selection
        with gr.Row():
            base_type_dropdown = gr.Dropdown(
                label="Base Model Type",
                choices=get_base_type_choices(edit_only=edit_only),
                value=base_type,
                scale=2,
                info="Determines workflow compatibility"
            )
            use_gguf = gr.Radio(
                choices=[("Standard", False), ("GGUF", True)],
                value=is_gguf,
                label="Mode",
                scale=1,
                info="GGUF = lower VRAM"
            )
        
        # Model dropdowns
        _active_base = BASE_MODEL_TYPES.get(active_preset.base_type if active_preset else "zimage", BASE_MODEL_TYPES["zimage"])
        _diff_fallbacks = [_active_base.default_diffusion2] if (active_preset and not active_preset.use_gguf and _active_base.default_diffusion2) else []
        unet_name = gr.Dropdown(
            label="Diffusion Model",
            choices=diff_models,
            value=get_default_model(diff_models, active_preset.diffusion if active_preset else "", _diff_fallbacks),
            allow_custom_value=True
        )
        clip_name = gr.Dropdown(
            label="Text Encoder", 
            choices=te_models,
            value=get_default_model(te_models, active_preset.text_encoder if active_preset else ""),
            allow_custom_value=True
        )
        vae_name = gr.Dropdown(
            label="VAE",
            choices=vae_models,
            value=get_default_model(vae_models, active_preset.vae if active_preset else ""),
            allow_custom_value=True
        )
        
        # Preset management - Save creates NEW presets, Delete removes selected preset
        gr.Markdown("---")
        gr.Markdown("**Save New Preset**")
        with gr.Row():
            preset_name_input = gr.Textbox(
                label="New Preset Name",
                value="",
                placeholder="Enter name for new preset...",
                scale=2,
                show_label=False,
                container=False
            )
            save_preset_btn = gr.Button("💾 Save as New", size="sm", variant="primary", scale=1)
        
        gr.Markdown("**Manage Presets**")
        with gr.Row():
            delete_preset_btn = gr.Button("🗑️ Delete Active Preset", size="sm", variant="stop")
        
        # Status
        status_text = gr.Textbox(
            label="Status",
            interactive=False,
            show_label=False,
            lines=1,
            value="",
            container=False
        )
        
        # Download section
        # Get initial button labels
        main_btn_label = get_download_button_label(base_type, is_gguf)
        diff_label, te_label, vae_label = get_individual_button_labels(base_type, is_gguf)
        
        # Check if BF16 GGUF option should be shown (Klein 9B + GGUF mode)
        base_config = BASE_MODEL_TYPES.get(base_type, BASE_MODEL_TYPES["zimage"])
        show_bf16_btn = is_gguf and base_config.download_keys_gguf_bf16
        bf16_size = get_download_size(base_config.download_keys_gguf_bf16) if show_bf16_btn else 0
        
        with gr.Accordion("📦 Download Models", open=needs_setup):
            download_btn = gr.Button(
                main_btn_label,
                variant="primary",
                size="sm"
            )
            
            # BF16 GGUF button (only for Klein 9B in GGUF mode)
            download_bf16_btn = gr.Button(
                f"⬇️ Download BF16 GGUF ({bf16_size:.0f}GB)" if show_bf16_btn else "⬇️ BF16 GGUF",
                variant="secondary",
                size="sm",
                visible=show_bf16_btn
            )
            
            # Klein 9B info note
            klein_9b_note = gr.Markdown(
                "*ℹ️ Klein 9B Standard is gated. Use GGUF mode, or [manually download](https://huggingface.co/black-forest-labs/FLUX.2-klein-9b-fp8/tree/main). "
                "For GGUF, Q8_0 (10GB) offers a quality/size balance.*",
                visible=(base_type == "flux2_klein_9b")
            )
            
            gr.Markdown("*Or download individually:*")
            with gr.Row():
                dl_diffusion_btn = gr.Button(diff_label, size="sm")
                dl_te_btn = gr.Button(te_label, size="sm")
                dl_vae_btn = gr.Button(vae_label, size="sm")
            
            gr.Markdown("---")
            gr.Markdown("*Browse repos for other quants. The appropriate model folder buttons also below:*")
            with gr.Row():
                gr.Button("🔗 Z-Image GGUF", size="sm", link="https://huggingface.co/gguf-org/z-image-gguf/tree/main")
                gr.Button("🔗 Qwen3 4B GGUF", size="sm", link="https://huggingface.co/Qwen/Qwen3-4B-GGUF/tree/main")

            with gr.Row():
                gr.Button("🔗 Klein 4B GGUF", size="sm", link="https://huggingface.co/unsloth/FLUX.2-klein-4B-GGUF/tree/main")
                gr.Button("🔗 Klein 9B GGUF", size="sm", link="https://huggingface.co/unsloth/FLUX.2-klein-9B-GGUF/tree/main")
                gr.Button("🔗 Qwen3 8B GGUF", size="sm", link="https://huggingface.co/unsloth/Qwen3-8B-GGUF/tree/main")
            
            gr.Markdown("---")
            with gr.Row():
                open_diffusion_btn = gr.Button("📂 diffusion_models", size="sm")
                open_te_btn = gr.Button("📂 text_encoders", size="sm")
                open_vae_btn = gr.Button("📂 vae", size="sm")
        
        # Hidden states (use external if provided)
        if clip_type_state is None:
            clip_type_state = gr.State(value=active_preset.clip_type if active_preset else "lumina2")
        if presets_state is None:
            presets_state = gr.State(value=[p.to_dict() for p in presets])
    
    # Store references for dynamic updates
    base_type_dropdown._download_btn = download_btn
    base_type_dropdown._download_bf16_btn = download_bf16_btn
    base_type_dropdown._klein_9b_note = klein_9b_note
    base_type_dropdown._dl_diffusion_btn = dl_diffusion_btn
    base_type_dropdown._dl_te_btn = dl_te_btn
    base_type_dropdown._dl_vae_btn = dl_vae_btn
    
    return ModelComponents(
        quick_preset=quick_preset,
        base_type_dropdown=base_type_dropdown,
        use_gguf=use_gguf,
        unet_name=unet_name,
        clip_name=clip_name,
        vae_name=vae_name,
        preset_name_input=preset_name_input,
        save_preset_btn=save_preset_btn,
        delete_preset_btn=delete_preset_btn,
        status_text=status_text,
        download_btn=download_btn,
        download_bf16_btn=download_bf16_btn,
        dl_diffusion_btn=dl_diffusion_btn,
        dl_te_btn=dl_te_btn,
        dl_vae_btn=dl_vae_btn,
        open_diffusion_btn=open_diffusion_btn,
        open_te_btn=open_te_btn,
        open_vae_btn=open_vae_btn,
        clip_type_state=clip_type_state,
        presets_state=presets_state,
        edit_only=edit_only,
    )


# =============================================================================
# EVENT HANDLER SETUP
# =============================================================================

def setup_model_handlers(
    model_components: ModelComponents,
    models_dir: Path,
    settings_manager=None,
    edit_only: bool = None,
):
    """
    Wire up event handlers for model UI components.
    
    Args:
        model_components: ModelComponents from create_model_ui
        models_dir: Path to ComfyUI models directory
        settings_manager: Settings manager for saving presets
        edit_only: If True, filter presets/base types for edit compatibility.
                   If None, uses the value from model_components.edit_only
    """
    # Use edit_only from model_components if not explicitly provided
    if edit_only is None:
        edit_only = model_components.edit_only
    
    diffusion_dir = models_dir / "diffusion_models"
    text_encoders_dir = models_dir / "text_encoders"
    vae_dir = models_dir / "vae"
    
    mc = model_components
    
    # =========================================================================
    # Helper: Refresh model dropdowns based on mode
    # =========================================================================
    def refresh_model_dropdowns(is_gguf: bool, current_diff: str, current_te: str, current_vae: str):
        """Refresh model dropdown choices based on GGUF mode."""
        diff_models = get_models_by_mode(diffusion_dir, is_gguf) or [""]
        te_models = get_models_by_mode(text_encoders_dir, is_gguf) or [""]
        vae_models = scan_models(vae_dir, STANDARD_EXTENSIONS) or [""]
        
        return (
            gr.update(choices=diff_models, value=get_default_model(diff_models, current_diff)),
            gr.update(choices=te_models, value=get_default_model(te_models, current_te)),
            gr.update(choices=vae_models, value=get_default_model(vae_models, current_vae)),
        )
    
    # =========================================================================
    # Quick Preset Selection - Updates models for inference (not the editor name)
    # =========================================================================
    def _gguf_radio_update(base_type_id, value=False):
        base = BASE_MODEL_TYPES.get(base_type_id, BASE_MODEL_TYPES["zimage"])
        choices = [("Standard", False)]
        if base.supports_gguf:
            choices.append(("GGUF", True))
        return gr.update(choices=choices, value=value)
    
    def on_quick_preset_change(preset_id: str, presets_data: list, current_base_type: str):
        """When user selects a preset, load its models for inference.
        
        If preset_id is empty ("Manual" mode), keep current model selections.
        """
        # Manual mode - keep current selections, just update clip_type from base_type
        if not preset_id:
            base = BASE_MODEL_TYPES.get(current_base_type, BASE_MODEL_TYPES["zimage"])
            return (
                gr.update(),  # base_type - keep current
                _gguf_radio_update(current_base_type),  # use_gguf - restricted choices
                gr.update(),  # unet_name - keep current
                gr.update(),  # clip_name - keep current
                gr.update(),  # vae_name - keep current
                base.clip_type,  # clip_type from current base_type
                gr.update(),  # download_btn - keep current
                gr.update(),  # download_bf16_btn - keep current
                gr.update(),  # klein_9b_note - keep current
                gr.update(),  # dl_diffusion_btn - keep current
                gr.update(),  # dl_te_btn - keep current
                gr.update(),  # dl_vae_btn - keep current
            )
        
        presets = [UserPreset.from_dict(p) for p in presets_data]
        preset = get_preset_by_id(presets, preset_id)
        
        if preset is None:
            return (
                gr.update(),  # base_type
                _gguf_radio_update("zimage"),  # use_gguf - restricted choices (default zimage)
                gr.update(),  # unet_name
                gr.update(),  # clip_name
                gr.update(),  # vae_name
                "lumina2",    # clip_type
                gr.update(),  # download_btn
                gr.update(),  # download_bf16_btn
                gr.update(),  # klein_9b_note
                gr.update(),  # dl_diffusion_btn
                gr.update(),  # dl_te_btn
                gr.update(),  # dl_vae_btn
            )
        
        # Save active preset to settings
        if settings_manager:
            save_user_presets(settings_manager, presets, preset_id)
        
        # Get model lists for this preset's mode
        diff_models = get_models_by_mode(diffusion_dir, preset.use_gguf) or [""]
        te_models = get_models_by_mode(text_encoders_dir, preset.use_gguf) or [""]
        vae_models = scan_models(vae_dir, STANDARD_EXTENSIONS) or [""]
        
        # Get download button labels
        base = BASE_MODEL_TYPES.get(preset.base_type, BASE_MODEL_TYPES["zimage"])
        main_btn_label = get_download_button_label(preset.base_type, preset.use_gguf)
        diff_label, te_label, vae_label = get_individual_button_labels(preset.base_type, preset.use_gguf)
        
        # BF16 GGUF button visibility
        show_bf16 = preset.use_gguf and base.download_keys_gguf_bf16
        bf16_size = get_download_size(base.download_keys_gguf_bf16) if show_bf16 else 0
        bf16_label = f"⬇️ Download BF16 GGUF ({bf16_size:.0f}GB)" if show_bf16 else "⬇️ BF16 GGUF"
        
        # Klein 9B note visibility
        show_note = (preset.base_type == "flux2_klein_9b")
        
        # Update editor to show this preset's config (but NOT the name field)
        return (
            preset.base_type,
            _gguf_radio_update(preset.base_type, preset.use_gguf),
            gr.update(choices=diff_models, value=get_default_model(diff_models, preset.diffusion)),
            gr.update(choices=te_models, value=get_default_model(te_models, preset.text_encoder)),
            gr.update(choices=vae_models, value=get_default_model(vae_models, preset.vae)),
            preset.clip_type,
            gr.update(value=main_btn_label),
            gr.update(value=bf16_label, visible=show_bf16),
            gr.update(visible=show_note),
            gr.update(value=diff_label),
            gr.update(value=te_label),
            gr.update(value=vae_label),
        )
    
    mc.quick_preset.change(
        fn=on_quick_preset_change,
        inputs=[mc.quick_preset, mc.presets_state, mc.base_type_dropdown],
        outputs=[
            mc.base_type_dropdown,
            mc.use_gguf,
            mc.unet_name,
            mc.clip_name,
            mc.vae_name,
            mc.clip_type_state,
            mc.download_btn,
            mc.download_bf16_btn,
            mc.base_type_dropdown._klein_9b_note,
            mc.dl_diffusion_btn,
            mc.dl_te_btn,
            mc.dl_vae_btn,
        ]
    )
    
    # =========================================================================
    # Base Type Change - Update clip_type and download button
    # =========================================================================
    def on_base_type_change(base_type_id: str, is_gguf: bool):
        """When base type changes, update clip_type and suggest default models."""
        base = BASE_MODEL_TYPES.get(base_type_id, BASE_MODEL_TYPES["zimage"])
        
        # Get suggested defaults for this base type
        if is_gguf:
            diff_default = base.default_diffusion_gguf
            diff_fallback = []
            te_default = base.default_te_gguf
        else:
            diff_default = base.default_diffusion
            diff_fallback = [base.default_diffusion2] if base.default_diffusion2 else []
            te_default = base.default_te
        vae_default = base.default_vae
        
        # Get model lists
        diff_models = get_models_by_mode(diffusion_dir, is_gguf) or [""]
        te_models = get_models_by_mode(text_encoders_dir, is_gguf) or [""]
        vae_models = scan_models(vae_dir, STANDARD_EXTENSIONS) or [""]
        
        # Update download button labels
        main_btn_label = get_download_button_label(base_type_id, is_gguf)
        diff_label, te_label, vae_label = get_individual_button_labels(base_type_id, is_gguf)
        
        # BF16 GGUF button visibility (only for Klein 9B in GGUF mode)
        show_bf16 = is_gguf and base.download_keys_gguf_bf16
        bf16_size = get_download_size(base.download_keys_gguf_bf16) if show_bf16 else 0
        bf16_label = f"⬇️ Download BF16 GGUF ({bf16_size:.0f}GB)" if show_bf16 else "⬇️ BF16 GGUF"
        
        # Klein 9B note visibility
        show_note = (base_type_id == "flux2_klein_9b")
        
        return (
            gr.update(choices=diff_models, value=get_default_model(diff_models, diff_default, diff_fallback)),
            gr.update(choices=te_models, value=get_default_model(te_models, te_default)),
            gr.update(choices=vae_models, value=get_default_model(vae_models, vae_default)),
            base.clip_type,
            _gguf_radio_update(base_type_id, False if not base.supports_gguf else is_gguf),
            gr.update(value=main_btn_label),
            gr.update(value=bf16_label, visible=show_bf16),
            gr.update(visible=show_note),
            gr.update(value=diff_label),
            gr.update(value=te_label),
            gr.update(value=vae_label),
        )
    
    mc.base_type_dropdown.change(
        fn=on_base_type_change,
        inputs=[mc.base_type_dropdown, mc.use_gguf],
        outputs=[
            mc.unet_name,
            mc.clip_name,
            mc.vae_name,
            mc.clip_type_state,
            mc.use_gguf,
            mc.base_type_dropdown._download_btn,
            mc.base_type_dropdown._download_bf16_btn,
            mc.base_type_dropdown._klein_9b_note,
            mc.base_type_dropdown._dl_diffusion_btn,
            mc.base_type_dropdown._dl_te_btn,
            mc.base_type_dropdown._dl_vae_btn,
        ]
    )
    
    # =========================================================================
    # Mode Change - Refresh model lists and download buttons
    # =========================================================================
    def on_mode_change(base_type_id: str, is_gguf: bool):
        """When GGUF mode changes, refresh model lists with appropriate extensions."""
        base = BASE_MODEL_TYPES.get(base_type_id, BASE_MODEL_TYPES["zimage"])
        
        if is_gguf:
            diff_default = base.default_diffusion_gguf
            diff_fallback = []
            te_default = base.default_te_gguf
        else:
            diff_default = base.default_diffusion
            diff_fallback = [base.default_diffusion2] if base.default_diffusion2 else []
            te_default = base.default_te
        vae_default = base.default_vae
        
        diff_models = get_models_by_mode(diffusion_dir, is_gguf) or [""]
        te_models = get_models_by_mode(text_encoders_dir, is_gguf) or [""]
        vae_models = scan_models(vae_dir, STANDARD_EXTENSIONS) or [""]
        
        # Update download button labels
        main_btn_label = get_download_button_label(base_type_id, is_gguf)
        diff_label, te_label, vae_label = get_individual_button_labels(base_type_id, is_gguf)
        
        # BF16 GGUF button visibility (only for Klein 9B in GGUF mode)
        show_bf16 = is_gguf and base.download_keys_gguf_bf16
        bf16_size = get_download_size(base.download_keys_gguf_bf16) if show_bf16 else 0
        bf16_label = f"⬇️ Download BF16 GGUF ({bf16_size:.0f}GB)" if show_bf16 else "⬇️ BF16 GGUF"
        
        return (
            gr.update(choices=diff_models, value=get_default_model(diff_models, diff_default, diff_fallback)),
            gr.update(choices=te_models, value=get_default_model(te_models, te_default)),
            gr.update(choices=vae_models, value=get_default_model(vae_models, vae_default)),
            gr.update(value=main_btn_label),
            gr.update(value=bf16_label, visible=show_bf16),
            gr.update(value=diff_label),
            gr.update(value=te_label),
            gr.update(value=vae_label),
        )
    
    mc.use_gguf.change(
        fn=on_mode_change,
        inputs=[mc.base_type_dropdown, mc.use_gguf],
        outputs=[
            mc.unet_name,
            mc.clip_name,
            mc.vae_name,
            mc.download_btn,
            mc.download_bf16_btn,
            mc.dl_diffusion_btn,
            mc.dl_te_btn,
            mc.dl_vae_btn,
        ]
    )
    
    # =========================================================================
    # Save Preset - Always creates a NEW preset
    # =========================================================================
    def on_save_preset(
        current_preset_id: str,
        presets_data: list,
        name: str,
        base_type: str,
        is_gguf: bool,
        diffusion: str,
        text_encoder: str,
        vae: str,
    ):
        """Save current configuration as a NEW preset."""
        if not name.strip():
            return (
                presets_data,
                gr.update(),
                gr.update(),  # clip_type_state unchanged
                gr.update(),  # preset_name_input unchanged
                "❌ Please enter a preset name",
            )
        
        presets = [UserPreset.from_dict(p) for p in presets_data]
        
        # Always create a new preset
        new_preset = UserPreset(
            id=str(uuid.uuid4()),
            name=name.strip(),
            base_type=base_type,
            use_gguf=is_gguf,
            diffusion=diffusion or "",
            text_encoder=text_encoder or "",
            vae=vae or "",
        )
        presets.append(new_preset)
        
        # Save to settings and select the new preset
        new_presets_data = [p.to_dict() for p in presets]
        if settings_manager:
            save_user_presets(settings_manager, presets, new_preset.id)
        
        # Update dropdown choices and select new preset (filtered by edit_only)
        choices = get_preset_dropdown_choices(presets, edit_only)
        
        return (
            new_presets_data,
            gr.update(choices=choices, value=new_preset.id),
            new_preset.clip_type,  # Update clip_type for the new preset
            "",  # Clear the name input for next preset
            f"✓ Created: {name}",
        )
    
    mc.save_preset_btn.click(
        fn=on_save_preset,
        inputs=[
            mc.quick_preset,
            mc.presets_state,
            mc.preset_name_input,
            mc.base_type_dropdown,
            mc.use_gguf,
            mc.unet_name,
            mc.clip_name,
            mc.vae_name,
        ],
        outputs=[
            mc.presets_state,
            mc.quick_preset,
            mc.clip_type_state,
            mc.preset_name_input,
            mc.status_text,
        ]
    )
    
    # =========================================================================
    # Delete Preset
    # =========================================================================
    def on_delete_preset(preset_id: str, presets_data: list):
        """Delete the currently selected preset."""
        presets = [UserPreset.from_dict(p) for p in presets_data]
        
        # Don't allow deleting if only one preset remains
        if len(presets) <= 1:
            return (
                presets_data,
                gr.update(),
                gr.update(),
                gr.update(),
                gr.update(),
                gr.update(),
                gr.update(),
                gr.update(),
                "❌ Cannot delete the last preset",
            )
        
        # Find and remove the preset
        preset_to_delete = get_preset_by_id(presets, preset_id)
        if preset_to_delete is None:
            return (
                presets_data,
                gr.update(),
                gr.update(),
                gr.update(),
                gr.update(),
                gr.update(),
                gr.update(),
                gr.update(),
                "❌ Preset not found",
            )
        
        deleted_name = preset_to_delete.name
        presets = [p for p in presets if p.id != preset_id]
        
        # Select the first remaining preset (respecting edit_only filter)
        if edit_only:
            compatible_presets = [p for p in presets if p.supports_edit]
            new_active = compatible_presets[0] if compatible_presets else presets[0]
        else:
            new_active = presets[0]
        
        new_presets_data = [p.to_dict() for p in presets]
        
        if settings_manager:
            save_user_presets(settings_manager, presets, new_active.id)
        
        # Get model lists for new active preset
        diff_models = get_models_by_mode(diffusion_dir, new_active.use_gguf) or [""]
        te_models = get_models_by_mode(text_encoders_dir, new_active.use_gguf) or [""]
        vae_models = scan_models(vae_dir, STANDARD_EXTENSIONS) or [""]
        
        choices = get_preset_dropdown_choices(presets, edit_only)
        
        return (
            new_presets_data,
            gr.update(choices=choices, value=new_active.id),
            new_active.base_type,
            new_active.use_gguf,
            gr.update(choices=diff_models, value=get_default_model(diff_models, new_active.diffusion)),
            gr.update(choices=te_models, value=get_default_model(te_models, new_active.text_encoder)),
            gr.update(choices=vae_models, value=get_default_model(vae_models, new_active.vae)),
            new_active.name,
            f"✓ Deleted preset: {deleted_name}",
        )
    
    mc.delete_preset_btn.click(
        fn=on_delete_preset,
        inputs=[mc.quick_preset, mc.presets_state],
        outputs=[
            mc.presets_state,
            mc.quick_preset,
            mc.base_type_dropdown,
            mc.use_gguf,
            mc.unet_name,
            mc.clip_name,
            mc.vae_name,
            mc.preset_name_input,
            mc.status_text,
        ]
    )
    
    # =========================================================================
    # Download Handlers
    # =========================================================================
    def on_download_all(base_type_id: str, is_gguf: bool, progress=gr.Progress()):
        """Download all models for the current base type."""
        base = BASE_MODEL_TYPES.get(base_type_id, BASE_MODEL_TYPES["zimage"])
        keys = base.download_keys_gguf if is_gguf else base.download_keys_standard
        
        # Check for gated models
        is_gated, gated_url = has_gated_model(keys)
        if is_gated:
            return (
                f"⚠️ {base.label} Standard contains gated models. Use GGUF mode or manually download from HuggingFace.",
                gr.update(),
                gr.update(),
                gr.update(),
            )
        
        result = download_base_type_models(base_type_id, is_gguf, models_dir, progress)
        
        # Refresh dropdowns
        diff_models = get_models_by_mode(diffusion_dir, is_gguf) or [""]
        te_models = get_models_by_mode(text_encoders_dir, is_gguf) or [""]
        vae_models = scan_models(vae_dir, STANDARD_EXTENSIONS) or [""]
        
        if is_gguf:
            diff_default = base.default_diffusion_gguf
            te_default = base.default_te_gguf
        else:
            diff_default = base.default_diffusion
            te_default = base.default_te
        
        return (
            result,
            gr.update(choices=diff_models, value=get_default_model(diff_models, diff_default)),
            gr.update(choices=te_models, value=get_default_model(te_models, te_default)),
            gr.update(choices=vae_models, value=get_default_model(vae_models, base.default_vae)),
        )
    
    mc.download_btn.click(
        fn=on_download_all,
        inputs=[mc.base_type_dropdown, mc.use_gguf],
        outputs=[mc.status_text, mc.unet_name, mc.clip_name, mc.vae_name]
    )
    
    def on_download_bf16(base_type_id: str, progress=gr.Progress()):
        """Download BF16 GGUF models (full precision alternative for Klein 9B)."""
        base = BASE_MODEL_TYPES.get(base_type_id, BASE_MODEL_TYPES["zimage"])
        keys = base.download_keys_gguf_bf16
        
        if not keys:
            return (
                f"❌ No BF16 GGUF option for {base.label}",
                gr.update(),
                gr.update(),
                gr.update(),
            )
        
        results = []
        for i, key in enumerate(keys):
            if progress:
                progress(i / len(keys), desc=f"Downloading {MODEL_DOWNLOADS.get(key, {}).get('label', key)}...")
            result = download_model(key, models_dir, progress)
            results.append(result)
        
        if progress:
            progress(1, desc="Done")
        
        # Refresh dropdowns (BF16 GGUF files still have .gguf extension)
        diff_models = get_models_by_mode(diffusion_dir, True) or [""]
        te_models = get_models_by_mode(text_encoders_dir, True) or [""]
        vae_models = scan_models(vae_dir, STANDARD_EXTENSIONS) or [""]
        
        return (
            "\n".join(results),
            gr.update(choices=diff_models),
            gr.update(choices=te_models),
            gr.update(choices=vae_models),
        )
    
    mc.download_bf16_btn.click(
        fn=on_download_bf16,
        inputs=[mc.base_type_dropdown],
        outputs=[mc.status_text, mc.unet_name, mc.clip_name, mc.vae_name]
    )
    
    def download_single(base_type_id: str, is_gguf: bool, model_type: str, progress=gr.Progress()):
        """Download a single model component."""
        base = BASE_MODEL_TYPES.get(base_type_id, BASE_MODEL_TYPES["zimage"])
        keys = base.download_keys_gguf if is_gguf else base.download_keys_standard
        
        key_to_download = None
        for key in keys:
            info = MODEL_DOWNLOADS.get(key, {})
            if model_type == "diffusion" and info.get("folder_key") == "diffusion":
                key_to_download = key
                # Check if gated - open URL instead
                if info.get("is_gated"):
                    gated_url = info.get("gated_url", f"https://huggingface.co/{info.get('repo_id')}")
                    webbrowser.open(gated_url)
                    return (
                        f"🔗 Opening HuggingFace page for gated model. Download manually and place in diffusion_models folder.",
                        gr.update(),
                        gr.update(),
                        gr.update(),
                    )
                break
            elif model_type == "te" and info.get("folder_key") == "text_encoder":
                key_to_download = key
                break
            elif model_type == "vae" and info.get("folder_key") == "vae":
                key_to_download = key
                break
        
        if key_to_download:
            result = download_model(key_to_download, models_dir, progress)
        else:
            result = f"❌ No {model_type} download configured for {base.label}"
        
        # Refresh the appropriate dropdown
        if model_type == "diffusion":
            models = get_models_by_mode(diffusion_dir, is_gguf) or [""]
            default = base.default_diffusion_gguf if is_gguf else base.default_diffusion
            return result, gr.update(choices=models, value=get_default_model(models, default)), gr.update(), gr.update()
        elif model_type == "te":
            models = get_models_by_mode(text_encoders_dir, is_gguf) or [""]
            default = base.default_te_gguf if is_gguf else base.default_te
            return result, gr.update(), gr.update(choices=models, value=get_default_model(models, default)), gr.update()
        else:  # vae
            models = scan_models(vae_dir, STANDARD_EXTENSIONS) or [""]
            return result, gr.update(), gr.update(), gr.update(choices=models, value=get_default_model(models, base.default_vae))
    
    mc.dl_diffusion_btn.click(
        fn=lambda bt, gguf, prog=gr.Progress(): download_single(bt, gguf, "diffusion", prog),
        inputs=[mc.base_type_dropdown, mc.use_gguf],
        outputs=[mc.status_text, mc.unet_name, mc.clip_name, mc.vae_name]
    )
    
    mc.dl_te_btn.click(
        fn=lambda bt, gguf, prog=gr.Progress(): download_single(bt, gguf, "te", prog),
        inputs=[mc.base_type_dropdown, mc.use_gguf],
        outputs=[mc.status_text, mc.unet_name, mc.clip_name, mc.vae_name]
    )
    
    mc.dl_vae_btn.click(
        fn=lambda bt, gguf, prog=gr.Progress(): download_single(bt, gguf, "vae", prog),
        inputs=[mc.base_type_dropdown, mc.use_gguf],
        outputs=[mc.status_text, mc.unet_name, mc.clip_name, mc.vae_name]
    )
    
    # Folder buttons
    mc.open_diffusion_btn.click(fn=lambda: open_folder(diffusion_dir), outputs=[])
    mc.open_te_btn.click(fn=lambda: open_folder(text_encoders_dir), outputs=[])
    mc.open_vae_btn.click(fn=lambda: open_folder(vae_dir), outputs=[])


# =============================================================================
# HELPER FUNCTIONS FOR EXTERNAL USE
# =============================================================================

def get_model_inputs(model_components: ModelComponents) -> list:
    """
    Get list of model input components for use in gr.Button.click() inputs.
    
    Returns list: [clip_type_state, use_gguf, unet_name, clip_name, vae_name]
    """
    mc = model_components
    return [mc.clip_type_state, mc.use_gguf, mc.unet_name, mc.clip_name, mc.vae_name]


def get_active_preset_config(preset_id: str, presets_data: list) -> dict:
    """
    Get the configuration for the active preset.
    
    Returns dict with clip_type, use_gguf, diffusion, text_encoder, vae.
    """
    presets = [UserPreset.from_dict(p) for p in presets_data]
    preset = get_preset_by_id(presets, preset_id)
    
    if preset is None:
        return {
            "clip_type": "lumina2",
            "use_gguf": False,
            "diffusion": "",
            "text_encoder": "",
            "vae": "",
        }
    
    return {
        "clip_type": preset.clip_type,
        "use_gguf": preset.use_gguf,
        "diffusion": preset.diffusion,
        "text_encoder": preset.text_encoder,
        "vae": preset.vae,
    }
