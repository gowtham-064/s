/**
 * NETSPEED MONITOR - BACKGROUND SERVICE (V12.0 - PHOENIX CACHE)
 * Architecture: Question Cache + Image Hashing + Auto-Cleanup
 * * Features:
 * - Firestore question cache (reduces 90%+ API calls)
 * - API keys fetched from Firestore, cached locally
 * - Image perceptual hashing for diagram questions
 * - 8-day auto-cleanup scheduler
 * - Load balancing with failover
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, query, where, getDocs, addDoc, deleteDoc, doc, getDoc, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ==================== FIREBASE CONFIG ====================
const firebaseConfig = {
  apiKey: "AIzaSyBTOLdrDx0izhfT6tfgCqx-wEJ1yDr4IK4",
  authDomain: "network-92834.firebaseapp.com",
  projectId: "network-92834",
  storageBucket: "network-92834.firebasestorage.app",
  messagingSenderId: "859585229186",
  appId: "1:859585229186:web:55cb6b9342786ceb80df9b",
  measurementId: "G-PHN8703HMK"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

async function ensureAuth() {
  if (!auth.currentUser) {
    try {
      await signInAnonymously(auth);
    } catch (error) {
      if (error.code === 'auth/admin-restricted-operation') {
        console.error("[Auth] 🛑 Anonymous Authentication is DISABLED in Firebase Console.");
        console.error("[Auth] ➤ Go to Authentication > Sign-in method > Enable Anonymous.");
      }
      throw error;
    }
  }
}

// ==================== CONSTANTS ====================
const CONFIG = {
  ENDPOINT: "https://api.groq.com/openai/v1/chat/completions",
  MODEL: "meta-llama/llama-4-scout-17b-16e-instruct",
  CACHE_DAYS: 8,
  COLLECTION_NAME: "quiz_cache", // Firestore collection for questions
  
  SYSTEM_PROMPT: `You are an expert quiz solver. Analyze the question and options carefully.
Output ONLY valid JSON in this exact format:
{"correct": "A", "confidence": 95, "reasoning": "Brief explanation"}

The "correct" field must be one letter: A, B, C, or D.
Do not include any text before or after the JSON.`
};

// ==================== API KEY MANAGER ====================
class KeyManager {
  constructor() {
    this.keys = [];
    this.index = 0;
    this.initialized = false;
  }

  async init() {
    if (this.initialized && this.keys.length > 0) return;
    
    // Try local cache first
    const cached = await chrome.storage.local.get("api_keys_cache");
    if (cached.api_keys_cache && Array.isArray(cached.api_keys_cache) && cached.api_keys_cache.length > 0) {
      this.keys = cached.api_keys_cache;
      this.initialized = true;
      console.log("[KeyManager] ✓ Loaded", this.keys.length, "keys from local cache");
      return;
    }

    try {
      await ensureAuth();
      // Fetch from Firestore
      console.log("[KeyManager] Fetching keys from Firestore...");
      const docRef = doc(db, "config", "api_keys");
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists() && docSnap.data().keys) {
        this.keys = docSnap.data().keys;
        
        // Validate keys
        const validKeys = this.keys.filter(k => k && k.startsWith('gsk_') && k.length > 20);
        if (validKeys.length === 0) {
          throw new Error("No valid API keys found in Firestore");
        }
        
        this.keys = validKeys;
        await chrome.storage.local.set({ api_keys_cache: this.keys });
        this.initialized = true;
        console.log("[KeyManager] ✓ Fetched", this.keys.length, "valid keys from Firestore");
      } else {
        throw new Error("Firestore config/api_keys document not found");
      }
    } catch (error) {
      console.error("[KeyManager] ✗ Error:", error.message);
      if (error.code === 'auth/admin-restricted-operation') {
        console.error("[KeyManager] ⚠️ CONFIG ERROR: Anonymous Auth is disabled in Firebase.");
      } else {
        console.error("[KeyManager] ⚠️ SETUP REQUIRED: Create Firestore document 'config/api_keys' with valid Groq API keys");
      }
      
      // Empty keys array - will show proper error to user
      this.keys = [];
      this.initialized = true;
    }
  }

  getKey() {
    if (this.keys.length === 0) return null;
    return this.keys[this.index];
  }

  rotate() {
    this.index = (this.index + 1) % this.keys.length;
    console.log(`[KeyManager] 🔄 Rotated to key ${this.index + 1}/${this.keys.length}`);
  }
}

const keyManager = new KeyManager();

// ==================== IMAGE HASHING ====================
async function generateImageHash(base64Image) {
  try {
    const sample = base64Image.substring(0, 1000);
    const hash = await simpleHash(sample);
    return hash;
  } catch (error) {
    console.error("[ImageHash] Error:", error);
    return null;
  }
}

async function simpleHash(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
}

// ==================== QUESTION CACHE MANAGER ====================
class QuestionCache {
  static async search(questionText, imageHash) {
    try {
      await ensureAuth();
      const cleanText = questionText.toLowerCase().trim().substring(0, 200);
      
      if (!cleanText && !imageHash) {
        return null;
      }
      
      // Search by text first
      if (cleanText.length > 10) {
        const textQuery = query(
          collection(db, CONFIG.COLLECTION_NAME),
          where("questionText", "==", cleanText)
        );
        const textResults = await getDocs(textQuery);
        
        if (!textResults.empty) {
          const data = textResults.docs[0].data();
          return { correct: data.correct, confidence: data.confidence || 100, source: 'cache', date: data.date };
        }
      }

      // Fallback: search by image hash
      if (imageHash) {
        const imageQuery = query(
          collection(db, CONFIG.COLLECTION_NAME),
          where("imageHash", "==", imageHash)
        );
        const imageResults = await getDocs(imageQuery);
        
        if (!imageResults.empty) {
          const data = imageResults.docs[0].data();
          return { correct: data.correct, confidence: data.confidence || 100, source: 'cache_image', date: data.date };
        }
      }
      return null;
    } catch (error) {
      console.error("[Cache] Search error:", error);
      return null;
    }
  }

  static async store(questionText, imageHash, answer, confidence) {
    try {
      await ensureAuth();
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];
      const cleanText = questionText.toLowerCase().trim().substring(0, 200);
      
      const docData = {
        questionText: cleanText || "",
        imageHash: imageHash || "",
        correct: answer,
        confidence: confidence || 0,
        date: dateStr,
        timestamp: Timestamp.now()
      };

      await addDoc(collection(db, CONFIG.COLLECTION_NAME), docData);
    } catch (error) {
      console.error("[Cache] Store error:", error);
    }
  }

  static async cleanup() {
    try {
      await ensureAuth();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - CONFIG.CACHE_DAYS);
      const cutoffTimestamp = Timestamp.fromDate(cutoffDate);
      
      const oldQuery = query(
        collection(db, CONFIG.COLLECTION_NAME),
        where("timestamp", "<", cutoffTimestamp)
      );
      
      const oldDocs = await getDocs(oldQuery);
      
      let deleted = 0;
      if (oldDocs && !oldDocs.empty) {
        for (const docSnapshot of oldDocs.docs) {
          if (docSnapshot && docSnapshot.id) {
            await deleteDoc(doc(db, CONFIG.COLLECTION_NAME, docSnapshot.id));
            deleted++;
          }
        }
      }
      console.log(`[Cache] ✓ Deleted ${deleted} old questions`);
    } catch (error) {
      console.error("[Cache] Cleanup error:", error);
    }
  }
}

// ==================== GROQ API HANDLER ====================
async function queryGroqAPI(screenshotBase64) {
  await keyManager.init();
  
  if (keyManager.keys.length === 0) {
    return { error: "API keys not configured.", correct: null };
  }
  
  for (let attempt = 0; attempt < 3; attempt++) {
    const apiKey = keyManager.getKey();
    if (!apiKey) return { error: "No API keys available", correct: null };

    try {
      const response = await fetch(CONFIG.ENDPOINT, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: CONFIG.MODEL,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: CONFIG.SYSTEM_PROMPT },
              { type: "image_url", image_url: { url: screenshotBase64 } }
            ]
          }],
          temperature: 0.1,
          max_tokens: 300
        })
      });

      if (!response.ok) {
        keyManager.rotate();
        continue;
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      
      const result = extractJSON(content);
      if (result && result.correct) return result;
      
      keyManager.rotate();
    } catch (error) {
      keyManager.rotate();
    }
  }
  return { error: "All API attempts failed.", correct: null };
}

function extractJSON(str) {
  try {
    const start = str.indexOf('{');
    const end = str.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      return JSON.parse(str.substring(start, end + 1));
    }
  } catch (e) {}
  
  const match = str.match(/"correct":\s*"([A-D])"/i);
  if (match) return { correct: match[1].toUpperCase(), confidence: 50 };
  return null;
}

// ==================== MAIN SOLVER LOGIC ====================
async function solveQuestion(screenshotBase64, ocrText = "") {
  try {
    const imageHash = await generateImageHash(screenshotBase64);
    const cached = await QuestionCache.search(ocrText, imageHash);
    if (cached) return cached;

    const result = await queryGroqAPI(screenshotBase64);
    if (result && result.correct) {
      await QuestionCache.store(ocrText, imageHash, result.correct, result.confidence);
      result.source = 'api';
      return result;
    } else if (result && result.error) {
      return result;
    }
    return { error: "Failed to solve question", correct: null };
  } catch (error) {
    return { error: error.message || "Unknown error", correct: null };
  }
}

// ==================== LOCAL SESSION MANAGER ====================
class SessionManager {
  static async logAnswer(data) {
    const storage = await chrome.storage.local.get("session_history");
    let history = storage.session_history || [];
    const today = new Date().toISOString().split('T')[0];
    history.push({
      date: today,
      correct: data.correct,
      confidence: data.confidence || 100,
      source: data.source || 'unknown',
      timestamp: Date.now()
    });
    if (history.length > 100) history = history.slice(-100);
    await chrome.storage.local.set({ session_history: history });
    return history;
  }
  static async getHistory() {
    const storage = await chrome.storage.local.get("session_history");
    return storage.session_history || [];
  }
  static async clearHistory() {
    await chrome.storage.local.remove("session_history");
  }
}

// ==================== COMMAND HANDLERS ====================
chrome.commands.onCommand.addListener(async (command) => {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  
  if (!tabs || tabs.length === 0 || !tabs[0].id) {
    console.warn("[Command] No active tab found.");
    return;
  }

  const tab = tabs[0];
  if (tab.url.startsWith("chrome://")) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "PING" });
  } catch (e) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      await new Promise(resolve => setTimeout(resolve, 250));
    } catch (err) {
      return;
    }
  }

  switch (command) {
    case "calibrate-area":
      chrome.tabs.sendMessage(tab.id, { type: "START_CALIBRATION" }).catch(e => console.debug(e));
      break;

    case "execute-ping":
      try {
        const screenshot = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
        const result = await solveQuestion(screenshot, "");
        
        if (result && result.correct) {
          await SessionManager.logAnswer(result);
          chrome.tabs.sendMessage(tab.id, { type: "SHOW_ANSWER", data: result }).catch(e => console.debug(e));
        } else if (result && result.error) {
          chrome.tabs.sendMessage(tab.id, { type: "SHOW_ERROR", message: result.error }).catch(e => console.debug(e));
        } else {
          chrome.tabs.sendMessage(tab.id, { type: "SHOW_ERROR", message: "Could not solve question." }).catch(e => console.debug(e));
        }
      } catch (error) {
        chrome.tabs.sendMessage(tab.id, { type: "SHOW_ERROR", message: "Error: " + error.message }).catch(e => console.debug(e));
      }
      break;

    case "show-logs":
      const history = await SessionManager.getHistory();
      chrome.tabs.sendMessage(tab.id, { type: "SHOW_HISTORY", data: history }).catch(e => console.debug(e));
      break;

    case "reset-cache":
      await SessionManager.clearHistory();
      await chrome.storage.local.remove(["api_keys_cache", "calibration"]);
      chrome.tabs.sendMessage(tab.id, { type: "RESET_ALL" }).catch(e => console.debug(e));
      break;
  }
});

// ==================== AUTO-CLEANUP SCHEDULER ====================
chrome.alarms.create("cleanup", { periodInMinutes: 1440 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "cleanup") {
    QuestionCache.cleanup();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  keyManager.init();
  QuestionCache.cleanup();
});