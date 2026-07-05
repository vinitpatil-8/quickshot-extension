document.querySelector("#screenshotBtn").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    if (!tab?.id) {
        return;
    }

    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["scripts/content.js"]
        });
    } catch (error) {
        console.error("Failed to inject the screenshot tool.", error);
    }
});
