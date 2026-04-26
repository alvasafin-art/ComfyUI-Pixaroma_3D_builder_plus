// ============================================================
// Pixaroma 3D Editor — local plus patch
// Adds:
// 1) live preview modes: All / Image / Overlay
// 2) node-preview save paths for All / Image / Overlay
// 3) linked multi-select transforms for the X/Y/Z transform sliders
// ============================================================

import {
  Pixaroma3DEditor,
  getTHREE,
  ThreeDAPI,
  createPanel,
} from "./core.mjs";

const PREVIEW_MODES = [
  { id: "all", label: "All", title: "Show background image + 3D overlay" },
  { id: "image", label: "Image", title: "Show only the background image" },
  { id: "overlay", label: "Overlay", title: "Show only the 3D overlay" },
];

function _safeSelectedTargets(editor) {
  const targets = editor.selectedObjs?.size
    ? [...editor.selectedObjs]
    : editor.activeObj
      ? [editor.activeObj]
      : [];
  return targets.filter((o) => o && !o.userData?.locked);
}

function _drawBackgroundImageToCanvas(editor, canvas, transparent = false) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!transparent) {
    ctx.fillStyle = editor.bgColor || "#6e6e6e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const img = editor.el?.bgImgEl;
  if (!img || !editor._bgImg?.path) return;

  const natW = editor._bgImg._natW || img.naturalWidth || canvas.width;
  const natH = editor._bgImg._natH || img.naturalHeight || canvas.height;
  const aspect = natW / Math.max(1, natH);

  const baseW = canvas.width;
  const baseH = baseW / aspect;
  const sc = (editor._bgImg.scale || 100) / 100;
  const iw = baseW * sc;
  const ih = baseH * sc;
  const cx = canvas.width / 2 + ((editor._bgImg.x || 0) / 100) * canvas.width;
  const cy = canvas.height / 2 + ((editor._bgImg.y || 0) / 100) * canvas.height;

  ctx.save();
  ctx.globalAlpha = (editor._bgImg.opacity ?? 100) / 100;
  ctx.translate(cx, cy);
  ctx.rotate(((editor._bgImg.rotation || 0) * Math.PI) / 180);
  ctx.scale(editor._bgImg._flipH ? -1 : 1, editor._bgImg._flipV ? -1 : 1);
  ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
  ctx.restore();
}

function _setButtonActive(btn, active) {
  btn.style.background = active ? "#f66744" : "#1e2022";
  btn.style.borderColor = active ? "#f66744" : "#3a3d40";
  btn.style.color = active ? "#fff" : "#ccc";
}

Pixaroma3DEditor.prototype._setPreviewMode = function (mode = "all") {
  if (!["all", "image", "overlay"].includes(mode)) mode = "all";
  this._previewMode = mode;

  const hasBgImage = !!(this.el?.bgImgEl && this._bgImg?.path);

  if (this.el?.bgContainer) {
    this.el.bgContainer.style.display = mode === "overlay" ? "none" : "";
  }

  if (this.renderer?.domElement) {
    // Image mode is a pure 2D preview: hide WebGL canvas without changing
    // object visibility, selection, layer state, or serialization.
    this.renderer.domElement.style.opacity = mode === "image" ? "0" : "1";
    this.renderer.domElement.style.pointerEvents = mode === "image" ? "none" : "";
  }

  if (this.scene) {
    if (mode === "overlay" || hasBgImage) {
      this.scene.background = null;
      this.renderer?.setClearColor?.(0x000000, 0);
    } else {
      const THREE = getTHREE();
      if (THREE) this.scene.background = new THREE.Color(this.bgColor || "#6e6e6e");
    }
  }

  this.el?.previewModeBtns?.forEach((btn) => {
    _setButtonActive(btn, btn.dataset.p3dPreviewMode === mode);
  });

  this._setStatus?.(
    mode === "all"
      ? "Preview: All"
      : mode === "image"
        ? "Preview: Image only"
        : "Preview: Overlay only",
  );
};

