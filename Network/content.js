/**
 * NETSPEED MONITOR - CLIENT AGENT (V12.1 - ULTRA STEALTH)
 */

(function() {
  if (window.NetSpeedAgent) return;
  window.NetSpeedAgent = true;

  const STORAGE_KEY = "calibration";
  const OPTION_LABELS = ["A", "B", "C", "D"];
  
  let calibrationMode = false;
  let calibrationPoints = [];
  let currentAnswerMarker = null;

  function showTinyMessage(msg) {
    const el = document.createElement('div');
    el.style.cssText = `position: fixed; bottom: 5px; left: 5px; color: black; font-size: 10px; font-family: monospace; z-index: 2147483647; background: transparent; pointer-events: none; margin: 0; padding: 0; border: none;`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  class CalibrationUI {
    constructor() {
      this.overlay = null;
      this.markers = [];
    }

    start() {
      if (this.overlay) this.stop();
      this.overlay = document.createElement('div');
      this.overlay.id = 'ns-calibration-overlay';
      this.overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 2147483647; cursor: crosshair; background: transparent;`;

      this.overlay.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.addPoint(e.clientX, e.clientY);
      });

      document.body.appendChild(this.overlay);
      calibrationMode = true;
      calibrationPoints = [];
    }

    addPoint(x, y) {
      if (calibrationPoints.length >= 4) return;
      const index = calibrationPoints.length;
      calibrationPoints.push({ x, y, label: OPTION_LABELS[index] });

      const marker = document.createElement('div');
      marker.style.cssText = `position: fixed; left: ${x - 2}px; top: ${y - 2}px; width: 4px; height: 4px; background: black; border-radius: 50%; z-index: 2147483648; pointer-events: none;`;
      document.body.appendChild(marker);
      this.markers.push(marker);

      // Force calibration dots to disappear after 2.5 seconds
      setTimeout(() => {
        if (marker && marker.parentNode) marker.remove();
      }, 2500);

      if (calibrationPoints.length === 4) {
        setTimeout(() => this.finish(), 300);
      }
    }

    async finish() {
      try {
        await chrome.storage.local.set({ [STORAGE_KEY]: { points: calibrationPoints, timestamp: Date.now() } });
        showTinyMessage("c"); 
      } catch (error) {
        showTinyMessage("e");
      }
      this.stop();
    }

    stop() {
      if (this.overlay) {
        this.overlay.remove();
        this.overlay = null;
      }
      this.markers.forEach(m => {
        if (m && m.parentNode) m.remove();
      });
      this.markers = [];
      calibrationMode = false;
    }
  }

  const calibrationUI = new CalibrationUI();

  async function showAnswer(answerData) {
    if (currentAnswerMarker) {
      currentAnswerMarker.remove();
      currentAnswerMarker = null;
    }

    try {
      const storage = await chrome.storage.local.get(STORAGE_KEY);
      const calib = storage[STORAGE_KEY];
      
      if (!calib || !calib.points || calib.points.length !== 4) {
        showTinyMessage("e");
        return;
      }

      const correctLetter = answerData.correct.toUpperCase();
      const point = calib.points.find(p => p.label === correctLetter);
      if (!point) return;

      currentAnswerMarker = document.createElement('div');
      currentAnswerMarker.style.cssText = `position: fixed; left: ${point.x - 3}px; top: ${point.y - 3}px; width: 6px; height: 6px; background: black; border-radius: 50%; z-index: 2147483647; pointer-events: none;`;
      document.body.appendChild(currentAnswerMarker);

      setTimeout(() => {
        if (currentAnswerMarker) {
          currentAnswerMarker.remove();
          currentAnswerMarker = null;
        }
      }, 2500);

    } catch (error) {
      showTinyMessage("e");
    }
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
      case "PING": sendResponse("OK"); break;
      case "START_CALIBRATION": calibrationUI.start(); break;
      case "SHOW_ANSWER": showAnswer(request.data); break;
      case "SHOW_ERROR": showTinyMessage("e"); break;
      case "SHOW_HISTORY":
        if (request.data && request.data.length > 0) {
          showTinyMessage(request.data[request.data.length - 1].correct);
        } else {
          showTinyMessage("-");
        }
        break;
      case "RESET_ALL":
        calibrationUI.stop();
        if (currentAnswerMarker) currentAnswerMarker.remove();
        showTinyMessage("r");
        break;
    }
  });
})();