"""
Shared Services Infrastructure for Z-Image Fusion Modular Architecture.

This module provides:
- SharedServices: Central service container for dependency injection
- SettingsManager: Unified settings persistence for all modules
- Module discovery and tab ordering configuration
"""

import importlib
import importlib.util
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from types import ModuleType
from typing import Any, Callable, Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    import gradio as gr
    from comfykit import ComfyKit
    from modules.prompt_assistant import PromptAssistant
    from modules.system_monitor import SystemMonitor

logger = logging.getLogger(__name__)

# Tab ordering configuration - modules are loaded in this order
# Unknown modules are appended alphabetically after these
TAB_ORDER = [
    "zimage",        # ⚡ Z-Image Turbo
    "upscale",       # 🔍 Upscale  
    "llm_settings",  # ⚙️ LLM Settings (from prompt_assistant)
    "app_settings",  # 🛠️ App Settings
]


class SettingsManager:
    """
    Manages ui_settings.json read/write operations.
    
    Provides a unified interface for all modules to persist settings
    without duplicating file I/O code.
    """
    
    def __init__(self, settings_file: Path):
        """
        Initialize the settings manager.
        
        Args:
            settings_file: Path to the ui_settings.json file
        """
        self.settings_file = Path(settings_file)
        self._cache: Dict[str, Any] = {}
        self._loaded = False
    
    def load(self) -> Dict[str, Any]:
        """
        Load settings from file, using cache if available.
        
        Returns:
            Dictionary containing all settings
        """
        if self._loaded:
            return self._cache.copy()
        
        if self.settings_file.exists():
            try:
                with open(self.settings_file, "r", encoding="utf-8") as f:
                    self._cache = json.load(f)
                    self._loaded = True
            except json.JSONDecodeError as e:
                logger.warning(f"Invalid JSON in settings file, using defaults: {e}")
                self._cache = {}
                self._loaded = True
            except Exception as e:
                logger.warning(f"Failed to load settings: {e}")
                self._cache = {}
                self._loaded = True
        else:
            self._cache = {}
            self._loaded = True
        
        return self._cache.copy()
    
    def save(self, settings: Dict[str, Any]) -> None:
        """
        Save settings to file and update cache.
        
        Args:
            settings: Complete settings dictionary to save
        """
        try:
            # Ensure parent directory exists
            self.settings_file.parent.mkdir(parents=True, exist_ok=True)
            
            with open(self.settings_file, "w", encoding="utf-8") as f:
                json.dump(settings, f, indent=2)
            
            self._cache = settings.copy()
            self._loaded = True
        except Exception as e:
            logger.error(f"Failed to save settings: {e}")
            raise
    
    def get(self, key: str, default: Any = None) -> Any:
        """
        Get a specific setting value.
        
        Args:
            key: Setting key to retrieve
            default: Default value if key not found
            
        Returns:
            Setting value or default
        """
        settings = self.load()
        return settings.get(key, default)
    
    def set(self, key: str, value: Any) -> None:
        """
        Set a specific setting value and persist.
        
        Args:
            key: Setting key to set
            value: Value to store
        """
        settings = self.load()
        settings[key] = value
        self.save(settings)
    
    def reload(self) -> Dict[str, Any]:
        """
        Force reload settings from disk, bypassing cache.
        
        Returns:
            Fresh settings dictionary from disk
        """
        self._loaded = False
        self._cache = {}
        return self.load()


@dataclass
class ImageReceiver:
    """
    Represents a module that can receive images from other modules.
    
    Registered by modules that want to accept images (upscale, img2vid, 3d, etc.)
    """
    tab_id: str                    # Tab ID to switch to (e.g., "upscale")
    label: str                     # Display label (e.g., "🔍 Upscale")
    input_component: Any           # Gradio Image component to receive the image
    status_component: Optional[Any] = None  # Optional status textbox for feedback


