// ============================================================
// Pixaroma 3D Editor — Entry point (ComfyUI widget registration)
// ============================================================
import { app } from "../../../../scripts/app.js";

// Import core class first, then mixin files (side-effect imports add methods to prototype)
import { Pixaroma3DEditor } from "./core.mjs";
import "./engine.mjs";
import "./shapes.mjs";  // shape registry (pure data module, no mixins)
import "./objects.mjs";
import "./shape_params.mjs";
import "./interaction.mjs";
import "./persistence.mjs";
import "./importer.mjs";


import {
  allow_debug,
  createNodePreview,
  showNodePreview,
  activateNodePreview,
  downloadDataURL,
} from "../shared/index.mjs";

const PIXAROMA_3D_WORKFLOW_STATE_KEY = "pixaroma_3d_builder";

const P3D_PREVIEW_MODES = [
  { id: "all", label: "All", title: "Show image + overlay" },
  { id: "image", label: "Image", title: "Show image output only" },
  { id: "overlay", label: "Overlay", title: "Show overlay output only" },
];

function getWorkflow3DState() {
  const graph = app.graph;
  if (!graph) return { camera_templates: [], background_templates: [] };
  if (!graph.extra || typeof graph.extra !== "object") graph.extra = {};
  if (!graph.extra[PIXAROMA_3D_WORKFLOW_STATE_KEY] ||
      typeof graph.extra[PIXAROMA_3D_WORKFLOW_STATE_KEY] !== "object") {
    graph.extra[PIXAROMA_3D_WORKFLOW_STATE_KEY] = {};
  }
  const state = graph.extra[PIXAROMA_3D_WORKFLOW_STATE_KEY];
  if (!Array.isArray(state.camera_templates)) state.camera_templates = [];
  if (!Array.isArray(state.background_templates)) state.background_templates = [];
  return state;
}

function setWorkflow3DState(next) {
  const state = getWorkflow3DState();
  state.camera_templates = Array.isArray(next?.camera_templates)
    ? next.camera_templates
    : state.camera_templates;
  state.background_templates = Array.isArray(next?.background_templates)
    ? next.background_templates
    : state.background_templates;
}

function _pathToPreviewUrl(path) {
  if (!path) return null;
  const normalized = String(path).replace(/\\/g, "/");
  const chunks = normalized.split("/");
  const filename = chunks.pop();
  const subfolder = chunks.join("/") || "pixaroma";
  if (!filename) return null;
  return `/view?filename=${encodeURIComponent(filename)}&type=input&subfolder=${encodeURIComponent(subfolder)}&t=${Date.now()}`;
}

function _getPreviewPaths(meta) {
  const paths = meta?.preview_paths || {};
  return {
    all: paths.all || meta?.all_path || meta?.composite_all_path || meta?.composite_path || null,
    image: paths.image || meta?.image_path || meta?.composite_path || null,
    overlay: paths.overlay || meta?.overlay_path || null,
  };
}

function _ensure3DPreviewModeBar(parts) {
  if (parts.p3dModeBar) return parts.p3dModeBar;

  const bar = document.createElement("div");
  bar.style.cssText = [
    "display:none",
    "width:100%",
    "grid-template-columns:repeat(3,1fr)",
    "gap:6px",
    "margin:0 0 6px 0",
  ].join(";");

  // The DOM widget itself sits below the native "Open 3D Builder" button.
  // Insert the mode buttons at the top of that widget so they appear
  // between "Open 3D Builder" and the preview image.
  parts.container.insertBefore(bar, parts.previewBox || parts.container.firstChild);
  parts.p3dModeBar = bar;
  return bar;
}

function _stylePreviewButton(btn, active, enabled) {
  btn.style.background = active ? "#f66744" : "#1e2022";
  btn.style.borderColor = active ? "#f66744" : "#3a3d40";
  btn.style.color = active ? "#fff" : "#ccc";
  btn.style.opacity = enabled ? "1" : "0.4";
  btn.style.cursor = enabled ? "pointer" : "default";
}

