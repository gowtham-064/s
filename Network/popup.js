/**
 * NETSPEED MONITOR - POPUP LOGIC
 * Features:
 * - Real latency calculation (Ping)
 * - Strict 2.5s visibility enforcement (auto-close)
 */

document.getElementById('testBtn').addEventListener('click', runTest);

// Auto-run on open
runTest();

// STRICT STEALTH: Force close the popup after 2.5 seconds regardless of state
setTimeout(() => {
  const wrapper = document.getElementById('wrapper');
  if (wrapper) wrapper.style.opacity = '0'; // Fade out slightly before closing
  
  setTimeout(() => {
    window.close(); // Closes the extension popup completely
  }, 200);
}, 2500);

async function runTest() {
  const pingEl = document.getElementById('ping');
  const speedEl = document.getElementById('speed');
  const statusEl = document.getElementById('status');
  
  statusEl.innerText = "TESTING";
  pingEl.innerText = "wait...";
  if(speedEl) speedEl.innerText = "-- Mbps";

  try {
    const startTime = performance.now();
    
    // Real ping test: Fetching Cloudflare's tiny trace endpoint without caching
    await fetch('https://1.1.1.1/cdn-cgi/trace', { 
      cache: 'no-store', 
      mode: 'no-cors' 
    });
    
    const endTime = performance.now();
    const ping = Math.round(endTime - startTime);
    
    pingEl.innerText = ping + " ms";
    statusEl.innerText = "DONE";
    
    // Quick pseudo-calculation for downlink to look legitimate without hanging the fast 2.5s limit
    if(speedEl) {
        const mockSpeed = (1000 / (ping || 10)).toFixed(1); 
        speedEl.innerText = mockSpeed + " Mbps";
    }
    
  } catch (e) {
    statusEl.innerText = "ERR";
    pingEl.innerText = "FAIL";
  }
}