class ImageTransfer:
    """
    Centralized system for transferring images between modules.
    
    This is the core infrastructure for "Send to X" functionality.
    Modules register as receivers, and any module can send images to them.
    
    Usage:
        # In receiving module (e.g., upscale.py):
        services.image_transfer.register_receiver(
            tab_id="upscale",
            label="🔍 Upscale",
            input_component=upscale_input_image,
            status_component=upscale_status
        )
        
        # In sending module (e.g., zimage.py):
        # Get list of available receivers for UI
        receivers = services.image_transfer.get_receivers()
        
        # Create send buttons dynamically or use helper
        services.image_transfer.create_send_button(
            button=send_btn,
            source_gallery=output_gallery,
            source_selected=selected_image_state,
            source_status=gen_status,
            target_tab_id="upscale"
        )
    """
    
    def __init__(self):
        self._receivers: Dict[str, ImageReceiver] = {}
        self._main_tabs: Optional[Any] = None
        self._pending_transfers: Dict[str, str] = {}  # tab_id -> image_path
    
    def set_main_tabs(self, main_tabs: Any) -> None:
        """Set the main tabs component for tab switching."""
        self._main_tabs = main_tabs
    
    def register_receiver(
        self,
        tab_id: str,
        label: str,
        input_component: Any,
        status_component: Optional[Any] = None
    ) -> None:
        """
        Register a module as an image receiver.
        
        Args:
            tab_id: Unique tab identifier (must match TabItem id)
            label: Display label for "Send to X" buttons
            input_component: Gradio Image component to receive images
            status_component: Optional status textbox for feedback
        """
        self._receivers[tab_id] = ImageReceiver(
            tab_id=tab_id,
            label=label,
            input_component=input_component,
            status_component=status_component
        )
        logger.info(f"Registered image receiver: {tab_id} ({label})")
    
    def get_receivers(self) -> Dict[str, ImageReceiver]:
        """Get all registered receivers."""
        return self._receivers.copy()
    
    def get_receiver(self, tab_id: str) -> Optional[ImageReceiver]:
        """Get a specific receiver by tab_id."""
        return self._receivers.get(tab_id)
    
    def get_receiver_labels(self) -> List[tuple[str, str]]:
        """Get list of (tab_id, label) tuples for UI dropdowns."""
        return [(r.tab_id, r.label) for r in self._receivers.values()]
    
    def set_pending(self, tab_id: str, image_path: str) -> None:
        """Set a pending image transfer for a tab (fallback mechanism)."""
        self._pending_transfers[tab_id] = image_path
    
    def get_pending(self, tab_id: str) -> Optional[str]:
        """Get and clear pending image for a tab."""
        return self._pending_transfers.pop(tab_id, None)
    
    def create_send_handler(self, target_tab_id: str):
        """
        Create a handler function for sending images to a specific target.
        
        Returns a function that can be used as a Gradio click handler.
        The function takes (selected_image, gallery_data) and returns
        outputs for: source_status, source_selected, target_input, target_status, main_tabs
        """
        import gradio as gr
        
        receiver = self._receivers.get(target_tab_id)
        
        def handler(selected_img, gallery_data):
            # Determine image to send
            image_to_send = None
            if selected_img:
                image_to_send = selected_img
            elif gallery_data:
                item = gallery_data[0]
                image_to_send = item[0] if isinstance(item, (list, tuple)) else item
            
            if not image_to_send:
                # Return no-op updates
                return (
                    "❌ No image to send",
                    None,
                    gr.update(),
                    gr.update(),
                    gr.update()
                )
            
            # Store as pending (fallback if direct update fails)
            self.set_pending(target_tab_id, image_to_send)
            
            label = receiver.label if receiver else target_tab_id
            return (
                f"✓ Sent to {label}",
                image_to_send,
                image_to_send,  # target input
                f"✓ Received image",  # target status
                gr.Tabs(selected=target_tab_id)  # switch tabs
            )
        
        return handler
    
    def wire_send_button(
        self,
        button: Any,
        target_tab_id: str,
        source_selected: Any,
        source_gallery: Any,
        source_status: Any
    ) -> bool:
        """
        Wire up a send button to transfer images to a target module.
        
        Args:
            button: Gradio Button component
            target_tab_id: Target module's tab_id
            source_selected: State component holding selected image path
            source_gallery: Gallery component with images
            source_status: Status textbox for feedback
            
        Returns:
            True if wiring succeeded, False if target not registered
        """
        import gradio as gr
        
        receiver = self._receivers.get(target_tab_id)
        if not receiver:
            logger.warning(f"Cannot wire send button: receiver '{target_tab_id}' not registered")
            return False
        
        if not self._main_tabs:
            logger.warning("Cannot wire send button: main_tabs not set")
            return False
        
        handler = self.create_send_handler(target_tab_id)
        
        outputs = [source_status, source_selected, receiver.input_component]
        if receiver.status_component:
            outputs.append(receiver.status_component)
        else:
            outputs.append(gr.State())  # dummy output
        outputs.append(self._main_tabs)
        
        button.click(
            fn=handler,
            inputs=[source_selected, source_gallery],
            outputs=outputs
        )
        
        logger.info(f"Wired send button to {target_tab_id}")
        return True
    
    def create_tab_select_handler(self, tab_id: str):
        """
        Create a handler for tab selection that checks for pending images.
        
        Use this on the receiving tab's select event as a fallback.
        """
        import gradio as gr
        
        def handler():
            image_path = self.get_pending(tab_id)
            if image_path:
                return image_path, "✓ Received image"
            return gr.update(), gr.update()
        
        return handler


