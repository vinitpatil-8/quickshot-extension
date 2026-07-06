document.querySelector("#screenshotBtn").addEventListener("click", async () => {
    try {
        const response = await chrome.runtime.sendMessage({ type: "start-screenshot" });

        if (response?.error) {
            console.error("Failed to start the screenshot tool.", response.error);
            return;
        }

        window.close();
    } catch (error) {
        console.error("Failed to start the screenshot tool.", error);
    }
});
