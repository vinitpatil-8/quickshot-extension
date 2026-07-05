chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== "capture") return;

    const { x, y, width, height } = message;

    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {

        const img = new Image();

        img.onload = () => {
            const canvas = new OffscreenCanvas(width, height);
            const ctx = canvas.getContext("2d");

            ctx.drawImage(
                img,
                x, y, width, height,   // Source rectangle
                0, 0, width, height    // Destination rectangle
            );

            canvas.convertToBlob({ type: "image/png" }).then(blob => {
                const reader = new FileReader();

                reader.onloadend = () => {
                    sendResponse({
                        image: reader.result // Cropped base64
                    });
                };

                reader.readAsDataURL(blob);
            });
        };

        img.src = dataUrl;
    });

    return true;
});