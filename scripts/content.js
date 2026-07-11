(async () => {
  const existingCleanup = window.__quickShotCleanup;

  if (typeof existingCleanup === "function") {
    existingCleanup();
  }

  function requestCapture(options) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "capture",
          ...options
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError);
            resolve(null);
            return;
          }

          if (!response?.image) {
            console.error(response?.error || "Screenshot capture failed.");
            resolve(null);
            return;
          }

          resolve(response.image);
        }
      );
    });
  }

  const mount = document.body || document.documentElement;

  if (!mount) {
    return;
  }

  const prevOverflow = document.documentElement.style.overflow;
  const prevUserSelect = document.documentElement.style.userSelect;

  document.documentElement.style.overflow = "hidden";
  document.documentElement.style.userSelect = "none";

  const interaction = document.createElement("div");
  const selection = document.createElement("div");
  const hint = document.createElement("div");
  const dimensionPill = document.createElement("div");
  const magnifier = document.createElement("div");
  const magnifierCanvas = document.createElement("canvas");
  const actionMenu = document.createElement("div");
  const copyButton = document.createElement("button");
  const downloadButton = document.createElement("button");
  const cancelButton = document.createElement("button");
  const overlays = [];
  const errorToast = document.createElement("div");
  const magnifierSize = 140;
  const magnifierZoom = 4;
  const overlayZIndex = 2147483647;
  const uiZIndex = 2147483648;
  const colorSchemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
  const magnifierCtx = magnifierCanvas.getContext("2d");
  const magnifierPixelSize = Math.round(magnifierSize * window.devicePixelRatio);
  const magnifierBorderColor = colorSchemeQuery?.matches
    ? "rgba(255,255,255,.95)"
    : "rgba(0,0,0,.95)";

  interaction.style.cssText = `
  position:fixed;
  inset:0;
  z-index:2147483646;
  cursor:crosshair;
  `;

  selection.style.cssText = `
  position:fixed;
  display:none;
  box-sizing:border-box;
  border:2px dashed white;
  background:transparent;
  pointer-events:none;
  z-index:${uiZIndex};
  `;

  for (let i = 0; i < 4; i += 1) {
    const overlay = document.createElement("div");

    overlay.style.cssText = `
    position:fixed;
    background:rgba(0,0,0,.65);
    pointer-events:none;
    z-index:${overlayZIndex};
    `;

    overlays.push(overlay);
  }

  const [topOverlay, leftOverlay, rightOverlay, bottomOverlay] = overlays;

  topOverlay.style.left = "0";
  topOverlay.style.top = "0";
  topOverlay.style.width = "100vw";
  topOverlay.style.height = "100vh";

  hint.textContent = "Press ESC to cancel";
  hint.style.cssText = `
  position:fixed;
  top:16px;
  left:50%;
  transform:translateX(-50%);
  padding:8px 12px;
  border-radius:999px;
  background:rgba(24,24,27,.92);
  color:#fafafa;
  font:12px/1.2 system-ui,sans-serif;
  box-shadow:0 10px 30px rgba(0,0,0,.25);
  pointer-events:none;
  z-index:${uiZIndex};
  `;

  dimensionPill.style.cssText = `
  position:fixed;
  top:16px;
  left:50%;
  transform:translateX(-50%);
  display:none;
  min-width:88px;
  padding:8px 12px;
  border-radius:999px;
  background:rgba(24,24,27,.92);
  color:#fafafa;
  text-align:center;
  font:12px/1.2 system-ui,sans-serif;
  box-shadow:0 10px 30px rgba(0,0,0,.25);
  pointer-events:none;
  z-index:${uiZIndex};
  `;

  errorToast.style.cssText = `
  position:fixed;
  bottom:24px;
  left:50%;
  transform:translateX(-50%);
  display:none;
  padding:8px 16px;
  border-radius:999px;
  background:#e04848;
  color:#fff;
  font:13px/1.2 system-ui,sans-serif;
  box-shadow:0 10px 30px rgba(0,0,0,.25);
  pointer-events:none;
  z-index:${uiZIndex + 1};
  `;

  magnifier.style.cssText = `
  position:fixed;
  display:none;
  width:${magnifierSize}px;
  height:${magnifierSize}px;
  border:2px solid ${magnifierBorderColor};
  border-radius:50%;
  overflow:hidden;
  background:rgba(24,24,27,.92);
  box-shadow:0 18px 40px rgba(0,0,0,.35);
  pointer-events:none;
  z-index:${uiZIndex};
  `;

  magnifierCanvas.width = magnifierPixelSize;
  magnifierCanvas.height = magnifierPixelSize;
  magnifierCanvas.style.cssText = `
  width:${magnifierSize}px;
  height:${magnifierSize}px;
  display:block;
  `;

  magnifier.appendChild(magnifierCanvas);

  actionMenu.style.cssText = `
  position:fixed;
  display:none;
  gap:6px;
  padding:6px;
  border-radius:999px;
  background:rgba(24,24,27,.96);
  box-shadow:0 10px 30px rgba(0,0,0,.35);
  pointer-events:auto;
  z-index:${uiZIndex};
  `;

  [copyButton, downloadButton, cancelButton].forEach((button) => {
    button.type = "button";
    button.disabled = true;
    button.style.cssText = `
    border:0;
    border-radius:999px;
    padding:6px 10px;
    background:#27272a;
    color:#fafafa;
    font:12px/1.2 system-ui,sans-serif;
    cursor:pointer;
    `;
  });

  copyButton.textContent = "Copy";
  downloadButton.textContent = "Download";
  cancelButton.textContent = "Cancel";
  cancelButton.disabled = false;

  actionMenu.append(copyButton, downloadButton, cancelButton);

  mount.appendChild(interaction);
  mount.appendChild(selection);
  overlays.forEach((overlay) => mount.appendChild(overlay));
  mount.appendChild(hint);
  mount.appendChild(dimensionPill);
  mount.appendChild(errorToast);
  mount.appendChild(magnifier);
  mount.appendChild(actionMenu);

  let isSelecting = false;
  let isActive = true;
  let isReviewing = false;
  let startX = 0;
  let startY = 0;
  let capturedImage = null;
  let captureFileName = null;
  let previewBitmap = null;

  function buildFileName(date = new Date()) {
    const parts = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
      String(date.getHours()).padStart(2, "0"),
      String(date.getMinutes()).padStart(2, "0"),
      String(date.getSeconds()).padStart(2, "0")
    ];

    return `QuickShot-${parts.join("-")}.png`;
  }

  function setButtonsDisabled(disabled) {
    copyButton.disabled = disabled;
    downloadButton.disabled = disabled;
  }

  function showErrorToast(message) {
    errorToast.textContent = message;
    errorToast.style.display = "block";

    setTimeout(() => {
      if (errorToast.parentNode) {
        errorToast.remove();
      }
    }, 3000);
  }

  function setCopyResult(success) {
    const originalText = "Copy";

    copyButton.textContent = success ? "Copied!" : "Failed";
    copyButton.style.background = success ? "#2a7a2a" : "#a03030";

    setTimeout(() => {
      copyButton.textContent = originalText;
      copyButton.style.background = "";
    }, 2000);
  }

  function positionActionMenu(rect) {
    actionMenu.style.display = "flex";

    actionMenu.getBoundingClientRect();

    const spacing = 8;
    const left = Math.min(
      window.innerWidth - actionMenu.offsetWidth - spacing,
      Math.max(spacing, rect.right - actionMenu.offsetWidth)
    );

    let top = rect.bottom + spacing;

    if (top + actionMenu.offsetHeight > window.innerHeight - spacing) {
      top = Math.max(spacing, rect.top - actionMenu.offsetHeight - spacing);
    }

    actionMenu.style.left = `${left}px`;
    actionMenu.style.top = `${top}px`;
  }

  function updateSelectionUi(left, top, width, height) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    selection.style.left = `${left}px`;
    selection.style.top = `${top}px`;
    selection.style.width = `${width}px`;
    selection.style.height = `${height}px`;

    topOverlay.style.left = "0";
    topOverlay.style.top = "0";
    topOverlay.style.width = `${viewportWidth}px`;
    topOverlay.style.height = `${top}px`;

    leftOverlay.style.left = "0";
    leftOverlay.style.top = `${top}px`;
    leftOverlay.style.width = `${left}px`;
    leftOverlay.style.height = `${height}px`;

    rightOverlay.style.left = `${left + width}px`;
    rightOverlay.style.top = `${top}px`;
    rightOverlay.style.width = `${viewportWidth - (left + width)}px`;
    rightOverlay.style.height = `${height}px`;

    bottomOverlay.style.left = "0";
    bottomOverlay.style.top = `${top + height}px`;
    bottomOverlay.style.width = `${viewportWidth}px`;
    bottomOverlay.style.height = `${viewportHeight - (top + height)}px`;
  }

  function updateDimensionPill(width, height) {
    dimensionPill.textContent = `${Math.round(width)} x ${Math.round(height)}`;
    dimensionPill.style.display = "block";
  }

  function updateMagnifier(clientX, clientY) {
    if (!previewBitmap || !magnifierCtx) {
      return;
    }

    const offset = 24;
    let left = clientX + offset;
    let top = clientY + offset;

    if (left + magnifierSize > window.innerWidth - 8) {
      left = clientX - magnifierSize - offset;
    }

    if (top + magnifierSize > window.innerHeight - 8) {
      top = clientY - magnifierSize - offset;
    }

    magnifier.style.left = `${Math.max(8, left)}px`;
    magnifier.style.top = `${Math.max(8, top)}px`;

    const sourceSize = magnifierCanvas.width / magnifierZoom;
    const maxSourceX = Math.max(0, previewBitmap.width - sourceSize);
    const maxSourceY = Math.max(0, previewBitmap.height - sourceSize);
    const sourceX = Math.min(
      maxSourceX,
      Math.max(0, clientX * window.devicePixelRatio - sourceSize / 2)
    );
    const sourceY = Math.min(
      maxSourceY,
      Math.max(0, clientY * window.devicePixelRatio - sourceSize / 2)
    );
    const center = magnifierCanvas.width / 2;

    magnifierCtx.imageSmoothingEnabled = false;
    magnifierCtx.clearRect(0, 0, magnifierCanvas.width, magnifierCanvas.height);
    magnifierCtx.drawImage(
      previewBitmap,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      magnifierCanvas.width,
      magnifierCanvas.height
    );

    magnifierCtx.strokeStyle = colorSchemeQuery?.matches
      ? "rgba(255,255,255,.9)"
      : "rgba(0,0,0,.9)";
    magnifierCtx.lineWidth = Math.max(1, window.devicePixelRatio);
    magnifierCtx.beginPath();
    magnifierCtx.moveTo(center, 0);
    magnifierCtx.lineTo(center, magnifierCanvas.height);
    magnifierCtx.moveTo(0, center);
    magnifierCtx.lineTo(magnifierCanvas.width, center);
    magnifierCtx.stroke();
  }

  function hideCaptureUi() {
    interaction.remove();
    selection.remove();
    hint.remove();
    dimensionPill.remove();
    errorToast.remove();
    magnifier.remove();
    overlays.forEach((overlay) => overlay.remove());
  }

  function showReviewUi(rect) {
    if (!mount.contains(interaction)) {
      mount.appendChild(interaction);
    }

    if (!mount.contains(selection)) {
      mount.appendChild(selection);
    }

    overlays.forEach((overlay) => {
      if (!mount.contains(overlay)) {
        mount.appendChild(overlay);
      }
    });

    interaction.style.pointerEvents = "none";
    interaction.style.cursor = "default";
    selection.style.display = "block";
    updateSelectionUi(rect.left, rect.top, rect.width, rect.height);
  }

  async function copyImageData(dataUrl) {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      throw new Error("Clipboard image copy is not available on this page.");
    }

    const blob = await fetch(dataUrl).then((response) => response.blob());

    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob
      })
    ]);
  }

  function downloadImage(dataUrl, fileName) {
    const link = document.createElement("a");
    link.download = fileName;
    link.href = dataUrl;
    link.click();
  }

  async function autoApplyActions(image, rect) {
    const settings = await chrome.storage.sync.get({
      autoCopy: false,
      autoDownload: false
    });

    if (settings.autoCopy && settings.autoDownload) {
      try {
        await copyImageData(image);
      } catch (error) {
        console.error(error);
      }

      downloadImage(image, buildFileName());
      cleanup();
      return;
    }

    if (settings.autoCopy) {
      try {
        await copyImageData(image);
        setCopyResult(true);
      } catch (error) {
        console.error(error);
        setCopyResult(false);
      }
    }

    if (settings.autoDownload) {
      downloadImage(image, buildFileName());
      cleanup();
      return;
    }

    capturedImage = image;
    captureFileName = buildFileName();
    showReviewUi(rect);
    setButtonsDisabled(false);
    positionActionMenu(rect);
  }

  function waitForCleanPaint(callback) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (isActive) {
          callback();
        }
      });
    });
  }

  function cleanup() {
    if (!isActive) {
      return;
    }

    isActive = false;
    hideCaptureUi();
    actionMenu.remove();
    document.removeEventListener("keydown", handleKeyDown, true);
    document.documentElement.style.overflow = prevOverflow;
    document.documentElement.style.userSelect = prevUserSelect;

    if (previewBitmap) {
      previewBitmap.close();
      previewBitmap = null;
    }

    if (window.__quickShotCleanup === cleanup) {
      delete window.__quickShotCleanup;
    }
  }

  window.__quickShotCleanup = cleanup;

  function handleKeyDown(e) {
    if (e.key !== "Escape") return;

    e.preventDefault();
    e.stopPropagation();
    cleanup();
  }

  document.addEventListener("keydown", handleKeyDown, true);

  copyButton.addEventListener("click", async () => {
    if (!capturedImage) {
      return;
    }

    try {
      await copyImageData(capturedImage);
      setCopyResult(true);
    } catch (error) {
      console.error(error);
      setCopyResult(false);
    }
  });

  downloadButton.addEventListener("click", () => {
    if (!capturedImage) {
      return;
    }

    downloadImage(capturedImage, captureFileName || buildFileName());
    cleanup();
  });

  cancelButton.addEventListener("click", () => {
    cleanup();
  });

  interaction.addEventListener("mousedown", (e) => {
    e.preventDefault();

    if (isReviewing) {
      return;
    }

    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;
    hint.style.display = "none";
    dimensionPill.style.display = "block";
    updateDimensionPill(0, 0);
    selection.style.display = "block";
    interaction.style.cursor = "crosshair";
    updateSelectionUi(startX, startY, 0, 0);
  });

  interaction.addEventListener("mousemove", (e) => {
    if (previewBitmap && magnifierCtx && !isReviewing) {
      updateMagnifier(e.clientX, e.clientY);
    }

    if (!isSelecting) {
      return;
    }

    e.preventDefault();

    const currentX = e.clientX;
    const currentY = e.clientY;
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    updateSelectionUi(left, top, width, height);
    updateDimensionPill(width, height);
  });

  interaction.addEventListener("mouseup", (e) => {
    if (!isSelecting) return;

    e.preventDefault();

    isSelecting = false;
    isReviewing = true;
    dimensionPill.style.display = "none";

    const rect = selection.getBoundingClientRect();

    if (rect.width < 1 || rect.height < 1) {
      cleanup();
      return;
    }

    hideCaptureUi();

    waitForCleanPaint(async () => {
      const image = await requestCapture({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        devicePixelRatio: window.devicePixelRatio
      });

      if (!isActive) {
        return;
      }

      if (!image) {
        showErrorToast("Screenshot capture failed.");
        cleanup();
        return;
      }

      await autoApplyActions(image, rect);
    });
  });

  interaction.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
    },
    { passive: false }
  );

  interaction.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });

  try {
    const previewImage = await requestCapture({ mode: "preview" });

    if (previewImage) {
      const previewResponse = await fetch(previewImage);
      const previewBlob = await previewResponse.blob();
      previewBitmap = await createImageBitmap(previewBlob);
      magnifier.style.display = "block";
    }
  } catch (error) {
    console.error("Failed to prepare the magnifier preview.", error);
  }
})();