function _show3DNodePreview(parts, meta, node, preferredMode = "all", dataURLs = null, onModeChange = null) {
  if (!meta || typeof meta !== "object") return;

  const dimText = `${meta.doc_w || "?"}\u00d7${meta.doc_h || "?"}`;
  const paths = _getPreviewPaths(meta);
  const sourceFor = (mode) => dataURLs?.[mode] || _pathToPreviewUrl(paths[mode]);

  const available = P3D_PREVIEW_MODES
    .map((m) => m.id)
    .filter((mode) => !!sourceFor(mode));

  if (!available.length) return;

  const initialMode =
    available.includes(preferredMode) ? preferredMode :
    available.includes(meta.previewMode) ? meta.previewMode :
    available.includes(parts.p3dPreviewMode) ? parts.p3dPreviewMode :
    available[0];

  const bar = _ensure3DPreviewModeBar(parts);
  bar.innerHTML = "";
  bar.style.display = "grid";

  const showMode = (mode, userAction = false) => {
    const src = sourceFor(mode);
    if (!src) return;

    // Transparent overlay previews are easier to understand on a checkerboard.
    parts.previewBox.style.backgroundColor = mode === "overlay" ? "#1b1b1b" : "#000000";
    parts.previewBox.style.backgroundImage = mode === "overlay"
      ? "linear-gradient(45deg,#333 25%,transparent 25%),linear-gradient(-45deg,#333 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#333 75%),linear-gradient(-45deg,transparent 75%,#333 75%)"
      : "";
    parts.previewBox.style.backgroundSize = mode === "overlay" ? "16px 16px" : "";
    parts.previewBox.style.backgroundPosition = mode === "overlay" ? "0 0,0 8px,8px -8px,-8px 0px" : "";

    showNodePreview(parts, src, dimText, node);
    parts.p3dPreviewMode = mode;

    bar.querySelectorAll("button[data-p3d-preview-mode]").forEach((btn) => {
      const btnMode = btn.dataset.p3dPreviewMode;
      _stylePreviewButton(btn, btnMode === mode, !!sourceFor(btnMode));
    });

    if (userAction) onModeChange?.(mode);
  };

  for (const def of P3D_PREVIEW_MODES) {
    const enabled = !!sourceFor(def.id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.p3dPreviewMode = def.id;
    btn.textContent = def.label;
    btn.title = enabled ? def.title : `${def.label} preview is not available in this saved scene yet`;
    btn.disabled = !enabled;
    btn.style.cssText = [
      "height:26px",
      "border:1px solid #3a3d40",
      "border-radius:6px",
      "background:#1e2022",
      "color:#ccc",
      "font-size:12px",
      "font-family:inherit",
      "pointer-events:auto",
    ].join(";");
    _stylePreviewButton(btn, def.id === initialMode, enabled);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (enabled) showMode(def.id, true);
    });
    bar.appendChild(btn);
  }

  showMode(initialMode, false);
}

