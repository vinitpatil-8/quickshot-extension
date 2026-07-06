function blobToDataUrl(blob) {
    return blob.arrayBuffer().then((buffer) => {
        const bytes = new Uint8Array(buffer);
        const chunkSize = 0x8000;
        let binary = "";

        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }

        return `data:${blob.type};base64,${btoa(binary)}`;
    });
}

async function injectScreenshotTool(tabId) {
    await chrome.scripting.executeScript({
        target: { tabId },
        files: ["scripts/content.js"]
    });
}

async function startScreenshotInActiveTab() {
    const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true
    });

    if (!tab?.id) {
        throw new Error("No active tab is available for capture.");
    }

    await injectScreenshotTool(tab.id);
}

function captureVisibleTab(windowId) {
    return new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            resolve(dataUrl);
        });
    });
}

async function cropCapturedImage(dataUrl, options) {
    const { x, y, width, height, devicePixelRatio = 1 } = options;
    const imageResponse = await fetch(dataUrl);
    const imageBlob = await imageResponse.blob();
    const imageBitmap = await createImageBitmap(imageBlob);

    try {
        const scaledX = Math.max(0, Math.round(x * devicePixelRatio));
        const scaledY = Math.max(0, Math.round(y * devicePixelRatio));
        const scaledWidth = Math.max(1, Math.round(width * devicePixelRatio));
        const scaledHeight = Math.max(1, Math.round(height * devicePixelRatio));
        const canvas = new OffscreenCanvas(scaledWidth, scaledHeight);
        const ctx = canvas.getContext("2d");

        if (!ctx) {
            throw new Error("Unable to create a canvas context.");
        }

        ctx.drawImage(
            imageBitmap,
            scaledX,
            scaledY,
            scaledWidth,
            scaledHeight,
            0,
            0,
            scaledWidth,
            scaledHeight
        );

        const croppedBlob = await canvas.convertToBlob({ type: "image/png" });
        return blobToDataUrl(croppedBlob);
    } finally {
        imageBitmap.close();
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "start-screenshot") {
        (async () => {
            try {
                await startScreenshotInActiveTab();
                sendResponse({ ok: true });
            } catch (error) {
                sendResponse({ error: error instanceof Error ? error.message : String(error) });
            }
        })();

        return true;
    }

    if (message.type !== "capture") return;

    const { mode = "crop", x, y, width, height, devicePixelRatio = 1 } = message;
    const windowId = sender.tab?.windowId;

    if (windowId == null) {
        sendResponse({ error: "Unable to determine the tab window." });
        return;
    }

    (async () => {
        try {
            const image = await captureVisibleTab(windowId);

            if (mode === "preview") {
                sendResponse({ image });
                return;
            }

            const croppedImage = await cropCapturedImage(image, {
                x,
                y,
                width,
                height,
                devicePixelRatio
            });

            sendResponse({ image: croppedImage });
        } catch (error) {
            sendResponse({ error: error instanceof Error ? error.message : String(error) });
        }
    })();

    return true;
});

chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "start-screenshot") {
        return;
    }

    try {
        await startScreenshotInActiveTab();
    } catch (error) {
        console.error("Failed to start screenshot from keyboard shortcut.", error);
    }
});
