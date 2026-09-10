import { getSettings, saveSetting, DEFAULT_SETTINGS } from "../scripts/settings.js";

(async () => {
  const settings = await getSettings();

  const headerSection = document.querySelector(".top");
  const buttonsSection = document.querySelector(".buttons");
  const backButton = document.querySelector("#gobackbtn");
  const settingsPage = document.querySelector(".settings");
  const settingsButton = document.querySelector("#settingsBtn");

  const r = document.documentElement;

  const systemOpt = document.querySelector("#system");
  const darkOpt = document.querySelector("#dark");
  const lightOpt = document.querySelector("#light");
  const copyDirect = document.querySelector("#copyDirect");
  const downDirect = document.querySelector("#downDirect");
  const recordSystemAudio = document.querySelector("#recordSystemAudio");
  const recordMic = document.querySelector("#recordMic");
  const videoQuality = document.querySelector("#videoQuality");
  const videoFps = document.querySelector("#videoFps");

  document.querySelector("#screenshotBtn").addEventListener("click", async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "start-screenshot"
      });

      if (response?.error) {
        console.error(response.error);
        return;
      }

      window.close();
    } catch (error) {
      console.error(error);
    }
  });

  document.querySelector("#recordBtn").addEventListener("click", async () => {
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL("recorder/recorder.html?auto=true") });
      window.close();
    } catch (error) {
      console.error("Failed to open recorder tab:", error);
    }
  });

  document.querySelector("#historyBtn").addEventListener("click", async () => {
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL("history/history.html") });
      window.close();
    } catch (error) {
      console.error("Failed to open history tab:", error);
    }
  });

  function darkMode() {
    r.style.setProperty("--primary-bg", "#181818");
    r.style.setProperty("--primary-text", "#ffffff");
    r.style.setProperty("--primary-tooltip", "#303030");
    r.style.setProperty("--primary-shadow", "rgba(0,0,0,.25)");
  }

  function lightMode() {
    r.style.setProperty("--primary-bg", "#f6fcfc");
    r.style.setProperty("--primary-text", "#000");
    r.style.setProperty("--primary-tooltip", "#eeedee");
    r.style.setProperty("--primary-shadow", "rgba(255,255,255,.25)");
  }

  function applyTheme(theme) {
    switch (theme) {
      case "dark":
        darkMode();
        break;

      case "light":
        lightMode();
        break;

      default:
        if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
          darkMode();
        } else {
          lightMode();
        }
    }
  }

  async function saveTheme(theme) {
    await saveSetting("theme", theme);
    applyTheme(theme);
  }

  systemOpt.addEventListener("change", () => saveTheme("system"));
  darkOpt.addEventListener("change", () => saveTheme("dark"));
  lightOpt.addEventListener("change", () => saveTheme("light"));

  copyDirect.addEventListener("change", () => {
    saveSetting("autoCopy", copyDirect.checked);
  });

  downDirect.addEventListener("change", () => {
    saveSetting("autoDownload", downDirect.checked);
  });

  if (recordSystemAudio) {
    recordSystemAudio.addEventListener("change", () => {
      saveSetting("recordSystemAudio", recordSystemAudio.checked);
    });
  }

  if (recordMic) {
    recordMic.addEventListener("change", () => {
      saveSetting("recordMic", recordMic.checked);
    });
  }

  if (videoQuality) {
    videoQuality.addEventListener("change", () => {
      saveSetting("videoQuality", videoQuality.value);
    });
  }

  if (videoFps) {
    videoFps.addEventListener("change", () => {
      saveSetting("videoFps", parseInt(videoFps.value, 10));
    });
  }

  // Apply saved settings to UI
  switch (settings.theme) {
    case "dark":
      darkOpt.checked = true;
      break;
    case "light":
      lightOpt.checked = true;
      break;
    default:
      systemOpt.checked = true;
  }

  if (settings.autoCopy) copyDirect.checked = true;
  if (settings.autoDownload) downDirect.checked = true;
  if (recordSystemAudio) recordSystemAudio.checked = settings.recordSystemAudio !== false;
  if (recordMic) recordMic.checked = Boolean(settings.recordMic);
  if (videoQuality) videoQuality.value = settings.videoQuality || 'medium';
  if (videoFps) videoFps.value = String(settings.videoFps || 30);

  applyTheme(settings.theme);

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", () => {
    if (systemOpt.checked) {
      applyTheme("system");
    }
  });

  settingsButton.addEventListener("click", () => {
    headerSection.classList.add("none");
    buttonsSection.classList.add("none");
    settingsPage.classList.add("flex");
    document.body.style.height = "auto";
  });

  backButton.addEventListener("click", () => {
    headerSection.classList.remove("none");
    buttonsSection.classList.remove("none");
    settingsPage.classList.remove("flex");
    document.body.style.height = "";
  });
})();