app.registerExtension({
  name: "Pixaroma.3DEditor",

  settings: [
    {
      id: "Pixaroma.3D.DefaultBgColor",
      name: "Default Background Color — 3D Builder (default #6e6e6e)",
      type: "color",
      defaultValue: "#6e6e6e",
      tooltip: "Color used as the background for new 3D scenes. Default is #6e6e6e (neutral gray). NOTE: ComfyUI's color field shows saved values without '#' but requires '#' when typing — enter '#6e6e6e' to reset, or use the color picker.",
      category: ["👑 Pixaroma", "3D Builder"],
    },
  ],

  // Handle execution result (OUTPUT_NODE = True on python side)
  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== "Pixaroma3D") return;

    const originalOnExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      originalOnExecuted?.apply(this, arguments);
      if (allow_debug) console.log("Pixaroma3D executed");
    };
  },

  // DOM widget creation
  async nodeCreated(node) {
    if (node.comfyClass !== "Pixaroma3D") return;

    node.size = [300, 300];
    node.imgs = null; // suppress native ComfyUI preview

    // ── Shared preview system ──
    const parts = createNodePreview(
      "3D Builder",
      "Pixaroma",
      "Click 'Open 3D Builder' to start",
    );

    // ── State ──
    let sceneJson = "{}";
    let previewMode = "all";

    const setPreviewMode = (mode) => {
      if (!P3D_PREVIEW_MODES.some((m) => m.id === mode)) return;
      previewMode = mode;
      try {
        const meta = JSON.parse(sceneJson || "{}");
        if (meta && typeof meta === "object") {
          meta.previewMode = mode;
          sceneJson = JSON.stringify(meta);
          const w = widget || node.widgets?.find((x) => x.name === "SceneWidget");
          if (w) w.value = { scene_json: sceneJson };
        }
      } catch {}
      node.setDirtyCanvas(true, true);
    };

    // ── Separate button widget ──
    node.addWidget("button", "Open 3D Builder", null, () => {
      const editor = new Pixaroma3DEditor();
      editor.getSharedState = () => getWorkflow3DState();
      editor.setSharedState = (next) => {
        setWorkflow3DState(next);
        node.setDirtyCanvas(true, true);
      };
      editor._nodePreviewMode = previewMode;

      // Apply default BG from ComfyUI settings (if user configured it).
      // ComfyUI's `color` setting type returns values without the leading
      // `#` (e.g. "c936c9"), and the legacy `text` type returns "#c936c9".
      // Accept either, and normalize to "#rrggbb".
      try {
        let custom = app.ui.settings.getSettingValue("Pixaroma.3D.DefaultBgColor");
        if (typeof custom === "string") {
          custom = custom.trim();
          if (custom && custom[0] !== "#") custom = "#" + custom;
          if (/^#[0-9a-fA-F]{6}$/.test(custom)) {
            editor.bgColor = custom;
            editor._defaultBgColor = custom;
          }
        }
      } catch {}

      editor.onSave = (jsonStr, dataURL, previewDataURLs = null) => {
        try {
          const meta = JSON.parse(jsonStr || "{}");
          meta.previewMode = previewMode;
          sceneJson = JSON.stringify(meta);
        } catch {
          sceneJson = jsonStr;
        }

        // Guard + re-lookup: ComfyUI's Vue frontend can tear down the
        // DOM widget while the editor is still open (same pattern as
        // the overlay-removal case noted in CLAUDE.md). If that
        // happens, `widget` was nulled by onRemoved. Try node.widgets
        // as a fallback — Vue may have recreated the widget under the
        // same name. If still nothing, the widget's getValue reads
        // from the `sceneJson` closure var (just refreshed) so the
        // next workflow execution still picks up fresh data.
        const w = widget || node.widgets?.find((x) => x.name === "SceneWidget");
        if (w) w.value = { scene_json: sceneJson };

        try {
          const meta = JSON.parse(sceneJson || "{}");
          _show3DNodePreview(parts, meta, node, previewMode, previewDataURLs, setPreviewMode);
        } catch {
          if (dataURL) {
            let dimText = null;
            try {
              const meta = JSON.parse(sceneJson);
              dimText = `${meta.doc_w || "?"}\u00d7${meta.doc_h || "?"}`;
            } catch {}
            showNodePreview(parts, dataURL, dimText, node);
          }
        }

        node.setDirtyCanvas(true, true);
      };

      editor.onSaveToDisk = (dataURL) =>
        downloadDataURL(dataURL, "pixaroma_3d");

      editor.onClose = () => {
        node.setDirtyCanvas(true, true);
      };

      editor.open(sceneJson);
    });

    // ── DOM widget (sent to Python as kwargs["SceneWidget"]) ──
    let widget = node.addDOMWidget("SceneWidget", "custom", parts.container, {
      getValue: () => ({
        scene_json: sceneJson,
      }),
      setValue: (v) => {
        if (v && typeof v === "object") {
          sceneJson = v.scene_json || "{}";
          try {
            const meta = JSON.parse(sceneJson || "{}");
            if (P3D_PREVIEW_MODES.some((m) => m.id === meta.previewMode)) {
              previewMode = meta.previewMode;
            }
            _show3DNodePreview(parts, meta, node, previewMode, null, setPreviewMode);
          } catch {
            // silently ignore malformed JSON
          }
        }
      },
      getMinHeight: () => 245,
      margin: 5,
    });

    // cleanup when node is removed
    node.onRemoved = () => {
      widget = null;
    };

    activateNodePreview(parts, node);
  },
});

// Re-export for backward compatibility
export { Pixaroma3DEditor } from "./core.mjs";
