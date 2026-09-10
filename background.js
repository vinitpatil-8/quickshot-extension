import { getSettings } from "./scripts/settings.js";

function blobToDataUrl(blob) {
    return blob.arrayBuffer().then((buffer) => {
        const bytes = new Uint8Array(buffer);
        const chunkSize = 0x8000;
        const chunks = [];

        for (let i = 0; i < bytes.length; i += chunkSize) {
            chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize)));
        }

        return `data:${blob.type};base64,${btoa(chunks.join(""))}`;
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
        const scaledX = Math.max(0, Math.floor(x * devicePixelRatio));
        const scaledY = Math.max(0, Math.floor(y * devicePixelRatio));
        const scaledWidth = Math.max(1, Math.ceil(width * devicePixelRatio));
        const scaledHeight = Math.max(1, Math.ceil(height * devicePixelRatio));
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

function safeSendMessageToTab(tabId, message) {
    if (tabId == null) return;
    chrome.tabs.sendMessage(tabId, message, () => {
        if (chrome.runtime.lastError) {
            // Ignore error if target tab/content script is missing or navigated
        }
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "start-recording") {
        (async () => {
            try {
                const settings = await getSettings();
                const recordOptions = message.options ? { ...settings, ...message.options } : settings;
                await startScreenRecording(recordOptions);
                sendResponse({ ok: true });
            } catch (error) {
                const errorMsg = (typeof error === 'object' && error !== null)
                    ? (error.formatted || error.message || String(error))
                    : String(error);
                sendResponse({ error: errorMsg });
            }
        })();
        return true;
    }

    if (message.type === "recording-finished" || message.type === "recording-error" || message.type === "recording-cancelled") {
        if (message.type === "recording-finished" || message.type === "recording-cancelled" || message.type === "recording-error") {
            closeOffscreenDocument();
        }
        
        // Forward to active tab so UI cleans up safely
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) safeSendMessageToTab(tabs[0].id, message);
        });
        
        if (message.type === "recording-finished") {
            const previewUrl = message.id 
                ? chrome.runtime.getURL(`preview/preview.html?id=${encodeURIComponent(message.id)}`)
                : chrome.runtime.getURL("preview/preview.html");
            chrome.tabs.create({ url: previewUrl });
        }
        return;
    }

    if (message.type === "recording-started" || message.type === "recording-paused" || message.type === "recording-resumed" || message.type === "recording-warning") {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            if (tabs[0]?.id) {
                if (message.type === "recording-started") {
                    try {
                        await chrome.scripting.insertCSS({
                            target: { tabId: tabs[0].id },
                            files: ["scripts/recording-ui.css"]
                        });
                        await chrome.scripting.executeScript({
                            target: { tabId: tabs[0].id },
                            files: ["scripts/recording-ui.js"]
                        });
                    } catch (err) {
                        console.warn("Could not inject recording UI into tab:", err);
                    }
                }
                safeSendMessageToTab(tabs[0].id, message);
            }
        });
        return;
    }

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
    if (command === "start-screenshot") {
        try {
            await startScreenshotInActiveTab();
        } catch (error) {
            console.error("Failed to start screenshot from keyboard shortcut.", error);
        }
    } else if (command === "start-recording") {
        try {
            const settings = await getSettings();
            await startScreenRecording(settings);
        } catch (error) {
            console.error("Failed to start recording from keyboard shortcut.", error);
        }
    } else if (command === "toggle-pause-recording") {
        chrome.runtime.sendMessage({ target: 'offscreen', type: 'toggle-pause-recording' }).catch(() => {});
    } else if (command === "stop-recording") {
        chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop-recording' }).catch(() => {});
    }
});

const OFFSCREEN_DOCUMENT_PATH = '/offscreen/offscreen.html';

async function hasOffscreenDocument() {
    if ('getContexts' in chrome.runtime) {
        const contexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
        });
        return Boolean(contexts.length);
    } else {
        const matchedClients = await clients.matchAll();
        return matchedClients.some(c => c.url.endsWith(OFFSCREEN_DOCUMENT_PATH));
    }
}

async function setupOffscreenDocument() {
    if (await hasOffscreenDocument()) {
        return;
    }
    await chrome.offscreen.createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ['USER_MEDIA'],
        justification: 'Recording screen'
    });
}

async function closeOffscreenDocument() {
    if (!(await hasOffscreenDocument())) {
        return;
    }
    await chrome.offscreen.closeDocument();
}

async function startScreenRecording(options = {}) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const targetTab = tabs.length > 0 ? tabs[0] : null;

    const streamId = await new Promise((resolve, reject) => {
        chrome.desktopCapture.chooseDesktopMedia(
            ['screen', 'window', 'tab', 'audio'],
            targetTab,
            (id) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(`Desktop capture error: ${chrome.runtime.lastError.message}`));
                    return;
                }
                if (!id) {
                    reject(new Error('User cancelled capture selection'));
                    return;
                }
                resolve(id);
            }
        );
    });

    await setupOffscreenDocument();

    chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'start-recording',
        streamId: streamId,
        options: options
    });
}