Pixaroma3DEditor.prototype._installPreviewModePanel = function (left) {
  if (this.el?.previewModePanel) return;

  const panel = createPanel("Preview", { collapsible: true, startCollapsed: false });
  const row = document.createElement("div");
  row.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:5px;";

  this.el.previewModeBtns = [];
  for (const def of PREVIEW_MODES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.p3dPreviewMode = def.id;
    btn.textContent = def.label;
    btn.title = def.title;
    btn.style.cssText = [
      "height:26px",
      "border:1px solid #3a3d40",
      "border-radius:4px",
      "background:#1e2022",
      "color:#ccc",
      "font-size:11px",
      "cursor:pointer",
      "font-family:inherit",
    ].join(";");
    btn.addEventListener("click", () => this._setPreviewMode(def.id));
    this.el.previewModeBtns.push(btn);
    row.appendChild(btn);
  }

  const hint = document.createElement("div");
  hint.textContent = "All = image + overlay. Image = background only. Overlay = 3D only.";
  hint.style.cssText = "font-size:10px;color:#888;margin-top:6px;line-height:1.35;";

  panel.content.append(row, hint);
  this.el.previewModePanel = panel.el;

  // Place directly after Canvas Settings when possible.
  const afterCanvas = this._canvasSettings?.el;
  if (afterCanvas?.parentNode === left) {
    left.insertBefore(panel.el, afterCanvas.nextSibling);
  } else {
    left.appendChild(panel.el);
  }

  this._setPreviewMode(this._previewMode || "all");
};

Pixaroma3DEditor.prototype._installLinkedTransformSliders = function () {
  if (this._linkedTransformSlidersInstalled || !this.el?.xformSliders) return;
  this._linkedTransformSlidersInstalled = true;

  const state = {
    snapshotted: false,
    start: null,
  };

  const resetState = () => {
    state.snapshotted = false;
    state.start = null;
  };

  const captureStart = () => {
    const active = this.activeObj;
    const targets = _safeSelectedTargets(this);
    if (active && !active.userData?.locked && !targets.includes(active)) targets.unshift(active);
    const map = new Map();
    for (const o of targets) {
      map.set(o, {
        pos: o.position.clone(),
        rot: o.rotation.clone(),
        scl: o.scale.clone(),
      });
    }
    return { active, targets, map };
  };

  const applyLinked = (axis, rawValue, sourceRow) => {
    const active = this.activeObj;
    if (!active || active.userData?.locked) return;

    let targets = _safeSelectedTargets(this);
    if (!targets.includes(active)) targets.unshift(active);
    if (!targets.length) return;

    if (!state.snapshotted) {
      this._pushUndo?.();
      state.snapshotted = true;
      state.start = captureStart();
    }

    const start = state.start;
    if (!start?.map?.has(active)) {
      state.start = captureStart();
    }

    const activeStart = state.start.map.get(active);
    const ax = axis.toLowerCase();
    const mode = this.toolMode;
    const val = Number(rawValue);
    if (!Number.isFinite(val)) return;

    if (mode === "move") {
      const delta = val - activeStart.pos[ax];
      for (const o of targets) {
        const s = state.start.map.get(o);
        if (!s) continue;
        o.position[ax] = s.pos[ax] + delta;
      }
    } else if (mode === "rotate") {
      const nextRad = (val * Math.PI) / 180;
      const delta = nextRad - activeStart.rot[ax];
      for (const o of targets) {
        const s = state.start.map.get(o);
        if (!s) continue;
        o.rotation[ax] = s.rot[ax] + delta;
      }
    } else if (mode === "scale") {
      const clamped = Math.max(0.01, val);
      const uniform = !!this.el.xformUniform?.checked;
      if (uniform) {
        const base = activeStart.scl[ax] || activeStart.scl.x || 1;
        const ratio = base ? clamped / base : 1;
        for (const o of targets) {
          const s = state.start.map.get(o);
          if (!s) continue;
          o.scale.set(
            Math.max(0.01, s.scl.x * ratio),
            Math.max(0.01, s.scl.y * ratio),
            Math.max(0.01, s.scl.z * ratio),
          );
        }
        // Keep the other two scale sliders visually in sync with the active object.
        for (const row of this.el.xformSliders || []) {
          row.slider.value = clamped;
          row.numIn.value = this._formatXformValue?.(clamped) ?? String(clamped);
        }
      } else {
        const base = activeStart.scl[ax] || 1;
        const ratio = base ? clamped / base : 1;
        for (const o of targets) {
          const s = state.start.map.get(o);
          if (!s) continue;
          o.scale[ax] = Math.max(0.01, s.scl[ax] * ratio);
        }
      }
    }

    if (sourceRow) {
      sourceRow.numIn.value = this._formatXformValue?.(val) ?? String(val);
    }

    this._updateShadowFrustum?.();
    this._syncOutlineSelection?.();
  };

  for (const row of this.el.xformSliders) {
    row.slider.addEventListener(
      "input",
      (e) => {
        e.stopImmediatePropagation();
        applyLinked(row.axis, row.slider.value, row);
      },
      true,
    );

    row.slider.addEventListener("change", resetState, true);
    row.slider.addEventListener("mouseup", resetState, true);
    row.slider.addEventListener("pointerup", resetState, true);

    row.numIn.addEventListener(
      "change",
      (e) => {
        e.stopImmediatePropagation();
        let v = Number(row.numIn.value);
        if (!Number.isFinite(v)) v = Number(row.slider.value);
        row.slider.value = v;
        applyLinked(row.axis, v, row);
        resetState();
      },
      true,
    );
  }
};

