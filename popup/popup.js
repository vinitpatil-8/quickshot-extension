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

// UI
var r = document.querySelector(':root');


function light_mode() {
    r.style.setProperty('--primary-bg', '#f6fcfc');
    r.style.setProperty('--primary-text', '#000');
    r.style.setProperty('--primary-tooltip', '#eeedee');
    r.style.setProperty('--primary-shadow', 'rgba(255, 255, 255, 0.25)');
}

const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

if (isDarkMode) {
    console.log("System is in Dark Mode");
} else {
    light_mode()
}

let mainPage1 = document.querySelector('.top');
let mainPage2 = document.querySelector('.buttons');
let mainButton = document.querySelector('#gobackbtn')
let settingsPage = document.querySelector('.settings');
let settingsButton = document.querySelector('#settingsBtn')

settingsButton.addEventListener('click', function (e) {
    mainPage1.classList.add('none');
    mainPage2.classList.add('none');
    settingsPage.classList.add('flex');
    console.log(innerHeight)
    setTimeout(() => {
        document.body.style.height = 300
    }, 50)
})

let initialHeight = window.innerHeight + 'px'

mainButton.addEventListener('click', function (e) {
    mainPage1.classList.remove('none');
    mainPage2.classList.remove('none');
    settingsPage.classList.remove('flex');
    setTimeout(() => {
        document.body.style.height = initialHeight
    }, 50)
})