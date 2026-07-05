(() => {
  const existingCleanup = window.__quickShotCleanup;

  if (typeof existingCleanup === "function") {
    existingCleanup();
  }

  const prevOverflow = document.documentElement.style.overflow;
  const prevUserSelect = document.documentElement.style.userSelect;

  document.documentElement.style.overflow = "hidden";
  document.documentElement.style.userSelect = "none";

  const interaction = document.createElement("div");

  interaction.style.cssText = `
  position:fixed;
  inset:0;
  z-index:2147483646;
  cursor:crosshair;
  `;

  document.body.appendChild(interaction);

  const selection = document.createElement("div");

  selection.style.cssText = `
  position:fixed;
  display:none;
  box-sizing:border-box;
  border:2px dashed white;
  background:transparent;
  pointer-events:none;
  z-index:2147483648;
  `;

  document.body.appendChild(selection);

  const overlays = [];

  for (let i = 0; i < 4; i++) {
    const div = document.createElement("div");

    div.style.cssText = `
      position:fixed;
      background:rgba(0,0,0,.65);
      pointer-events:none;
      z-index:2147483647;
      `;

    document.body.appendChild(div);
    overlays.push(div);
  }

  const [topOverlay, leftOverlay, rightOverlay, bottomOverlay] = overlays;

  topOverlay.style.left = "0";
  topOverlay.style.top = "0";
  topOverlay.style.width = "100vw";
  topOverlay.style.height = "100vh";

  let isSelecting = false;
  let isActive = true;
  let isReviewing = false;
  let startX = 0;
  let startY = 0;
  let capturedImage = null;

  const hint = document.createElement("div");
  const actionMenu = document.createElement("div");
  const copyButton = document.createElement("button");
  const downloadButton = document.createElement("button");
  const cancelButton = document.createElement("button");

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
  z-index:2147483648;
  `;

  document.body.appendChild(hint);

  actionMenu.style.cssText = `
  position:fixed;
  display:none;
  gap:6px;
  padding:6px;
  border-radius:999px;
  background:rgba(24,24,27,.96);
  box-shadow:0 10px 30px rgba(0,0,0,.35);
  pointer-events:auto;
  z-index:2147483648;
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
  document.body.appendChild(actionMenu);

  function setButtonsDisabled(disabled) {
    copyButton.disabled = disabled;
    downloadButton.disabled = disabled;
  }

  function positionActionMenu(rect) {
    actionMenu.style.display = "flex";

    const spacing = 8;
    const left = Math.min(
      window.innerWidth - actionMenu.offsetWidth - spacing,
      Math.max(spacing, rect.right - actionMenu.offsetWidth)
    );

    let top = rect.bottom + spacing;

    if (top + actionMenu.offsetHeight > window.innerHeight - spacing) {
      top = Math.max(spacing, rect.top - actionMenu.offsetHeight - spacing);
    }

    actionMenu.style.left = left + "px";
    actionMenu.style.top = top + "px";
  }

  function hideCaptureUi() {
    interaction.remove();
    selection.remove();
    hint.remove();
    overlays.forEach((overlay) => overlay.remove());
  }

  function showReviewUi(rect) {
    if (!document.body.contains(interaction)) {
      document.body.appendChild(interaction);
    }

    if (!document.body.contains(selection)) {
      document.body.appendChild(selection);
    }

    overlays.forEach((overlay) => {
      if (!document.body.contains(overlay)) {
        document.body.appendChild(overlay);
      }
    });

    interaction.style.pointerEvents = "auto";
    selection.style.display = "block";
    selection.style.left = rect.left + "px";
    selection.style.top = rect.top + "px";
    selection.style.width = rect.width + "px";
    selection.style.height = rect.height + "px";
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

  async function copyImageToClipboard() {
    if (!capturedImage) {
      return;
    }

    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      throw new Error("Clipboard image copy is not available on this page.");
    }

    const blob = await fetch(capturedImage).then((response) => response.blob());

    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob
      })
    ]);
  }

  copyButton.addEventListener("click", async () => {
    try {
      await copyImageToClipboard();
      cleanup();
    } catch (error) {
      console.error(error);
    }
  });

  downloadButton.addEventListener("click", () => {
    if (!capturedImage) {
      return;
    }

    const link = document.createElement("a");
    link.download = "screenshot.png";
    link.href = capturedImage;
    link.click();
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
    selection.style.display = "block";
  });

  interaction.addEventListener("mousemove", (e) => {
    if (!isSelecting) return;

    e.preventDefault();

    const currentX = e.clientX;
    const currentY = e.clientY;
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    selection.style.left = left + "px";
    selection.style.top = top + "px";
    selection.style.width = width + "px";
    selection.style.height = height + "px";

    topOverlay.style.left = "0";
    topOverlay.style.top = "0";
    topOverlay.style.width = viewportWidth + "px";
    topOverlay.style.height = top + "px";

    leftOverlay.style.left = "0";
    leftOverlay.style.top = top + "px";
    leftOverlay.style.width = left + "px";
    leftOverlay.style.height = height + "px";

    rightOverlay.style.left = left + width + "px";
    rightOverlay.style.top = top + "px";
    rightOverlay.style.width = viewportWidth - (left + width) + "px";
    rightOverlay.style.height = height + "px";

    bottomOverlay.style.left = "0";
    bottomOverlay.style.top = top + height + "px";
    bottomOverlay.style.width = viewportWidth + "px";
    bottomOverlay.style.height = viewportHeight - (top + height) + "px";
  });

  interaction.addEventListener("mouseup", (e) => {
    if (!isSelecting) return;

    e.preventDefault();

    isSelecting = false;
    isReviewing = true;

    const rect = selection.getBoundingClientRect();

    if (rect.width < 1 || rect.height < 1) {
      cleanup();
      return;
    }

    hideCaptureUi();

    waitForCleanPaint(() => {
      chrome.runtime.sendMessage(
        {
          type: "capture",
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          devicePixelRatio: window.devicePixelRatio
        },
        (response) => {
          if (!isActive) {
            return;
          }

          if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError);
            cleanup();
            return;
          }

          if (!response?.image) {
            console.error(response?.error || "Screenshot capture failed.");
            cleanup();
            return;
          }

          capturedImage = response.image;
          showReviewUi(rect);
          setButtonsDisabled(false);
          positionActionMenu(rect);
        }
      );
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
})();
