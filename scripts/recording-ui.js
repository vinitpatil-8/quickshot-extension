(() => {
    let existing = document.getElementById('quickshot-recording-overlay');
    if (existing) {
        existing.remove();
    }

    let timerInterval = null;
    let seconds = 0;
    let isPaused = false;

    const overlay = document.createElement('div');
    overlay.id = 'quickshot-recording-overlay';
    
    overlay.innerHTML = `
        <div class="quickshot-red-dot" id="quickshot-recording-dot"></div>
        <div id="quickshot-recording-timer">00:00</div>
        <button id="quickshot-pause-btn" title="Pause/Resume">
            <svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
        </button>
        <button id="quickshot-stop-btn" title="Stop Recording">
            <svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>
        </button>
    `;

    document.body.appendChild(overlay);

    const timerEl = document.getElementById('quickshot-recording-timer');
    const dotEl = document.getElementById('quickshot-recording-dot');
    const pauseBtn = document.getElementById('quickshot-pause-btn');
    const stopBtn = document.getElementById('quickshot-stop-btn');

    function updateTimer() {
        if (!timerEl) return;
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        timerEl.textContent = `${m}:${s}`;
    }

    timerInterval = setInterval(() => {
        if (!isPaused) {
            seconds++;
            updateTimer();
        }
    }, 1000);

    pauseBtn.addEventListener('click', () => {
        isPaused = !isPaused;
        const type = isPaused ? 'pause-recording' : 'resume-recording';
        
        chrome.runtime.sendMessage({ type: type, target: 'offscreen' }, () => {
            if (chrome.runtime.lastError) {
                // Background/offscreen might have closed or encountered error
            }
        });
        
        if (isPaused) {
            dotEl.style.animation = 'none';
            dotEl.style.opacity = '0.5';
            pauseBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'; // Play icon
        } else {
            dotEl.style.animation = 'quickshot-pulse 1.5s infinite';
            dotEl.style.opacity = '1';
            pauseBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'; // Pause icon
        }
    });

    stopBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'stop-recording', target: 'offscreen' }, () => {
            if (chrome.runtime.lastError) {
                // Background/offscreen might have closed
            }
        });
        cleanup();
    });

    function cleanup() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        const currentOverlay = document.getElementById('quickshot-recording-overlay');
        if (currentOverlay) {
            currentOverlay.remove();
        }
    }

    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'recording-finished' || message.type === 'recording-error') {
            cleanup();
        }
    });
})();