class InterModuleState:
    """
    Shared state for inter-module communication.
    
    This class provides a mechanism for modules to communicate with each other
    through well-defined interfaces without tight coupling.
    """
    
    def __init__(self):
        # Core image transfer system
        self.image_transfer = ImageTransfer()
        # Legacy: direct component registry (for non-image transfers)
        self._ui_components: Dict[str, Any] = {}
        # Main tabs reference
        self._main_tabs: Optional[Any] = None
    
    @property
    def main_tabs(self) -> Optional[Any]:
        return self._main_tabs
    
    @main_tabs.setter
    def main_tabs(self, value: Any) -> None:
        self._main_tabs = value
        self.image_transfer.set_main_tabs(value)
    
    def register_component(self, name: str, component: Any) -> None:
        """Register a UI component for cross-module access."""
        self._ui_components[name] = component
        logger.debug(f"Registered UI component: {name}")
    
    def get_component(self, name: str) -> Optional[Any]:
        """Get a registered UI component by name."""
        return self._ui_components.get(name)


@dataclass
class SharedServices:
    """
    Container for shared services injected into modules.
    
    This dataclass provides dependency injection for all modules,
    ensuring they have access to common functionality without
    importing globals or duplicating code.
    """
    kit: Optional["ComfyKit"]  # ComfyUI client (may be None if connection failed)
    app_dir: Path              # Application root directory
    models_dir: Path           # ComfyUI models directory
    outputs_dir: Path          # User outputs directory (mutable via settings)
    workflows_dir: Path        # Workflow JSON files directory
    settings: SettingsManager  # UI settings persistence
    prompt_assistant: Optional["PromptAssistant"] = None  # LLM prompt enhancement
    system_monitor: Optional["SystemMonitor"] = None      # GPU/CPU monitoring class
    inter_module: Optional[InterModuleState] = None  # Inter-module communication
    
    def __post_init__(self):
        """Initialize inter_module if not provided."""
        if self.inter_module is None:
            self.inter_module = InterModuleState()
    
    def get_outputs_dir(self) -> Path:
        """
        Get the current outputs directory, respecting settings overrides.
        
        Returns:
            Path to the outputs directory
        """
        custom_path = self.settings.get("outputs_dir")
        if custom_path:
            path = Path(custom_path)
            if path.is_absolute():
                path.mkdir(parents=True, exist_ok=True)
                return path
        # Use default
        self.outputs_dir.mkdir(parents=True, exist_ok=True)
        return self.outputs_dir