// Wrap _buildLeft after the original modules have installed it.
const _origBuildLeft = Pixaroma3DEditor.prototype._buildLeft;
Pixaroma3DEditor.prototype._buildLeft = function (left) {
  _origBuildLeft.call(this, left);
  this._installPreviewModePanel(left);
  this._installLinkedTransformSliders();
};

// Persist preview mode without changing original scene payload format.
const _origSerializeScene = Pixaroma3DEditor.prototype._serializeScene;
Pixaroma3DEditor.prototype._serializeScene = function () {
  const data = _origSerializeScene.call(this);
  data.previewMode = this._previewMode || "all";
  return data;
};

const _origRestoreScene = Pixaroma3DEditor.prototype._restoreScene;
Pixaroma3DEditor.prototype._restoreScene = function (jsonStr) {
  let mode = "all";
  try {
    const data = JSON.parse(jsonStr || "{}");
    if (["all", "image", "overlay"].includes(data.previewMode)) mode = data.previewMode;
  } catch {}

  _origRestoreScene.call(this, jsonStr);
  this._setPreviewMode?.(mode);
};

function _withSaveViewport(editor, callback) {
  const pr = editor.renderer.getPixelRatio();
  const vp = editor.el.viewport;
  const vpW = vp.clientWidth;
  const vpH = vp.clientHeight;
  const fr = editor._getFrameRect();

  const oldGrid = editor.gridHelper?.visible;
  const oldGizmo = editor._gizmoHelper?.visible;
  const oldFrame = editor._canvasFrame;
  const oldSceneBg = editor.scene.background;

  editor.renderer.setPixelRatio(1);
  editor.renderer.setSize(editor.docW, editor.docH);

  if ("aspect" in editor.camera) editor.camera.aspect = vpW / vpH;
  if (typeof editor.camera.setViewOffset === "function") {
    editor.camera.setViewOffset(vpW, vpH, fr.x, fr.y, fr.w, fr.h);
  }
  editor.camera.updateProjectionMatrix();

  if (editor.gridHelper) editor.gridHelper.visible = false;
  if (editor._gizmoHelper) editor._gizmoHelper.visible = false;
  if (oldFrame) oldFrame.setVisible(false);

  return Promise.resolve()
    .then(callback)
    .finally(() => {
      editor.scene.background = oldSceneBg;
      editor.camera.clearViewOffset?.();
      if (editor.gridHelper) editor.gridHelper.visible = oldGrid ?? editor._showGrid;
      if (editor._gizmoHelper) editor._gizmoHelper.visible = oldGizmo ?? editor._showGizmo;
      if (oldFrame) oldFrame.setVisible(true);
      editor.renderer.setPixelRatio(pr);
      editor._onResize();
      editor._setPreviewMode?.(editor._previewMode || "all");
    });
}

Pixaroma3DEditor.prototype._render3DOverlayDataURL = function () {
  const oldBg = this.scene.background;
  this.scene.background = null;
  this.renderer.setClearColor(0x000000, 0);
  this.renderer.render(this.scene, this.camera);
  const dataURL = this.renderer.domElement.toDataURL("image/png");
  this.scene.background = oldBg;
  return dataURL;
};

Pixaroma3DEditor.prototype._renderBackgroundImageDataURL = function (transparent = false) {
  const canvas = document.createElement("canvas");
  canvas.width = this.docW;
  canvas.height = this.docH;
  _drawBackgroundImageToCanvas(this, canvas, transparent);
  return canvas.toDataURL("image/png");
};

