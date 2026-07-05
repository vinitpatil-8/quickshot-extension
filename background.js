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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== "capture") return;

    const { x, y, width, height, devicePixelRatio = 1 } = message;
    const windowId = sender.tab?.windowId;

    if (windowId == null) {
        sendResponse({ error: "Unable to determine the tab window." });
        return;
    }

    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, async (dataUrl) => {
        if (chrome.runtime.lastError) {
            sendResponse({ error: chrome.runtime.lastError.message });
            return;
        }

        try {
            const imageResponse = await fetch(dataUrl);
            const imageBlob = await imageResponse.blob();
            const imageBitmap = await createImageBitmap(imageBlob);

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

            imageBitmap.close();

            const croppedBlob = await canvas.convertToBlob({ type: "image/png" });
            const croppedDataUrl = await blobToDataUrl(croppedBlob);

            sendResponse({ image: croppedDataUrl });
        } catch (error) {
            sendResponse({ error: error instanceof Error ? error.message : String(error) });
        }
    });

    return true;
});
