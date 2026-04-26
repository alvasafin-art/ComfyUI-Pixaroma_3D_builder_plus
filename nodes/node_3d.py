import torch
import numpy as np
from PIL import Image
import os
import json
import folder_paths
from .node_ref import any_type, FlexibleOptionalInputType


class Pixaroma3D:
    @classmethod
    def INPUT_TYPES(self):
        return {
            "required": {},
            "optional": FlexibleOptionalInputType(any_type),
        }

    CATEGORY = "👑 Pixaroma"
    RETURN_TYPES = ("IMAGE", "IMAGE", "INT", "INT")
    RETURN_NAMES = ("image", "overlay", "width", "height")
    FUNCTION = "load_render"
    DESCRIPTION = "3D Builder — create 3D scenes with shapes, materials, lighting, and optional overlay layers"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        """Force re-execution when the render file on disk changes."""
        scene_data = kwargs.get("SceneWidget")
        if not scene_data:
            return ""
        try:
            scene_json = scene_data.get("scene_json", "{}")
            meta = json.loads(scene_json)
            input_dir = folder_paths.get_input_directory()
            stamps = []
            for key in ("composite_path", "overlay_path"):
                rel_path = meta.get(key, "")
                if rel_path:
                    full_path = os.path.join(input_dir, rel_path)
                    if os.path.exists(full_path):
                        stamps.append(f"{key}:{os.path.getmtime(full_path)}")
            if stamps:
                return "|".join(stamps)
        except Exception:
            pass
        return str(scene_data)

    @staticmethod
    def _empty_image(width=1024, height=1024, channels=3):
        return torch.zeros((1, height, width, channels), dtype=torch.float32)

    @staticmethod
    def _load_image_from_input_path(rel_path, doc_w, doc_h, channels=3):
        input_dir = os.path.realpath(folder_paths.get_input_directory())
        full_path = os.path.realpath(os.path.join(input_dir, rel_path))

        if not full_path.startswith(input_dir + os.sep):
            print("[Pixaroma3D] Security: image path escapes input directory, blocked.")
            return Pixaroma3D._empty_image(doc_w, doc_h, channels)

        if not os.path.exists(full_path):
            return Pixaroma3D._empty_image(doc_w, doc_h, channels)

        mode = "RGBA" if channels == 4 else "RGB"
        img = Image.open(full_path).convert(mode)
        arr = np.array(img).astype(np.float32) / 255.0
        return torch.from_numpy(arr)[None,]

    def load_render(self, **kwargs):
        empty_image = self._empty_image(1024, 1024, 3)
        empty_overlay = self._empty_image(1024, 1024, 4)

        # Extract scene data from the DOM widget
        scene_data = kwargs.get("SceneWidget")
        if not scene_data:
            return (empty_image, empty_overlay, 1024, 1024)

        scene_json = scene_data.get("scene_json", "{}") if isinstance(scene_data, dict) else str(scene_data)

        if not scene_json or scene_json.strip() in ("", "{}"):
            return (empty_image, empty_overlay, 1024, 1024)

        try:
            meta = json.loads(scene_json)
            if not isinstance(meta, dict):
                return (empty_image, empty_overlay, 1024, 1024)

            doc_w = int(meta.get("doc_w", 1024))
            doc_h = int(meta.get("doc_h", 1024))

            composite_path = meta.get("composite_path", "")
            overlay_path = meta.get("overlay_path", "")

            if composite_path:
                image = self._load_image_from_input_path(composite_path, doc_w, doc_h, 3)
            else:
                image = self._empty_image(doc_w, doc_h, 3)

            # Overlay is loaded as RGBA so the transparent background saved by
            # the 3D render pass remains available to downstream nodes that can
            # consume 4-channel IMAGE tensors.
            if overlay_path:
                overlay = self._load_image_from_input_path(overlay_path, doc_w, doc_h, 4)
            else:
                overlay = self._empty_image(doc_w, doc_h, 4)

            return (image, overlay, doc_w, doc_h)

        except Exception as e:
            print(f"[Pixaroma3D] Load error: {e}")
            return (empty_image, empty_overlay, 1024, 1024)


NODE_CLASS_MAPPINGS = {
    "Pixaroma3D": Pixaroma3D,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Pixaroma3D": "3D Builder Pixaroma",
}
