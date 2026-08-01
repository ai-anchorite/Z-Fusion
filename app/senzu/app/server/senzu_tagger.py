# Standalone WD14 tagger for Senzu Gallery — no ComfyUI dependencies.
# Usage: python senzu_tagger.py <image_path> [<image_path> ...]
# Output: JSON array [{path, tags: [...]}, ...] to stdout
# Progress: JSON messages to stderr: {"progress": {"current": N, "total": M}}

import sys
import os
import csv
import json
import numpy as np
from PIL import Image
import onnxruntime as ort

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(SCRIPT_DIR)
MODELS_DIR = os.path.join(APP_DIR, "data", "wd14-models")
os.makedirs(MODELS_DIR, exist_ok=True)

DEFAULT_MODEL = "wd-v1-4-moat-tagger-v2"
DEFAULT_THRESHOLD = 0.35
DEFAULT_CHARACTER_THRESHOLD = 0.85

MODEL_URLS = {
    "wd-eva02-large-tagger-v3": "https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3/resolve/main/",
    "wd-vit-tagger-v3": "https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/",
    "wd-swinv2-tagger-v3": "https://huggingface.co/SmilingWolf/wd-swinv2-tagger-v3/resolve/main/",
    "wd-convnext-tagger-v3": "https://huggingface.co/SmilingWolf/wd-convnext-tagger-v3/resolve/main/",
    "wd-v1-4-moat-tagger-v2": "https://huggingface.co/SmilingWolf/wd-v1-4-moat-tagger-v2/resolve/main/",
    "wd-v1-4-convnextv2-tagger-v2": "https://huggingface.co/SmilingWolf/wd-v1-4-convnextv2-tagger-v2/resolve/main/",
    "wd-v1-4-convnext-tagger-v2": "https://huggingface.co/SmilingWolf/wd-v1-4-convnext-tagger-v2/resolve/main/",
    "wd-v1-4-convnext-tagger": "https://huggingface.co/SmilingWolf/wd-v1-4-convnext-tagger/resolve/main/",
    "wd-v1-4-vit-tagger-v2": "https://huggingface.co/SmilingWolf/wd-v1-4-vit-tagger-v2/resolve/main/",
    "wd-v1-4-swinv2-tagger-v2": "https://huggingface.co/SmilingWolf/wd-v1-4-swinv2-tagger-v2/resolve/main/",
    "wd-v1-4-vit-tagger": "https://huggingface.co/SmilingWolf/wd-v1-4-vit-tagger/resolve/main/",
}

providers = ort.get_available_providers()
if "CUDAExecutionProvider" in providers:
    providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
elif "TensorrtExecutionProvider" in providers:
    providers = [p for p in providers if p != "TensorrtExecutionProvider"]
else:
    providers = ["CPUExecutionProvider"]

def log_progress(current, total):
    sys.stderr.write(json.dumps({"progress": {"current": current, "total": total}}) + "\n")
    sys.stderr.flush()

def download_model(name):
    url_base = MODEL_URLS.get(name)
    if not url_base:
        sys.stderr.write(f"Unknown model: {name}\n")
        return False

    onnx_path = os.path.join(MODELS_DIR, f"{name}.onnx")
    csv_path = os.path.join(MODELS_DIR, f"{name}.csv")

    if os.path.exists(onnx_path) and os.path.exists(csv_path):
        return True

    os.makedirs(MODELS_DIR, exist_ok=True)
    sys.stderr.write(f"Downloading model {name}...\n")
    sys.stderr.flush()

    import urllib.request

    def _progress(block_count, block_size, total_size):
        if total_size > 0:
            pct = min(100, int(block_count * block_size / total_size * 100))
            mb = total_size / (1024 * 1024)
            sys.stderr.write(f"  {pct}% of {mb:.0f} MB...\n")
        else:
            sys.stderr.write(f"  {block_count * block_size / 1024:.0f} KB...\n")
        sys.stderr.flush()

    for fname, dest in [("model.onnx", onnx_path), ("selected_tags.csv", csv_path)]:
        url = url_base + fname
        sys.stderr.write(f"  {url}\n")
        sys.stderr.flush()
        try:
            urllib.request.urlretrieve(url, dest, _progress)
        except Exception as e:
            sys.stderr.write(f"  Download failed: {e}\n")
            sys.stderr.flush()
            return False
        sys.stderr.write(f"  Saved to {dest}\n")
        sys.stderr.flush()

    return True

