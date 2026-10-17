import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");

// Simple static server for dist/
function startServer(port = 8765) {
  const mimeTypes = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".json": "application/json",
  };

  const server = http.createServer((req, res) => {
    let reqPath = req.url.split("?")[0];
    if (reqPath === "/") reqPath = "/popup/popup.html";

    const filePath = path.join(distDir, reqPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
    });
    fs.createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve(server);
    });
  });
}

// Injected mock for chrome.* extension APIs
const chromeMockScript = `
window.chrome = {
  runtime: {
    getURL: (p) => 'http://localhost:8765/' + p.replace(/^\\//, ''),
    sendMessage: (msg) => Promise.resolve({ success: true }),
  },
  tabs: {
    create: (opts) => Promise.resolve({ id: 1, ...opts }),
  },
  storage: {
    sync: {
      get: (keys) => Promise.resolve(typeof keys === 'object' ? keys : {}),
      set: (data) => Promise.resolve(),
    },
  },
};
`;

async function runTests() {
  console.log("Starting static server on http://localhost:8765...");
  const server = await startServer(8765);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: "dark",
  });

  const screenshotsDir = path.resolve(__dirname, "screenshots");
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const results = {
    passed: [],
    failed: [],
  };

  function assert(condition, message) {
    if (condition) {
      console.log("  [PASS] " + message);
      results.passed.push(message);
    } else {
      console.error("  [FAIL] " + message);
      results.failed.push(message);
    }
  }

  async function setPageTheme(page, theme) {
    await page.evaluate((t) => {
      document.documentElement.setAttribute("data-theme", t);
      if (document.body) {
        if (t === "dark") {
          document.body.classList.remove("theme-light");
          document.body.classList.add("theme-dark");
        } else {
          document.body.classList.remove("theme-dark");
          document.body.classList.add("theme-light");
        }
      }
    }, theme);
    await page.waitForTimeout(100);
  }

  try {
    // ==========================================
    // 1. POPUP PAGE TESTS
    // ==========================================
    console.log("\n=== Testing Popup Page ===");
    const popupPage = await context.newPage();
    await popupPage.addInitScript(chromeMockScript);
    await popupPage.goto("http://localhost:8765/popup/popup.html");
    await popupPage.waitForLoadState("domcontentloaded");

    // Check main elements
    const brandTitle = await popupPage.textContent(".brand-title");
    assert(brandTitle === "QuickShot", "Popup has 'QuickShot' branding");

    const settingsBtn = await popupPage.$("#settingsBtn");
    assert(settingsBtn !== null, "#settingsBtn exists");

    const screenshotBtn = await popupPage.$("#screenshotBtn");
    const recordBtn = await popupPage.$("#recordBtn");
    const historyBtn = await popupPage.$("#historyBtn");

    assert(screenshotBtn !== null, "#screenshotBtn exists");
    assert(recordBtn !== null, "#recordBtn exists");
    assert(historyBtn !== null, "#historyBtn exists");

    // Check dimensions
    const ssBox = await screenshotBtn.boundingBox();
    assert(ssBox && ssBox.width > 200 && ssBox.height > 30, `#screenshotBtn is well-sized (${ssBox?.width}x${ssBox?.height})`);

    const recBox = await recordBtn.boundingBox();
    assert(recBox && recBox.width > 200 && recBox.height > 30, `#recordBtn is well-sized (${recBox?.width}x${recBox?.height})`);

    const histBox = await historyBtn.boundingBox();
    assert(histBox && histBox.width > 200 && histBox.height > 30, `#historyBtn is well-sized (${histBox?.width}x${histBox?.height})`);

    await popupPage.setViewportSize({ width: 340, height: 480 });
    await setPageTheme(popupPage, "dark");

    // Screenshot main view (Dark)
    await popupPage.screenshot({ path: path.join(screenshotsDir, "popup-main-dark.png") });

    // Open Settings
    await settingsBtn.click();
    await popupPage.waitForTimeout(200);

    const settingsVisible = await popupPage.isVisible(".settings");
    assert(settingsVisible, "Settings section is visible after clicking #settingsBtn");

    const systemRadio = await popupPage.$("#system");
    const darkRadio = await popupPage.$("#dark");
    const lightRadio = await popupPage.$("#light");
    assert(systemRadio !== null && darkRadio !== null && lightRadio !== null, "Theme options exist (#system, #dark, #light)");

    const copyDirect = await popupPage.$("#copyDirect");
    const downDirect = await popupPage.$("#downDirect");
    const recordSystemAudio = await popupPage.$("#recordSystemAudio");
    const recordMic = await popupPage.$("#recordMic");
    const videoQuality = await popupPage.$("#videoQuality");
    const videoFps = await popupPage.$("#videoFps");

    assert(copyDirect !== null, "#copyDirect checkbox exists");
    assert(downDirect !== null, "#downDirect checkbox exists");
    assert(recordSystemAudio !== null, "#recordSystemAudio checkbox exists");
    assert(recordMic !== null, "#recordMic checkbox exists");
    assert(videoQuality !== null, "#videoQuality select exists");
    assert(videoFps !== null, "#videoFps select exists");

    // Screenshot settings view (Dark)
    await popupPage.screenshot({ path: path.join(screenshotsDir, "popup-settings-dark.png") });

    // Switch to Light Mode
    await popupPage.evaluate(() => document.getElementById("light").click());
    await popupPage.waitForTimeout(200);
    const themeAttr = await popupPage.evaluate(() => document.documentElement.getAttribute("data-theme"));
    assert(themeAttr === "light", "Theme switched to light (data-theme='light')");

    // Go back to main view
    const gobackbtn = await popupPage.$("#gobackbtn");
    await gobackbtn.click();
    await popupPage.waitForTimeout(200);

    const mainVisibleAgain = await popupPage.isVisible(".buttons");
    assert(mainVisibleAgain, "Main actions are visible again after clicking #gobackbtn");

    // Screenshot main view (Light)
    await popupPage.screenshot({ path: path.join(screenshotsDir, "popup-main-light.png") });
    await popupPage.close();

    // ==========================================
    // 2. RECORDER PAGE TESTS
    // ==========================================
    console.log("\n=== Testing Recorder Page ===");
    const recorderPage = await context.newPage();
    await recorderPage.addInitScript(chromeMockScript);
    await recorderPage.goto("http://localhost:8765/recorder/recorder.html");
    await recorderPage.waitForLoadState("domcontentloaded");

    const startBtn = await recorderPage.$("#start-btn");
    assert(startBtn !== null, "Recorder has #start-btn");
    const startBtnBox = await startBtn.boundingBox();
    assert(startBtnBox && startBtnBox.width > 200 && startBtnBox.height >= 38, `Start button is prominent (${startBtnBox?.width}x${startBtnBox?.height})`);

    const statusBox = await recorderPage.$("#status-box");
    const statusText = await statusBox.textContent();
    assert(statusText.includes("Ready"), `Status box initial text is: "${statusText.trim()}"`);

    await setPageTheme(recorderPage, "dark");
    // Screenshot ready state (Dark)
    await recorderPage.screenshot({ path: path.join(screenshotsDir, "recorder-ready-dark.png") });

    // Test recording controls state
    await recorderPage.evaluate(() => {
      document.getElementById("start-btn").classList.add("hidden");
      document.getElementById("recording-controls").classList.remove("hidden");
      document.getElementById("status-box").textContent = "Recording in progress...";
      document.getElementById("timer-text").textContent = "00:42";
    });
    await recorderPage.waitForTimeout(100);

    const pauseBtn = await recorderPage.$("#pause-btn");
    const stopBtn = await recorderPage.$("#stop-btn");
    const cancelBtn = await recorderPage.$("#cancel-btn");
    assert(pauseBtn !== null, "#pause-btn exists");
    assert(stopBtn !== null, "#stop-btn exists");
    assert(cancelBtn !== null, "#cancel-btn exists");

    const pauseBox = await pauseBtn.boundingBox();
    const stopBox = await stopBtn.boundingBox();
    const cancelBox = await cancelBtn.boundingBox();
    assert(pauseBox && pauseBox.width > 60 && pauseBox.height > 25, "Pause button visible & sized");
    assert(stopBox && stopBox.width > 80 && stopBox.height > 25, "Stop button visible & sized");
    assert(cancelBox && cancelBox.width > 60 && cancelBox.height > 25, "Cancel button visible & sized");

    // Screenshot recording state (Dark)
    await recorderPage.screenshot({ path: path.join(screenshotsDir, "recorder-recording-dark.png") });

    // Test light theme
    await setPageTheme(recorderPage, "light");
    await recorderPage.evaluate(() => {
      document.getElementById("start-btn").classList.remove("hidden");
      document.getElementById("recording-controls").classList.add("hidden");
      document.getElementById("status-box").textContent = "Ready to start capture";
    });
    await recorderPage.waitForTimeout(100);
    await recorderPage.screenshot({ path: path.join(screenshotsDir, "recorder-ready-light.png") });

    await recorderPage.close();

    // ==========================================
    // 3. PREVIEW PAGE TESTS
    // ==========================================
    console.log("\n=== Testing Preview Page ===");
    const previewPage = await context.newPage();
    await previewPage.addInitScript(chromeMockScript);
    await previewPage.goto("http://localhost:8765/preview/preview.html");
    await previewPage.waitForLoadState("domcontentloaded");

    const previewVideo = await previewPage.$("#preview-video");
    assert(previewVideo !== null, "#preview-video exists");

    const downloadBtn = await previewPage.$("#download-btn");
    const historyBtnPreview = await previewPage.$("#history-btn");
    const discardBtn = await previewPage.$("#discard-btn");

    assert(downloadBtn !== null, "#download-btn exists");
    assert(historyBtnPreview !== null, "#history-btn exists");
    assert(discardBtn !== null, "#discard-btn exists");

    // Populate mock metadata to verify display
    await previewPage.evaluate(() => {
      document.getElementById("meta-filename").textContent = "QuickShot_2026-10-17_20-40-00.webm";
      document.getElementById("meta-date").textContent = "10/17/2026, 8:40:00 PM";
      document.getElementById("meta-duration").textContent = "01:25";
      document.getElementById("meta-size").textContent = "14.2 MB";
      document.getElementById("meta-type").textContent = "Screen (1920x1080)";
      document.getElementById("meta-audio").textContent = "🔊 Audio, 🎙 Mic";
      document.getElementById("error-msg").style.display = "none";
    });
    await previewPage.waitForTimeout(100);

    const dlBox = await downloadBtn.boundingBox();
    const histPBox = await historyBtnPreview.boundingBox();
    const discBox = await discardBtn.boundingBox();
    assert(dlBox && dlBox.width > 80 && dlBox.height > 25, `Download button visible (${dlBox?.width}x${dlBox?.height})`);
    assert(histPBox && histPBox.width > 80 && histPBox.height > 25, `History button visible (${histPBox?.width}x${histPBox?.height})`);
    assert(discBox && discBox.width > 60 && discBox.height > 25, `Discard button visible (${discBox?.width}x${discBox?.height})`);

    // Verify SVG icons inside buttons have non-zero geometry
    const dlSvg = await downloadBtn.$("svg");
    const dlSvgBox = await dlSvg.boundingBox();
    assert(dlSvgBox && dlSvgBox.width > 10 && dlSvgBox.height > 10, `Download SVG icon is visible and rendered (${dlSvgBox?.width}x${dlSvgBox?.height})`);

    await setPageTheme(previewPage, "dark");
    // Screenshot preview (Dark)
    await previewPage.screenshot({ path: path.join(screenshotsDir, "preview-dark.png") });

    // Preview in Light mode
    await setPageTheme(previewPage, "light");
    await previewPage.screenshot({ path: path.join(screenshotsDir, "preview-light.png") });

    await previewPage.close();

    // ==========================================
    // 4. HISTORY PAGE TESTS
    // ==========================================
    console.log("\n=== Testing History Page ===");
    const historyPage = await context.newPage();
    await historyPage.addInitScript(chromeMockScript);
    await historyPage.goto("http://localhost:8765/history/history.html");
    await historyPage.waitForLoadState("domcontentloaded");

    const newRecBtn = await historyPage.$("#new-rec-btn");
    assert(newRecBtn !== null, "#new-rec-btn exists in header");

    const searchInput = await historyPage.$("#search-input");
    assert(searchInput !== null, "#search-input exists");

    const filterType = await historyPage.$("#filter-type");
    const sortOrder = await historyPage.$("#sort-order");
    assert(filterType !== null, "#filter-type exists");
    assert(sortOrder !== null, "#sort-order exists");

    // Empty state check
    const startRecBtn = await historyPage.waitForSelector("#start-rec-btn", { timeout: 3000 });
    assert(startRecBtn !== null, "Empty state rendered #start-rec-btn");
    const startRecBox = await startRecBtn.boundingBox();
    assert(startRecBox && startRecBox.width > 80, `Start recording button visible in empty state (${startRecBox?.width}x${startRecBox?.height})`);

    await setPageTheme(historyPage, "dark");
    // Screenshot empty state
    await historyPage.screenshot({ path: path.join(screenshotsDir, "history-empty-dark.png") });

    // Inject mock recordings into IndexedDB and render cards
    await historyPage.evaluate(async () => {
      const dbRequest = indexedDB.open("QuickShotDB", 2);
      await new Promise((resolve, reject) => {
        dbRequest.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains("recordings")) {
            const store = db.createObjectStore("recordings", { keyPath: "id" });
            store.createIndex("createdAt", "createdAt", { unique: false });
          }
        };
        dbRequest.onsuccess = () => resolve(dbRequest.result);
        dbRequest.onerror = reject;
      });

      const db = dbRequest.result;
      const tx = db.transaction("recordings", "readwrite");
      const store = tx.objectStore("recordings");

      const dummyBlob = new Blob(["dummy video data"], { type: "video/webm" });

      store.put({
        id: "rec_mock_1",
        blob: dummyBlob,
        createdAt: Date.now() - 3600000,
        duration: 125,
        recordingType: "desktop",
        resolution: "1920x1080",
        fps: 30,
        audioEnabled: true,
        micEnabled: true,
        fileSize: 15400000,
        mimeType: "video/webm",
        filename: "Product_Demo_Full_Screen.webm",
      });

      store.put({
        id: "rec_mock_2",
        blob: dummyBlob,
        createdAt: Date.now() - 7200000,
        duration: 45,
        recordingType: "tab",
        resolution: "1280x720",
        fps: 60,
        audioEnabled: true,
        micEnabled: false,
        fileSize: 4200000,
        mimeType: "video/webm",
        filename: "Bug_Repro_Chrome_Tab.webm",
      });

      await new Promise((resolve) => {
        tx.oncomplete = resolve;
      });
    });

    // Reload page so history.js loads the newly injected recordings
    await historyPage.reload();
    await historyPage.waitForSelector(".recording-card", { timeout: 3000 });

    const cards = await historyPage.$$(".recording-card");
    assert(cards.length === 2, `History grid successfully rendered ${cards.length} cards`);

    // CRITICAL BUTTON AUDIT: verify every card action button is visible and has non-zero size
    const firstCard = cards[0];
    const btnPreview = await firstCard.$(".btn-preview");
    const btnDownload = await firstCard.$(".btn-download");
    const btnRename = await firstCard.$(".btn-rename");
    const btnDelete = await firstCard.$(".btn-delete");

    assert(btnPreview !== null, ".btn-preview exists on card");
    assert(btnDownload !== null, ".btn-download exists on card");
    assert(btnRename !== null, ".btn-rename exists on card");
    assert(btnDelete !== null, ".btn-delete exists on card");

    const bpBox = await btnPreview.boundingBox();
    const bdBox = await btnDownload.boundingBox();
    const brBox = await btnRename.boundingBox();
    const bdelBox = await btnDelete.boundingBox();

    assert(bpBox && bpBox.width > 30 && bpBox.height > 20, `Preview/Play button is visible & non-zero (${bpBox?.width}x${bpBox?.height})`);
    assert(bdBox && bdBox.width > 20 && bdBox.height > 20, `Download button is visible & non-zero (${bdBox?.width}x${bdBox?.height})`);
    assert(brBox && brBox.width > 20 && brBox.height > 20, `Rename button is visible & non-zero (${brBox?.width}x${brBox?.height})`);
    assert(bdelBox && bdelBox.width > 20 && bdelBox.height > 20, `Delete button is visible & non-zero (${bdelBox?.width}x${bdelBox?.height})`);

    // Verify SVGs inside action buttons have rendered dimensions
    const bpSvg = await btnPreview.$("svg");
    const bdSvg = await btnDownload.$("svg");
    const brSvg = await btnRename.$("svg");
    const bdelSvg = await btnDelete.$("svg");

    const bpSvgBox = await bpSvg.boundingBox();
    const bdSvgBox = await bdSvg.boundingBox();
    const brSvgBox = await brSvg.boundingBox();
    const bdelSvgBox = await bdelSvg.boundingBox();

    assert(bpSvgBox && bpSvgBox.width > 5, "Preview Play icon is visible and rendered");
    assert(bdSvgBox && bdSvgBox.width > 5, "Download icon is visible and rendered");
    assert(brSvgBox && brSvgBox.width > 5, "Rename icon is visible and rendered");
    assert(bdelSvgBox && bdelSvgBox.width > 5, "Delete icon is visible and rendered");

    // Ensure dark theme is set for dark screenshots
    await setPageTheme(historyPage, "dark");

    // Screenshot history with cards (Dark)
    await historyPage.screenshot({ path: path.join(screenshotsDir, "history-with-recordings-dark.png") });

    // Switch history to Light mode
    await setPageTheme(historyPage, "light");
    await historyPage.screenshot({ path: path.join(screenshotsDir, "history-with-recordings-light.png") });

    // Copy all screenshots to artifact directory
    const artifactScreenshotsDir = "C:\\Users\\admin\\.gemini\\antigravity-ide\\brain\\13115ca6-5c99-4035-9922-0735356487c1\\screenshots";
    if (!fs.existsSync(artifactScreenshotsDir)) {
      fs.mkdirSync(artifactScreenshotsDir, { recursive: true });
    }
    for (const f of fs.readdirSync(screenshotsDir)) {
      if (f.endsWith(".png")) {
        fs.copyFileSync(path.join(screenshotsDir, f), path.join(artifactScreenshotsDir, f));
      }
    }

    await historyPage.close();

  } catch (err) {
    console.error("Test execution error:", err);
    results.failed.push(`Exception: ${err.message}`);
  } finally {
    await browser.close();
    server.close();
  }

  console.log("\n==========================================");
  console.log(`TEST SUMMARY: ${results.passed.length} passed, ${results.failed.length} failed`);
  console.log("==========================================");

  if (results.failed.length > 0) {
    process.exit(1);
  }
}

runTests();
