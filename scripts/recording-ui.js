// QuickShot Recording UI — injected into page during active recording
// Namespace: quickshot-recording-*
// Must not interfere with screenshot overlay (content.js).

(() => {
    // Remove any existing overlay (prevents duplicates on repeated injections)
    const existing = document.getElementById('quickshot-recording-overlay');
    if (existing) {
        existing.remove();
    }

    let timerInterval = null;
    let seconds = 0;
    let isPaused = false;
    let messageListener = null;

    // ------------- Build overlay DOM -------------
    const overlay = document.createElement('div');
    overlay.id = 'quickshot-recording-overlay';

    overlay.innerHTML = `
        <div class="quickshot-status-group">
            <div class="quickshot-red-dot" id="quickshot-recording-dot"></div>
            <span class="quickshot-status-label" id="quickshot-status-label">REC</span>
        </div>
        <div id="quickshot-recording-timer">00:00</div>
        <div class="quickshot-divider"></div>
        <button id="quickshot-pause-btn" title="Pause/Resume" aria-label="Pause or Resume Recording">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
        </button>
        <button id="quickshot-stop-btn" title="Stop Recording" aria-label="Stop Recording">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h12v12H6z"/></svg>
        </button>
        <button id="quickshot-cancel-btn" title="Cancel Recording" aria-label="Cancel Recording">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
    `;

    document.body.appendChild(overlay);

    const timerEl = document.getElementById('quickshot-recording-timer');
    const dotEl = document.getElementById('quickshot-recording-dot');
    const statusLabel = document.getElementById('quickshot-status-label');
    const pauseBtn = document.getElementById('quickshot-pause-btn');
    const stopBtn = document.getElementById('quickshot-stop-btn');
    const cancelBtn = document.getElementById('quickshot-cancel-btn');

    // ------------- Timer -------------
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

    // ------------- Pause state helpers -------------
    function setPausedState() {
        isPaused = true;
        if (dotEl) { dotEl.style.animation = 'none'; dotEl.style.opacity = '0.4'; }
        if (statusLabel) statusLabel.textContent = 'PAUSED';
        if (pauseBtn) {
            pauseBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
            pauseBtn.title = 'Resume Recording';
            pauseBtn.setAttribute('aria-label', 'Resume Recording');
        }
    }

    function setRecordingState() {
        isPaused = false;
        if (dotEl) { dotEl.style.animation = 'quickshot-pulse 1.5s infinite'; dotEl.style.opacity = '1'; }
        if (statusLabel) statusLabel.textContent = 'REC';
        if (pauseBtn) {
            pauseBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
            pauseBtn.title = 'Pause Recording';
            pauseBtn.setAttribute('aria-label', 'Pause Recording');
        }
    }

    // ------------- Cleanup -------------
    function cleanup() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        if (messageListener) {
            try {
                chrome.runtime.onMessage.removeListener(messageListener);
            } catch (e) {}
            messageListener = null;
        }
        const currentOverlay = document.getElementById('quickshot-recording-overlay');
        if (currentOverlay) {
            currentOverlay.remove();
        }
    }

    // ------------- Button handlers -------------
    pauseBtn.addEventListener('click', () => {
        const type = isPaused ? 'resume-recording' : 'pause-recording';
        chrome.runtime.sendMessage({ type, target: 'offscreen' }, () => {
            if (chrome.runtime.lastError) {
                // Extension context may be unavailable, ignore
            }
        });
        // Optimistic UI update (background will confirm via message)
        if (isPaused) {
            setRecordingState();
        } else {
            setPausedState();
        }
    });

    stopBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'stop-recording', target: 'offscreen' }, () => {
            if (chrome.runtime.lastError) {}
        });
        cleanup();
    });

    cancelBtn.addEventListener('click', () => {
        if (confirm('Cancel recording? The current recording will be discarded.')) {
            chrome.runtime.sendMessage({ type: 'cancel-recording', target: 'offscreen' }, () => {
                if (chrome.runtime.lastError) {}
            });
            cleanup();
        }
    });

    // ------------- Listen for messages from background -------------
    messageListener = (message) => {
        switch (message.type) {
            case 'recording-finished':
            case 'recording-error':
            case 'recording-cancelled':
                cleanup();
                break;
            case 'recording-paused':
                setPausedState();
                break;
            case 'recording-resumed':
                setRecordingState();
                break;
        }
    };

    try {
        chrome.runtime.onMessage.addListener(messageListener);
    } catch (e) {
        // Extension context unavailable
    }
})();
