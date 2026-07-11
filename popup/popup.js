const settings = await chrome.storage.sync.get({
    theme: "system",
    autoCopy: false,
    autoDownload: false
});

let mainPage1 = document.querySelector('.top');
let mainPage2 = document.querySelector('.buttons');
let mainButton = document.querySelector('#gobackbtn');
let settingsPage = document.querySelector('.settings');
let settingsButton = document.querySelector('#settingsBtn');
let initialHeight = window.innerHeight + 'px';

const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

const r = document.documentElement;

let systemOpt = document.querySelector('#system');
let darkOpt = document.querySelector('#dark');
let lightOpt = document.querySelector('#light');


// Screenshot button

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


// ============================
// Theme
// ============================

function darkMode() {

    r.style.setProperty('--primary-bg', '#181818');
    r.style.setProperty('--primary-text', '#ffffff');
    r.style.setProperty('--primary-tooltip', '#303030');
    r.style.setProperty('--primary-shadow', 'rgba(0,0,0,.25)');

}

function lightMode() {

    r.style.setProperty('--primary-bg', '#f6fcfc');
    r.style.setProperty('--primary-text', '#000');
    r.style.setProperty('--primary-tooltip', '#eeedee');
    r.style.setProperty('--primary-shadow', 'rgba(255,255,255,.25)');

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

    await chrome.storage.sync.set({
        theme
    });

    applyTheme(theme);

}


// Radio buttons

systemOpt.addEventListener("change", () => saveTheme("system"));
darkOpt.addEventListener("change", () => saveTheme("dark"));
lightOpt.addEventListener("change", () => saveTheme("light"));


// Restore saved option

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

applyTheme(settings.theme);


// If user changes Windows theme while "System" is selected

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {

    if (systemOpt.checked) {
        applyTheme("system");
    }

});


// Settings page

settingsButton.addEventListener('click', () => {

    mainPage1.classList.add('none');
    mainPage2.classList.add('none');
    settingsPage.classList.add('flex');

    setTimeout(() => {
        document.body.style.height = '300px';
    }, 50);

});


mainButton.addEventListener('click', () => {

    mainPage1.classList.remove('none');
    mainPage2.classList.remove('none');
    settingsPage.classList.remove('flex');

    setTimeout(() => {
        document.body.style.height = initialHeight;
    }, 50);

});