Pixaroma3DEditor.prototype._composeAllPreviewDataURL = function (overlayDataURL) {
  const hasBgImage = !!(this.el?.bgImgEl && this._bgImg?.path);

  if (!hasBgImage) {
    const THREE = getTHREE();
    this.scene.background = new THREE.Color(this.bgColor || "#6e6e6e");
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  const canvas = document.createElement("canvas");
  canvas.width = this.docW;
  canvas.height = this.docH;
  _drawBackgroundImageToCanvas(this, canvas, false);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(this.renderer.domElement, 0, 0);
  return canvas.toDataURL("image/png");
};

Pixaroma3DEditor.prototype._save = async function () {
  if (this._closed || !this.renderer) return;

  this._layout.setSaving();

  try {
    let allDataURL;
    let imageDataURL;
    let overlayDataURL;
    let transparentDiskDataURL = null;

    await _withSaveViewport(this, async () => {
      imageDataURL = this._renderBackgroundImageDataURL(false);
      overlayDataURL = this._render3DOverlayDataURL();
      allDataURL = this._composeAllPreviewDataURL(overlayDataURL);

      if (this._diskSavePending && this._transparentBg) {
        const hasBgImage = !!(this.el?.bgImgEl && this._bgImg?.path);
        if (hasBgImage) {
          const canvas = document.createElement("canvas");
          canvas.width = this.docW;
          canvas.height = this.docH;
          _drawBackgroundImageToCanvas(this, canvas, true);
          const ctx = canvas.getContext("2d");
          const img = new Image();
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = overlayDataURL;
          });
          ctx.drawImage(img, 0, 0);
          transparentDiskDataURL = canvas.toDataURL("image/png");
        } else {
          transparentDiskDataURL = overlayDataURL;
        }
      }
    });

    const allRes = await ThreeDAPI.saveRender(this.projectId, allDataURL);
    if (allRes.status !== "success") {
      this._layout.setSaveError("Save failed");
      return;
    }

    const imageRes = await ThreeDAPI.saveRender(`${this.projectId}_image`, imageDataURL);
    const overlayRes = await ThreeDAPI.saveRender(`${this.projectId}_overlay`, overlayDataURL);

    const sd = this._serializeScene();
    sd.composite_path = allRes.composite_path;
    sd.preview_paths = {
      all: allRes.composite_path,
      image: imageRes.status === "success" ? imageRes.composite_path : allRes.composite_path,
      overlay: overlayRes.status === "success" ? overlayRes.composite_path : allRes.composite_path,
    };
    sd.image_path = sd.preview_paths.image;
    sd.overlay_path = sd.preview_paths.overlay;
    sd.previewMode = this._previewMode || "all";

    const activePreview =
      sd.previewMode === "image"
        ? imageDataURL
        : sd.previewMode === "overlay"
          ? overlayDataURL
          : allDataURL;

    this.onSave?.(JSON.stringify(sd), activePreview);

    if (this._diskSavePending) {
      this._diskSavePending = false;
      this.onSaveToDisk?.(transparentDiskDataURL || allDataURL);
    }

    this._layout.setSaved();
  } catch (e) {
    console.error("[P3D]", e);
    this._layout.setSaveError("Save error");
  }
};

// Nudge the existing gizmo multi-drag logic so locked objects are not moved
// as linked followers, and sliders are refreshed after the follower delta lands.
const _origInitThree = Pixaroma3DEditor.prototype._initThree;
Pixaroma3DEditor.prototype._initThree = function () {
  _origInitThree.call(this);

  if (!this.transformCtrl || this._plusTransformCtrlPatched) return;
  this._plusTransformCtrlPatched = true;

  this.transformCtrl.addEventListener("dragging-changed", (e) => {
    if (!e.value || !this._multiDragStart) return;
    for (const [obj] of [...this._multiDragStart.entries()]) {
      if (obj.userData?.locked) this._multiDragStart.delete(obj);
    }
  });

  this.transformCtrl.addEventListener("objectChange", () => {
    this._updateTransformSliders?.();
    this._syncOutlineSelection?.();
  });

  this.transformCtrl.addEventListener("mouseUp", () => {
    this._updateTransformSliders?.();
    this._syncProps?.();
    this._updateLayers?.();
  });
};