@dataclass
class ModuleInfo:
    """
    Information about a discovered module.
    
    Contains all metadata needed to load and display a module's tab.
    """
    name: str                  # Module file name without .py
    module: ModuleType         # Imported module object
    tab_id: str                # TAB_ID from module
    tab_label: str             # TAB_LABEL from module
    order: int                 # TAB_ORDER from module
    create_tab: Callable[["SharedServices"], "gr.TabItem"]  # Tab factory function


def _get_module_order(module_name: str) -> int:
    """
    Get the sort order for a module based on TAB_ORDER configuration.
    
    Args:
        module_name: Name of the module (without .py)
        
    Returns:
        Sort order index (lower = first), unknown modules get high values
    """
    try:
        return TAB_ORDER.index(module_name)
    except ValueError:
        # Unknown modules go after configured ones, sorted alphabetically
        return len(TAB_ORDER) + ord(module_name[0]) if module_name else len(TAB_ORDER) + 1000


def discover_modules(modules_dir: Path) -> List[ModuleInfo]:
    """
    Scan modules directory for valid module files.
    
    A valid module is a Python file that:
    - Has a create_tab() function
    - Optionally has TAB_ID, TAB_LABEL, TAB_ORDER constants
    
    Args:
        modules_dir: Path to the modules directory
        
    Returns:
        List of ModuleInfo sorted by TAB_ORDER, with unknown modules appended alphabetically
    """
    discovered: List[ModuleInfo] = []
    
    if not modules_dir.exists():
        logger.warning(f"Modules directory does not exist: {modules_dir}")
        return discovered
    
    # Scan for Python files
    for py_file in modules_dir.glob("*.py"):
        # Skip __init__.py and private modules
        if py_file.name.startswith("_"):
            continue
        
        module_name = py_file.stem
        
        try:
            # Load the module spec
            spec = importlib.util.spec_from_file_location(
                f"modules.{module_name}",
                py_file
            )
            
            if spec is None or spec.loader is None:
                logger.debug(f"Could not load spec for {module_name}")
                continue
            
            # Load the module
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            
            # Check for create_tab function
            if not hasattr(module, "create_tab") or not callable(module.create_tab):
                logger.debug(f"Module {module_name} has no create_tab() function, skipping")
                continue
            
            # Extract metadata with defaults
            tab_id = getattr(module, "TAB_ID", module_name)
            tab_label = getattr(module, "TAB_LABEL", module_name.replace("_", " ").title())
            tab_order = getattr(module, "TAB_ORDER", _get_module_order(module_name))
            
            module_info = ModuleInfo(
                name=module_name,
                module=module,
                tab_id=tab_id,
                tab_label=tab_label,
                order=tab_order,
                create_tab=module.create_tab
            )
            
            discovered.append(module_info)
            logger.info(f"Discovered module: {module_name} (tab_id={tab_id}, order={tab_order})")
            
        except Exception as e:
            logger.error(f"Failed to load module {module_name}: {e}")
            continue
    
    # Sort by order (TAB_ORDER index), then alphabetically for ties
    discovered.sort(key=lambda m: (m.order, m.name))
    
    return discovered


def load_modules(
    modules_dir: Path,
    services: SharedServices
) -> List[tuple[ModuleInfo, "gr.TabItem"]]:
    """
    Discover and load all valid modules, creating their tabs.
    
    Args:
        modules_dir: Path to the modules directory
        services: SharedServices instance to inject into modules
        
    Returns:
        List of (ModuleInfo, TabItem) tuples for successfully loaded modules
    """
    loaded: List[tuple[ModuleInfo, "gr.TabItem"]] = []
    
    for module_info in discover_modules(modules_dir):
        try:
            tab = module_info.create_tab(services)
            loaded.append((module_info, tab))
            logger.info(f"Loaded module tab: {module_info.tab_label}")
        except Exception as e:
            logger.error(f"Failed to create tab for module {module_info.name}: {e}")
            continue
    
    return loaded


# Export public API
__all__ = [
    "SharedServices",
    "SettingsManager", 
    "ModuleInfo",
    "InterModuleState",
    "ImageTransfer",
    "ImageReceiver",
    "TAB_ORDER",
    "discover_modules",
    "load_modules",
]