def load_tags_csv(name):
    csv_path = os.path.join(MODELS_DIR, f"{name}.csv")
    tags = []
    general_index = None
    character_index = None

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader)
        for row in reader:
            if general_index is None and row[2] == "0":
                general_index = reader.line_num - 2
            elif character_index is None and row[2] == "4":
                character_index = reader.line_num - 2
            tags.append(row[1])

    return tags, general_index, character_index

def tag_image(image_path, session, tags, general_index, character_index, threshold, character_threshold, exclude_tags_set):
    image = Image.open(image_path).convert("RGB")

    input_info = session.get_inputs()[0]
    height = input_info.shape[1]

    ratio = float(height) / max(image.size)
    new_size = tuple([int(x * ratio) for x in image.size])
    image = image.resize(new_size, Image.LANCZOS)
    square = Image.new("RGB", (height, height), (255, 255, 255))
    square.paste(image, ((height - new_size[0]) // 2, (height - new_size[1]) // 2))

    image_arr = np.array(square).astype(np.float32)
    image_arr = image_arr[:, :, ::-1]  # RGB -> BGR
    image_arr = np.expand_dims(image_arr, 0)

    label_name = session.get_outputs()[0].name
    probs = session.run([label_name], {input_info.name: image_arr})[0]

    result = list(zip(tags, probs[0]))
    general = [item for item in result[general_index:character_index] if item[1] > threshold]
    character = [item for item in result[character_index:] if item[1] > character_threshold]

    all_tags = character + general
    filtered = [tag[0] for tag in all_tags if tag[0].lower() not in exclude_tags_set]

    return filtered

def main():
    model_name = os.environ.get("SENZU_TAGGER_MODEL", DEFAULT_MODEL)
    threshold = float(os.environ.get("SENZU_TAGGER_THRESHOLD", DEFAULT_THRESHOLD))
    character_threshold = float(os.environ.get("SENZU_TAGGER_CHAR_THRESHOLD", DEFAULT_CHARACTER_THRESHOLD))
    exclude_tags = os.environ.get("SENZU_TAGGER_EXCLUDE", "")

    exclude_tags_set = set(t.strip().lower() for t in exclude_tags.split(",") if t.strip())

    image_paths = []
    if len(sys.argv) > 1:
        image_paths = sys.argv[1:]
    else:
        for line in sys.stdin:
            line = line.strip()
            if line:
                image_paths.append(line)

    if not image_paths:
        sys.stderr.write("No image paths provided.\n")
        sys.exit(1)

    if not download_model(model_name):
        sys.exit(1)

    tags, general_index, character_index = load_tags_csv(model_name)

    session = ort.InferenceSession(
        os.path.join(MODELS_DIR, f"{model_name}.onnx"),
        providers=providers
    )

    results = []
    total = len(image_paths)

    for i, img_path in enumerate(image_paths):
        log_progress(i + 1, total)

        if not os.path.isfile(img_path):
            results.append({"path": img_path, "error": "file not found", "tags": []})
            continue

        try:
            img_tags = tag_image(
                img_path, session, tags, general_index, character_index,
                threshold, character_threshold, exclude_tags_set
            )
            results.append({"path": img_path, "tags": img_tags})
        except Exception as e:
            results.append({"path": img_path, "error": str(e), "tags": []})

    sys.stdout.write(json.dumps(results))
    sys.stdout.flush()

if __name__ == "__main__":
    main()
