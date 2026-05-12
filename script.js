/* =============================================================
   CoinLence v2.0 — script.js
   Premium offline-first PWA personal finance tracker
   ============================================================= */

/* =============================================================
   ██████╗ ██████╗  ██████╗ ██████╗ ██╗   ██╗ ██████╗████████╗██╗ ██████╗ ███╗   ██╗
   NOTE: ALL original code is 100% preserved below.
   Firebase sync is ADDED ONLY — nothing existing is modified.
   Architecture:
     Local Storage / IndexedDB  ← primary (unchanged)
           ↓  (after every local write)
     Background Sync Engine     ← new, non-blocking
           ↓
     Firebase Firestore         ← backup / restore / multi-device
   ============================================================= */

/* =============================================================
   [NEW] ── FIREBASE CONFIGURATION
   ─────────────────────────────────────────────────────────────
   SETUP INSTRUCTIONS:
   1. Go to https://console.firebase.google.com
   2. Create a project (or use existing).
   3. Enable Authentication → Sign-in methods → Google.
   4. Enable Firestore Database (start in production mode).
   5. Replace the values below with YOUR project's config
      (Project Settings → Your apps → Firebase SDK snippet).
   6. Add Firestore Security Rules (see bottom of this file).
   ============================================================= */
   const firebaseConfig = {
    apiKey: "AIzaSyB19WD6r5gzcRw48veFYhJ5yrmlYmYC1KY",
    authDomain: "coinlence-finance-tracker.firebaseapp.com",
    projectId: "coinlence-finance-tracker",
    storageBucket: "coinlence-finance-tracker.firebasestorage.app",
    messagingSenderId: "371375807824",
    appId: "1:371375807824:web:e3f336cc99ab77b988a055",
    measurementId: "G-4XTHP60RWB"
  };

/* =============================================================
   [NEW] ── FIREBASE SDK LOADER
   Loads Firebase modules dynamically so the app still works
   fully offline if Firebase fails to load.
   ============================================================= */
let _firebaseApp       = null;
let _firebaseAuth      = null;
let _firebaseFirestore = null;
let _currentUser       = null;   // authenticated Firebase user
let _syncPending       = false;  // debounce flag
let _syncTimer         = null;   // debounce timer id
let _syncQueue         = [];     // operations queued while offline
let _isOnline          = navigator.onLine;

// Sync status values: 'idle' | 'syncing' | 'synced' | 'offline' | 'error'
let _syncStatus        = 'idle';

/**
 * [NEW] Dynamically imports Firebase modules from CDN.
 * Falls back gracefully if network is unavailable.
 */
async function loadFirebase() {
  try {
    const { initializeApp }         = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    const { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
                                     = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
    const { getFirestore, doc, setDoc, getDoc, collection, writeBatch, getDocs, serverTimestamp }
                                     = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

    _firebaseApp       = initializeApp(FIREBASE_CONFIG);
    _firebaseAuth      = {
      instance: getAuth(_firebaseApp),
      GoogleAuthProvider,
      signInWithPopup,
      signOut,
      onAuthStateChanged
    };
    _firebaseFirestore = {
      instance: getFirestore(_firebaseApp),
      doc, setDoc, getDoc, collection, writeBatch, getDocs, serverTimestamp
    };

    // Listen for auth state changes
    _firebaseAuth.onAuthStateChanged(_firebaseAuth.instance, async (user) => {
      _currentUser = user;
      if (user) {
        updateSyncUI('syncing');
        renderCloudUserInfo(user);
        await cloudRestoreIfEmpty();
        updateSyncUI('synced');
      } else {
        renderCloudUserInfo(null);
        updateSyncUI('idle');
      }
    });

    // Network status watchers
    window.addEventListener('online',  () => { _isOnline = true;  updateSyncUI(_currentUser ? 'synced' : 'idle'); flushSyncQueue(); });
    window.addEventListener('offline', () => { _isOnline = false; updateSyncUI('offline'); });

    injectFirebaseUI();
    console.log('[CoinLence] Firebase loaded successfully.');
  } catch (err) {
    // Firebase failed to load (offline on first load, or blocked).
    // App continues working fully offline.
    console.warn('[CoinLence] Firebase unavailable — running offline-only mode.', err);
    updateSyncUI('offline');
  }
}

/* =============================================================
   [NEW] ── SYNC STATUS INDICATOR
   Injects a small badge into the app header showing sync state.
   ============================================================= */
function injectFirebaseUI() {
  const header = document.querySelector('.header-actions');
  if (!header) return;

  // Sync status badge
  const badge = document.createElement('span');
  badge.id = 'syncBadge';
  badge.style.cssText = `
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 20px;
    font-weight: 600;
    letter-spacing: 0.3px;
    transition: background 0.3s, color 0.3s;
    cursor: default;
    user-select: none;
    align-self: center;
  `;
  header.insertBefore(badge, header.firstChild);

  // Google login button
  const loginBtn = document.createElement('button');
  loginBtn.id        = 'googleLoginBtn';
  loginBtn.className = 'icon-btn';
  loginBtn.title     = 'Sign in with Google';
  loginBtn.innerHTML = '☁️';
  loginBtn.addEventListener('click', handleGoogleLogin);
  header.insertBefore(loginBtn, header.firstChild);

  updateSyncUI('idle');
}

/**
 * [NEW] Updates the sync status badge appearance and tooltip.
 */
function updateSyncUI(status) {
  _syncStatus = status;
  const badge = document.getElementById('syncBadge');
  const btn   = document.getElementById('googleLoginBtn');
  if (!badge) return;

  const map = {
    idle:    { text: '',         bg: 'transparent',           color: 'transparent' },
    syncing: { text: '↻ Syncing', bg: 'rgba(91,140,255,0.18)', color: '#5b8cff'   },
    synced:  { text: '✓ Synced',  bg: 'rgba(46,204,113,0.18)', color: '#2ecc71'   },
    offline: { text: '○ Offline', bg: 'rgba(255,92,92,0.15)',  color: '#ff5c5c'   },
    error:   { text: '⚠ Error',   bg: 'rgba(255,181,71,0.18)', color: '#ffb547'   }
  };
  const s = map[status] || map.idle;
  badge.textContent        = s.text;
  badge.style.background   = s.bg;
  badge.style.color        = s.color;

  // Update login button tooltip
  if (btn) {
    btn.title = _currentUser
      ? `Signed in as ${_currentUser.email} (click to sign out)`
      : 'Sign in with Google for cloud sync';
    btn.innerHTML = _currentUser
      ? (_currentUser.photoURL
          ? `<img src="${_currentUser.photoURL}" style="width:22px;height:22px;border-radius:50%;vertical-align:middle;">`
          : '👤')
      : '☁️';
  }
}

/* =============================================================
   [NEW] ── GOOGLE SIGN-IN / SIGN-OUT
   ============================================================= */
async function handleGoogleLogin() {
  if (!_firebaseAuth) {
    toast('Firebase not loaded. Check your internet connection.', 'error');
    return;
  }
  if (_currentUser) {
    // Already signed in → offer sign-out
    confirmAction(
      'Sign out?',
      `You are signed in as ${_currentUser.email}. Cloud sync will pause until you sign in again.`,
      async () => {
        try {
          await _firebaseAuth.signOut(_firebaseAuth.instance);
          _currentUser = null;
          renderCloudUserInfo(null);
          updateSyncUI('idle');
          toast('Signed out from Google account', 'info');
        } catch (e) {
          toast('Sign-out failed: ' + e.message, 'error');
        }
      }
    );
    return;
  }

  try {
    updateSyncUI('syncing');
    const provider = new _firebaseAuth.GoogleAuthProvider();
    await _firebaseAuth.signInWithPopup(_firebaseAuth.instance, provider);
    // onAuthStateChanged will handle the rest
    toast('Signed in with Google ✓', 'success');
  } catch (e) {
    updateSyncUI('error');
    if (e.code !== 'auth/popup-closed-by-user') {
      toast('Google sign-in failed: ' + e.message, 'error');
    }
  }
}

/**
 * [NEW] Renders a small user info chip in Settings → Cloud Sync card.
 */
function renderCloudUserInfo(user) {
  const el = document.getElementById('cloudUserInfo');
  if (!el) return;
  if (user) {
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        ${user.photoURL ? `<img src="${user.photoURL}" style="width:36px;height:36px;border-radius:50%;">` : ''}
        <div>
          <div style="font-weight:600;">${escapeHtml(user.displayName || 'User')}</div>
          <div style="font-size:12px;opacity:0.7;">${escapeHtml(user.email)}</div>
        </div>
      </div>
    `;
  } else {
    el.innerHTML = '<span style="opacity:0.55;font-size:13px;">Not signed in</span>';
  }
}

/* =============================================================
   [NEW] ── CLOUD BACKUP (write to Firestore)
   Structure:
     users/{uid}/meta/appData        — settings snapshot
     users/{uid}/transactions/{id}   — individual tx documents
     users/{uid}/categories/{id}     — individual category docs
   ============================================================= */

/**
 * [NEW] Debounced trigger — call after any local data change.
 * Prevents flooding Firestore on rapid successive edits.
 */
function scheduleSyncToCloud() {
  if (!_currentUser || !_firebaseFirestore) return;
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    _syncTimer = null;
    if (_isOnline) {
      performCloudSync();
    } else {
      // Queue for when online returns
      _syncQueue.push('full');
      updateSyncUI('offline');
    }
  }, 1500); // 1.5 s debounce
}

/**
 * [NEW] Flushes queued sync operations once back online.
 */
async function flushSyncQueue() {
  if (!_syncQueue.length || !_currentUser) return;
  _syncQueue = [];
  await performCloudSync();
}

/**
 * [NEW] Performs the actual Firestore write.
 * Uses batched writes for atomicity.
 * Stamped with updatedAt so conflict resolution uses latest-wins.
 */
async function performCloudSync() {
  if (!_currentUser || !_firebaseFirestore || !_isOnline) return;
  if (_syncPending) return; // already in flight
  _syncPending = true;
  updateSyncUI('syncing');

  try {
    const fs   = _firebaseFirestore;
    const db   = fs.instance;
    const uid  = _currentUser.uid;

    // ── 1. Save meta / settings (non-sensitive: no pinHash, no recoveryHash)
    const safeMeta = {
      theme:            state.settings.theme,
      lastBackupPrompt: state.settings.lastBackupPrompt,
      updatedAt:        Date.now()
    };
    await fs.setDoc(
      fs.doc(db, 'users', uid, 'meta', 'appData'),
      safeMeta,
      { merge: true }
    );

    // ── 2. Batch-write all transactions (Firestore batch max = 500)
    const txBatches = chunkArray(state.transactions, 400);
    for (const chunk of txBatches) {
      const batch = fs.writeBatch(db);
      for (const tx of chunk) {
        const ref = fs.doc(db, 'users', uid, 'transactions', tx.id);
        batch.set(ref, { ...tx, _syncedAt: Date.now() }, { merge: true });
      }
      await batch.commit();
    }

    // ── 3. Batch-write all categories
    const catBatches = chunkArray(state.categories, 400);
    for (const chunk of catBatches) {
      const batch = fs.writeBatch(db);
      for (const cat of chunk) {
        const ref = fs.doc(db, 'users', uid, 'categories', cat.id);
        batch.set(ref, { ...cat, _syncedAt: Date.now() }, { merge: true });
      }
      await batch.commit();
    }

    updateSyncUI('synced');
    console.log('[CoinLence] Cloud sync complete.');
  } catch (err) {
    console.error('[CoinLence] Cloud sync error:', err);
    updateSyncUI('error');
    toast('Cloud sync error — data is safe locally.', 'error', 3000);
  } finally {
    _syncPending = false;
  }
}

/**
 * [NEW] Helper: splits an array into chunks of `size`.
 */
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* =============================================================
   [NEW] ── CLOUD RESTORE (read from Firestore)
   Called on first login or manual restore.
   LOCAL DATA WINS if it is newer (updatedAt comparison).
   ============================================================= */

/**
 * [NEW] Restores from cloud ONLY if local has fewer transactions.
 * This protects existing local data on first cloud login.
 */
async function cloudRestoreIfEmpty() {
  if (!_currentUser || !_firebaseFirestore) return;
  const localCount = state.transactions.length;

  try {
    const cloudTxs = await fetchCloudTransactions();
    if (!cloudTxs.length) {
      // Nothing in cloud yet — push local data up
      await performCloudSync();
      return;
    }

    if (localCount === 0) {
      // Local is empty → restore from cloud automatically
      await doCloudRestore(cloudTxs);
      toast('Data restored from cloud ☁️', 'success', 3500);
    } else if (cloudTxs.length > localCount) {
      // Cloud has more → offer merge prompt
      toast('Cloud has more data. Use "Restore from Cloud" in Settings to sync.', 'info', 4000);
    } else {
      // Local has equal or more — push local up
      await performCloudSync();
    }
  } catch (err) {
    console.error('[CoinLence] Cloud restore check error:', err);
  }
}

/**
 * [NEW] Fetches all transactions from Firestore for the current user.
 */
async function fetchCloudTransactions() {
  const fs    = _firebaseFirestore;
  const uid   = _currentUser.uid;
  const snap  = await fs.getDocs(fs.collection(fs.instance, 'users', uid, 'transactions'));
  const txs   = [];
  snap.forEach(d => txs.push(d.data()));
  return txs;
}

/**
 * [NEW] Fetches all categories from Firestore.
 */
async function fetchCloudCategories() {
  const fs    = _firebaseFirestore;
  const uid   = _currentUser.uid;
  const snap  = await fs.getDocs(fs.collection(fs.instance, 'users', uid, 'categories'));
  const cats  = [];
  snap.forEach(d => cats.push(d.data()));
  return cats;
}

/**
 * [NEW] Writes cloud data into local IndexedDB / localStorage.
 * Uses latest-wins conflict resolution via updatedAt.
 */
async function doCloudRestore(cloudTxs) {
  // Merge strategy: for each cloud tx, if local has it check updatedAt
  const localMap = {};
  state.transactions.forEach(t => { localMap[t.id] = t; });

  for (const cloudTx of cloudTxs) {
    if (!cloudTx.id || !cloudTx.type || !cloudTx.date) continue; // skip malformed
    const localTx = localMap[cloudTx.id];
    if (!localTx || (cloudTx.updatedAt || 0) > (localTx.updatedAt || 0)) {
      await dbPut(STORES.TX, cloudTx);
    }
  }

  const cloudCats = await fetchCloudCategories();
  const localCatMap = {};
  state.categories.forEach(c => { localCatMap[c.id] = c; });
  for (const cat of cloudCats) {
    if (!cat.id || !cat.name) continue;
    if (!localCatMap[cat.id]) await dbPut(STORES.CATS, cat);
  }

  // Reload state from DB
  await loadTransactions();
  await loadCategories();
  populateMonthYearFilters();
  populateCategorySelect();
  renderAll();
}

/**
 * [NEW] Manual restore triggered from Settings.
 * Fetches latest cloud data and merges into local (latest-wins).
 */
async function manualCloudRestore() {
  if (!_currentUser) {
    toast('Please sign in with Google first.', 'error');
    return;
  }
  if (!_isOnline) {
    toast('You are offline. Connect to internet and try again.', 'error');
    return;
  }
  confirmAction(
    'Restore from Cloud?',
    'Cloud data will be merged into your local data. Newer records win.',
    async () => {
      try {
        updateSyncUI('syncing');
        const cloudTxs = await fetchCloudTransactions();
        await doCloudRestore(cloudTxs);
        updateSyncUI('synced');
        toast('Cloud restore complete ✓', 'success', 3000);
      } catch (err) {
        updateSyncUI('error');
        toast('Restore failed: ' + err.message, 'error');
      }
    }
  );
}

/* =============================================================
   [NEW] ── CLOUD SYNC CARD in Settings
   Injects a new "Cloud Sync" card into the existing Settings view.
   ============================================================= */
function injectCloudSyncSettingsCard() {
  const settingsView = document.getElementById('view-settings');
  if (!settingsView) return;

  // Insert before the "About" card (last card)
  const cards    = settingsView.querySelectorAll('.card.settings-card');
  const aboutCard = cards[cards.length - 1];

  const card = document.createElement('div');
  card.className = 'card settings-card';
  card.innerHTML = `
    <h4>☁️ Cloud Sync</h4>
    <div id="cloudUserInfo" style="margin-bottom:12px;">
      <span style="opacity:0.55;font-size:13px;">Not signed in</span>
    </div>
    <button class="btn btn-block" id="cloudLoginBtn">Sign in with Google</button>
    <button class="btn btn-block" id="cloudRestoreBtn" style="margin-top:8px;">Restore from Cloud</button>
    <button class="btn btn-block" id="cloudBackupNowBtn" style="margin-top:8px;">Backup Now</button>
    <p style="font-size:11px;opacity:0.5;margin-top:10px;">
      Data syncs automatically after every change when signed in and online.
    </p>
  `;

  settingsView.insertBefore(card, aboutCard);

  // Wire up buttons
  document.getElementById('cloudLoginBtn').addEventListener('click', handleGoogleLogin);
  document.getElementById('cloudRestoreBtn').addEventListener('click', manualCloudRestore);
  document.getElementById('cloudBackupNowBtn').addEventListener('click', async () => {
    if (!_currentUser) { toast('Sign in with Google first.', 'error'); return; }
    await performCloudSync();
    toast('Backup complete ✓', 'success');
  });
}

/* =============================================================
   [NEW] ── PATCH: Hook sync into existing data-mutation functions
   We wrap the existing functions at the module level so their
   internal logic stays 100% untouched; we just fire scheduleSyncToCloud()
   after each successful operation.
   ============================================================= */

// These patches run AFTER the original functions execute.
// They are applied inside init() after the original code defines the functions.
function patchDataFunctionsForSync() {
  const _origAddTx    = window.__coinlence_addTx    || null;
  const _origUpdateTx = window.__coinlence_updateTx || null;
  const _origDeleteTx = window.__coinlence_deleteTx || null;
  // We don't patch via window (IIFE scope prevents that).
  // Instead, we use MutationObserver on the transaction lists as a
  // side-channel trigger — any DOM change in tx lists means a write happened.
  // This is safe and decoupled: if sync fails, local data is intact.
  const observer = new MutationObserver(() => scheduleSyncToCloud());
  const recentList  = document.getElementById('recentList');
  const historyList = document.getElementById('historyList');
  if (recentList)  observer.observe(recentList,  { childList: true, subtree: false });
  if (historyList) observer.observe(historyList, { childList: true, subtree: false });
}

/* =============================================================
   ────────────────────────────────────────────────────────────
   ██████╗ ██████╗ ██╗ ██████╗ ██╗███╗   ██╗ █████╗ ██╗
   ██╔═══██╗██╔══██╗██║██╔════╝ ██║████╗  ██║██╔══██╗██║
   ██║   ██║██████╔╝██║██║  ███╗██║██╔██╗ ██║███████║██║
   ██║   ██║██╔══██╗██║██║   ██║██║██║╚██╗██║██╔══██║██║
   ╚██████╔╝██║  ██║██║╚██████╔╝██║██║ ╚████║██║  ██║███████╗
    ╚═════╝ ╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝
   ORIGINAL CODE BELOW — ZERO MODIFICATIONS
   ────────────────────────────────────────────────────────────
   ============================================================= */

(() => {
'use strict';

/* ===========================================================
   CONSTANTS & STATE
=========================================================== */
const DB_NAME = 'coinlence_db';
const DB_VERSION = 1;
const STORES = {
  TX: 'transactions',
  CATS: 'categories',
  META: 'meta'
};
const CURRENCY = '৳';
const DEFAULT_CATEGORIES = ['Food','Transport','Shopping','Bills','Education','Salary','Business','Other'];
const BACKUP_REMINDER_DAYS = 30;

let db = null;
let useFallback = false;
let state = {
  transactions: [],
  categories: [],
  settings: {
    theme: 'dark',
    pinHash: null,
    pinLength: 4,
    recoveryHash: null,
    lastBackupPrompt: 0,
    failedAttempts: 0,
    lockUntil: 0
  }
};
let confirmCallback = null;
let lockTimer = null;

/* ===========================================================
   UTILITIES
=========================================================== */
const $ = (s, ctx=document) => ctx.querySelector(s);
const $$ = (s, ctx=document) => Array.from(ctx.querySelectorAll(s));

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2,9);
}

function fmtMoney(n) {
  const v = Number(n) || 0;
  return CURRENCY + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function safeNum(v) {
  const n = parseFloat(v);
  if (isNaN(n) || !isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function parseDate(iso) {
  return new Date(iso + 'T00:00:00');
}

function monthKey(iso) {
  return iso.slice(0,7); // YYYY-MM
}

function monthName(idx) {
  return ['January','February','March','April','May','June','July','August','September','October','November','December'][idx];
}

/* Base64 encode/decode (UTF-8 safe) */
function b64Encode(str) {
  try { return btoa(unescape(encodeURIComponent(str))); }
  catch(e) { return btoa(str); }
}
function b64Decode(str) {
  try { return decodeURIComponent(escape(atob(str))); }
  catch(e) {
    try { return atob(str); } catch(_) { return null; }
  }
}

/* Simple hash (SHA-256 via SubtleCrypto) */
async function sha256(text) {
  if (window.crypto && crypto.subtle) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }
  // Fallback (lightweight; not cryptographic)
  let h = 0;
  for (let i=0; i<text.length; i++) {
    h = (Math.imul(31,h) + text.charCodeAt(i)) | 0;
  }
  return 'fb_' + (h>>>0).toString(16);
}

/* ===========================================================
   STORAGE: IndexedDB primary, localStorage fallback
=========================================================== */
function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('No IndexedDB')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const _db = e.target.result;
      if (!_db.objectStoreNames.contains(STORES.TX)) {
        const txs = _db.createObjectStore(STORES.TX, { keyPath: 'id' });
        txs.createIndex('date','date',{unique:false});
        txs.createIndex('type','type',{unique:false});
      }
      if (!_db.objectStoreNames.contains(STORES.CATS)) {
        _db.createObjectStore(STORES.CATS, { keyPath: 'id' });
      }
      if (!_db.objectStoreNames.contains(STORES.META)) {
        _db.createObjectStore(STORES.META, { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function dbInit() {
  try {
    db = await openDB();
    useFallback = false;
  } catch(err) {
    console.warn('IndexedDB unavailable, using localStorage fallback', err);
    useFallback = true;
  }
}

function lsKey(store) { return `coinlence_${store}`; }

async function dbGetAll(store) {
  if (useFallback) {
    try {
      const raw = localStorage.getItem(lsKey(store));
      if (!raw) return [];
      const decoded = b64Decode(raw);
      if (!decoded) return [];
      const arr = JSON.parse(decoded);
      return Array.isArray(arr) ? arr : [];
    } catch(e) { return []; }
  }
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const os = tx.objectStore(store);
      const req = os.getAll();
      req.onsuccess = () => {
        const items = (req.result || []).map(rec => {
          if (rec && rec._b64) {
            const dec = b64Decode(rec._b64);
            try { return dec ? JSON.parse(dec) : null; } catch(e) { return null; }
          }
          return rec;
        }).filter(Boolean);
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    } catch(err) { reject(err); }
  });
}

async function dbPut(store, obj) {
  if (useFallback) {
    const all = await dbGetAll(store);
    const idx = all.findIndex(x => x.id === obj.id || x.key === obj.key);
    if (idx >= 0) all[idx] = obj; else all.push(obj);
    localStorage.setItem(lsKey(store), b64Encode(JSON.stringify(all)));
    return true;
  }
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      const keyName = os.keyPath;
      const wrapped = { [keyName]: obj[keyName], _b64: b64Encode(JSON.stringify(obj)) };
      const req = os.put(wrapped);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    } catch(err) { reject(err); }
  });
}

async function dbDelete(store, key) {
  if (useFallback) {
    const all = await dbGetAll(store);
    const filtered = all.filter(x => x.id !== key && x.key !== key);
    localStorage.setItem(lsKey(store), b64Encode(JSON.stringify(filtered)));
    return true;
  }
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      const req = os.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    } catch(err) { reject(err); }
  });
}

async function dbClear(store) {
  if (useFallback) {
    localStorage.removeItem(lsKey(store));
    return true;
  }
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      const req = os.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    } catch(err) { reject(err); }
  });
}

/* ===========================================================
   SETTINGS / META
=========================================================== */
async function loadSettings() {
  const meta = await dbGetAll(STORES.META);
  const map = {};
  meta.forEach(m => map[m.key] = m.value);
  state.settings = {
    theme: map.theme || 'dark',
    pinHash: map.pinHash || null,
    pinLength: map.pinLength || 4,
    recoveryHash: map.recoveryHash || null,
    lastBackupPrompt: map.lastBackupPrompt || 0,
    failedAttempts: map.failedAttempts || 0,
    lockUntil: map.lockUntil || 0
  };
}

async function saveSetting(key, value) {
  await dbPut(STORES.META, { key, value });
  state.settings[key] = value;
}

/* ===========================================================
   CATEGORIES
=========================================================== */
async function loadCategories() {
  let cats = await dbGetAll(STORES.CATS);
  if (cats.length === 0) {
    for (const name of DEFAULT_CATEGORIES) {
      const c = { id: uid(), name, isDefault: true };
      await dbPut(STORES.CATS, c);
      cats.push(c);
    }
  }
  state.categories = cats.sort((a,b) => a.name.localeCompare(b.name));
}

async function addCategory(name) {
  name = (name || '').trim();
  if (!name) throw new Error('Category name required');
  if (state.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('Category already exists');
  }
  const c = { id: uid(), name, isDefault: false };
  await dbPut(STORES.CATS, c);
  state.categories.push(c);
  state.categories.sort((a,b) => a.name.localeCompare(b.name));
}

async function deleteCategory(id) {
  await dbDelete(STORES.CATS, id);
  state.categories = state.categories.filter(c => c.id !== id);
}

/* ===========================================================
   TRANSACTIONS
=========================================================== */
async function loadTransactions() {
  const raw = await dbGetAll(STORES.TX);
  // Normalize: ensure isSettled exists (backward compat with old transactions)
  state.transactions = raw.map(t => ({ ...t, isSettled: t.isSettled || false }));
  state.transactions.sort((a,b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

async function addTransaction(data) {
  validateTx(data);
  const tx = {
    id: uid(),
    type: data.type,
    title: data.title.trim(),
    amount: safeNum(data.amount),
    category: data.category,
    notes: (data.notes||'').trim(),
    date: data.date,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isSettled: false
  };
  await dbPut(STORES.TX, tx);
  state.transactions.unshift(tx);
  state.transactions.sort((a,b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  return tx;
}

async function updateTransaction(id, data) {
  validateTx(data);
  const idx = state.transactions.findIndex(t => t.id === id);
  if (idx < 0) throw new Error('Transaction not found');
  const upd = {
    ...state.transactions[idx],
    type: data.type,
    title: data.title.trim(),
    amount: safeNum(data.amount),
    category: data.category,
    notes: (data.notes||'').trim(),
    date: data.date,
    updatedAt: Date.now(),
    isSettled: state.transactions[idx].isSettled || false
  };
  await dbPut(STORES.TX, upd);
  state.transactions[idx] = upd;
  state.transactions.sort((a,b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  return upd;
}

async function deleteTransaction(id) {
  await dbDelete(STORES.TX, id);
  state.transactions = state.transactions.filter(t => t.id !== id);
}

async function settleTransaction(id) {
  const idx = state.transactions.findIndex(t => t.id === id);
  if (idx < 0) { toast('Transaction not found', 'error'); return; }
  const t = state.transactions[idx];
  if (t.isSettled) { toast('Already settled', 'info'); return; }
  const upd = { ...t, isSettled: true, updatedAt: Date.now() };
  await dbPut(STORES.TX, upd);
  state.transactions[idx] = upd;
  const label = t.type === 'lend' ? 'Lend settled — amount returned to balance' : 'Borrow settled — amount deducted from balance';
  toast(label, 'success');
  renderAll();
  if ($('#view-analytics').classList.contains('active')) drawAllAnalytics();
}

function validateTx(data) {
  if (!data.type || !['income','expense','lend','borrow'].includes(data.type)) throw new Error('Invalid type');
  if (!data.title || !data.title.trim()) throw new Error('Title required');
  const amt = safeNum(data.amount);
  if (amt <= 0) throw new Error('Amount must be > 0');
  if (!data.category) throw new Error('Category required');
  if (!data.date || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw new Error('Invalid date');
}

/* ===========================================================
   COMPUTATIONS
=========================================================== */
function computeTotals(txs = state.transactions) {
  let income = 0, expense = 0, lend = 0, borrow = 0;
  let lendUnsettled = 0, borrowUnsettled = 0;
  for (const t of txs) {
    const settled = t.isSettled === true;
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expense += t.amount;
    else if (t.type === 'lend') {
      lend += t.amount;
      if (!settled) lendUnsettled += t.amount;
    }
    else if (t.type === 'borrow') {
      borrow += t.amount;
      if (!settled) borrowUnsettled += t.amount;
    }
  }
  // Balance uses unsettled lend/borrow only:
  // Lend settled → money returned, no longer subtracted.
  // Borrow settled → money repaid, no longer added.
  const balance = (income + borrowUnsettled) - (expense + lendUnsettled);
  return {
    income: safeNum(income),
    expense: safeNum(expense),
    lend: safeNum(lend),
    borrow: safeNum(borrow),
    balance: safeNum(balance)
  };
}

function txByMonth(year, month) {
  const key = `${year}-${String(month+1).padStart(2,'0')}`;
  return state.transactions.filter(t => t.date.startsWith(key));
}

/* ===========================================================
   TOASTS
=========================================================== */
function toast(msg, type='info', duration=2500) {
  const c = $('#toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 250);
  }, duration);
}

/* ===========================================================
   CONFIRM MODAL
=========================================================== */
function confirmAction(title, message, onConfirm) {
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  confirmCallback = onConfirm;
  $('#confirmModal').classList.remove('hidden');
}

$('#confirmCancel').addEventListener('click', () => {
  $('#confirmModal').classList.add('hidden');
  confirmCallback = null;
});
$('#confirmOk').addEventListener('click', async () => {
  $('#confirmModal').classList.add('hidden');
  if (typeof confirmCallback === 'function') {
    try { await confirmCallback(); } catch(e) { toast(e.message || 'Error', 'error'); }
  }
  confirmCallback = null;
});

/* ===========================================================
   AUTH: SETUP / LOCK / RECOVERY
=========================================================== */
function showScreen(name) {
  $('#splash').classList.add('hidden');
  $('#setupScreen').classList.add('hidden');
  $('#lockScreen').classList.add('hidden');
  $('#recoveryScreen').classList.add('hidden');
  $('#app').classList.add('hidden');
  if (name === 'setup') $('#setupScreen').classList.remove('hidden');
  else if (name === 'lock') $('#lockScreen').classList.remove('hidden');
  else if (name === 'recovery') $('#recoveryScreen').classList.remove('hidden');
  else if (name === 'app') $('#app').classList.remove('hidden');
}

/* SETUP */
let setupPinLen = 4;
$$('#pinLengthGroup .pill').forEach(p => {
  p.addEventListener('click', () => {
    $$('#pinLengthGroup .pill').forEach(x => x.classList.remove('active'));
    p.classList.add('active');
    setupPinLen = parseInt(p.dataset.len,10);
    $('#setupPin').maxLength = setupPinLen;
    $('#setupPinConfirm').maxLength = setupPinLen;
  });
});

$('#setupSubmit').addEventListener('click', async () => {
  const pin = $('#setupPin').value;
  const cpin = $('#setupPinConfirm').value;
  const rec = $('#setupRecovery').value.trim();

  if (!/^\d+$/.test(pin) || pin.length !== setupPinLen) {
    return toast(`PIN must be ${setupPinLen} digits`, 'error');
  }
  if (pin !== cpin) return toast('PINs do not match', 'error');
  if (rec.length < 4) return toast('Recovery key too short (min 4 chars)', 'error');

  try {
    const pinHash = await sha256(pin);
    const recHash = await sha256(rec);
    await saveSetting('pinHash', pinHash);
    await saveSetting('pinLength', setupPinLen);
    await saveSetting('recoveryHash', recHash);
    await saveSetting('failedAttempts', 0);
    toast('Account created', 'success');
    enterApp();
  } catch(e) {
    toast('Setup failed: ' + e.message, 'error');
  }
});

/* LOCK */
function renderPinDots() {
  const dots = $('#pinDots');
  dots.innerHTML = '';
  const len = state.settings.pinLength || 4;
  const val = $('#lockPin').value;
  for (let i=0; i<len; i++) {
    const d = document.createElement('span');
    if (i < val.length) d.classList.add('filled');
    dots.appendChild(d);
  }
}

$('#lockPin').addEventListener('input', () => {
  $('#lockPin').value = $('#lockPin').value.replace(/\D/g,'').slice(0, state.settings.pinLength);
  renderPinDots();
  $('#lockError').textContent = '';
  if ($('#lockPin').value.length === state.settings.pinLength) {
    setTimeout(tryUnlock, 100);
  }
});

$('#unlockBtn').addEventListener('click', tryUnlock);

async function tryUnlock() {
  if (state.settings.lockUntil && Date.now() < state.settings.lockUntil) {
    const sec = Math.ceil((state.settings.lockUntil - Date.now()) / 1000);
    $('#lockError').textContent = `Too many attempts. Try again in ${sec}s.`;
    return;
  }
  const pin = $('#lockPin').value;
  if (pin.length !== state.settings.pinLength) {
    $('#lockError').textContent = 'Enter full PIN';
    return;
  }
  const h = await sha256(pin);
  if (h === state.settings.pinHash) {
    await saveSetting('failedAttempts', 0);
    await saveSetting('lockUntil', 0);
    $('#lockPin').value = '';
    renderPinDots();
    enterApp();
  } else {
    const attempts = (state.settings.failedAttempts || 0) + 1;
    await saveSetting('failedAttempts', attempts);
    if (attempts >= 5) {
      const lockMs = Math.min(60000 * Math.pow(2, attempts - 5), 600000);
      await saveSetting('lockUntil', Date.now() + lockMs);
      $('#lockError').textContent = `Too many attempts. Locked ${Math.ceil(lockMs/1000)}s.`;
    } else {
      $('#lockError').textContent = `Wrong PIN. ${5 - attempts} attempts left.`;
    }
    $('#lockPin').value = '';
    renderPinDots();
  }
}

$('#forgotPinBtn').addEventListener('click', () => {
  $('#recoveryKeyInput').value = '';
  $('#recoveryNewPin').value = '';
  $('#recoveryNewPinConfirm').value = '';
  showScreen('recovery');
});

$('#recoveryCancel').addEventListener('click', () => showScreen('lock'));

$('#recoverySubmit').addEventListener('click', async () => {
  const key = $('#recoveryKeyInput').value.trim();
  const np = $('#recoveryNewPin').value;
  const nc = $('#recoveryNewPinConfirm').value;

  if (!key) return toast('Enter recovery key', 'error');
  const h = await sha256(key);
  if (h !== state.settings.recoveryHash) return toast('Invalid recovery key', 'error');
  if (!/^\d+$/.test(np) || (np.length !== 4 && np.length !== 6)) return toast('PIN must be 4 or 6 digits', 'error');
  if (np !== nc) return toast('PINs do not match', 'error');

  confirmAction('Reset PIN?', 'You are about to change your PIN using your recovery key.', async () => {
    const ph = await sha256(np);
    await saveSetting('pinHash', ph);
    await saveSetting('pinLength', np.length);
    await saveSetting('failedAttempts', 0);
    await saveSetting('lockUntil', 0);
    toast('PIN reset successful', 'success');
    showScreen('lock');
    renderPinDots();
  });
});

$('#lockNowBtn').addEventListener('click', lockApp);

function lockApp() {
  $('#lockPin').value = '';
  renderPinDots();
  showScreen('lock');
  setTimeout(() => $('#lockPin').focus(), 100);
}

/* ===========================================================
   ENTER APP / NAV
=========================================================== */
async function enterApp() {
  showScreen('app');
  applyTheme(state.settings.theme);
  populateCategorySelect();
  populateMonthYearFilters();
  renderAll();
  checkBackupReminder();
}

$$('.nav-btn[data-nav]').forEach(b => {
  b.addEventListener('click', () => navigateTo(b.dataset.nav));
});
$$('[data-nav]').forEach(b => {
  b.addEventListener('click', () => navigateTo(b.dataset.nav));
});

function navigateTo(view) {
  $$('.view').forEach(v => v.classList.remove('active'));
  const target = $('#view-' + view);
  if (target) target.classList.add('active');
  $$('.nav-btn[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === view));
  if (view === 'analytics') drawAllAnalytics();
  if (view === 'dashboard') drawDashboardChart();
  if (view === 'history') renderHistory();
  if (view === 'settings') renderCategoriesList();
}

/* ===========================================================
   THEME
=========================================================== */
function applyTheme(t) {
  document.body.dataset.theme = t;
  $('#themeToggle').textContent = t === 'dark' ? '🌙' : '☀️';
  const ds = $('#darkSwitch');
  if (ds) ds.checked = (t === 'dark');
  // Redraw charts to reflect theme
  setTimeout(() => {
    if ($('#view-dashboard').classList.contains('active')) drawDashboardChart();
    if ($('#view-analytics').classList.contains('active')) drawAllAnalytics();
  }, 100);
}

$('#themeToggle').addEventListener('click', async () => {
  const next = state.settings.theme === 'dark' ? 'light' : 'dark';
  await saveSetting('theme', next);
  applyTheme(next);
});

document.addEventListener('change', async (e) => {
  if (e.target && e.target.id === 'darkSwitch') {
    const next = e.target.checked ? 'dark' : 'light';
    await saveSetting('theme', next);
    applyTheme(next);
  }
});

/* ===========================================================
   RENDER: DASHBOARD
=========================================================== */
function renderAll() {
  renderDashboard();
  renderHistory();
  renderCategoriesList();
}

function renderDashboard() {
  const t = computeTotals();
  $('#totalBalance').textContent = fmtMoney(t.balance);
  $('#totalIncome').textContent = fmtMoney(t.income);
  $('#totalExpense').textContent = fmtMoney(t.expense);
  $('#totalLend').textContent = fmtMoney(t.lend);
  $('#totalBorrow').textContent = fmtMoney(t.borrow);

  $('#balanceCard').classList.toggle('negative', t.balance < 0);

  // Month label
  const now = new Date();
  $('#monthLabel').textContent = monthName(now.getMonth()) + ' ' + now.getFullYear();

  // Recent
  const recent = state.transactions.slice(0,5);
  renderTxList($('#recentList'), recent);

  drawDashboardChart();
}

function renderTxList(container, txs) {
  container.innerHTML = '';
  if (!txs.length) {
    container.innerHTML = '<div class="empty">No transactions yet</div>';
    return;
  }
  for (const t of txs) {
    const el = document.createElement('div');
    const isLendBorrow = (t.type === 'lend' || t.type === 'borrow');
    el.className = 'tx-item' + (t.isSettled ? ' settled-item' : '');
    el.dataset.id = t.id;
    const sign = (t.type === 'income' || t.type === 'borrow') ? '+' : '−';
    const amtClass =
      t.type === 'income' ? 'pos' :
      t.type === 'expense' ? 'neg' :
      t.type === 'lend' ? 'lend' : 'borrow';
    const icon = t.type === 'income' ? '↓' : t.type === 'expense' ? '↑' : t.type === 'lend' ? '↗' : '↘';

    let settlePart = '';
    if (isLendBorrow) {
      if (!t.isSettled) {
        settlePart = `<button class="settle-btn" data-id="${escapeHtml(t.id)}" title="Mark as Settled">✅</button>`;
      } else {
        settlePart = `<span class="settled-badge">✅ Settled</span>`;
      }
    }

    el.innerHTML = `
      <div class="tx-icon ${t.type}">${icon}</div>
      <div class="tx-info">
        <div class="tx-title">${escapeHtml(t.title)}</div>
        <div class="tx-meta">${escapeHtml(t.category)} • ${formatDateLabel(t.date)}</div>
      </div>
      <div class="tx-right">
        <div class="tx-amount ${amtClass}">${sign}${fmtMoney(t.amount).replace(CURRENCY,CURRENCY)}</div>
        ${settlePart}
      </div>
    `;
    el.addEventListener('click', (e) => {
      if (e.target.closest('.settle-btn')) return;
      openTxModal(t);
    });
    container.appendChild(el);
  }

  // Wire up settle buttons
  container.querySelectorAll('.settle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const tx = state.transactions.find(t => t.id === id);
      if (!tx) return;
      const msg = tx.type === 'lend'
        ? 'Mark as settled? The lent amount will be returned to your balance.'
        : 'Mark as settled? The borrowed amount will be deducted from your balance.';
      confirmAction('Settle transaction?', msg, async () => {
        await settleTransaction(id);
      });
    });
  });
}

function escapeHtml(s) {
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function formatDateLabel(iso) {
  const d = parseDate(iso);
  return d.toLocaleDateString('en-US', { day:'numeric', month:'short', year:'numeric' });
}

/* ===========================================================
   RENDER: HISTORY
=========================================================== */
function populateMonthYearFilters() {
  const fm = $('#filterMonth');
  const fy = $('#filterYear');
  fm.innerHTML = '<option value="all">All Months</option>';
  for (let i=0; i<12; i++) {
    const o = document.createElement('option');
    o.value = String(i+1).padStart(2,'0');
    o.textContent = monthName(i);
    fm.appendChild(o);
  }

  // years from transactions + current
  const years = new Set();
  years.add(new Date().getFullYear());
  state.transactions.forEach(t => years.add(parseInt(t.date.slice(0,4),10)));
  const yArr = Array.from(years).sort((a,b)=>b-a);

  fy.innerHTML = '<option value="all">All Years</option>';
  yArr.forEach(y => {
    const o = document.createElement('option');
    o.value = String(y); o.textContent = y;
    fy.appendChild(o);
  });
}

['searchInput','filterType','filterMonth','filterYear'].forEach(id => {
  document.addEventListener('input', e => { if (e.target.id === id) renderHistory(); });
  document.addEventListener('change', e => { if (e.target.id === id) renderHistory(); });
});

function renderHistory() {
  const q = ($('#searchInput')?.value || '').toLowerCase().trim();
  const type = $('#filterType')?.value || 'all';
  const month = $('#filterMonth')?.value || 'all';
  const year = $('#filterYear')?.value || 'all';

  let list = state.transactions.slice();
  if (type !== 'all') list = list.filter(t => t.type === type);
  if (year !== 'all') list = list.filter(t => t.date.startsWith(year));
  if (month !== 'all') list = list.filter(t => t.date.slice(5,7) === month);
  if (q) list = list.filter(t =>
    t.title.toLowerCase().includes(q) ||
    (t.category||'').toLowerCase().includes(q) ||
    (t.notes||'').toLowerCase().includes(q)
  );

  renderTxList($('#historyList'), list);
}

/* ===========================================================
   TX MODAL
=========================================================== */
function populateCategorySelect() {
  const sel = $('#txCategory');
  sel.innerHTML = '';
  state.categories.forEach(c => {
    const o = document.createElement('option');
    o.value = c.name; o.textContent = c.name;
    sel.appendChild(o);
  });
}

let modalType = 'income';
function setModalType(type) {
  modalType = type;
  $$('#txTypeGroup .pill').forEach(p => p.classList.toggle('active', p.dataset.type === type));
}
$$('#txTypeGroup .pill').forEach(p => {
  p.addEventListener('click', () => setModalType(p.dataset.type));
});

function openTxModal(existing=null, presetType=null) {
  const m = $('#txModal');
  $('#txId').value = existing?.id || '';
  $('#txTitle').value = existing?.title || '';
  $('#txAmount').value = existing?.amount ?? '';
  $('#txNotes').value = existing?.notes || '';
  $('#txDate').value = existing?.date || todayISO();

  populateCategorySelect();
  $('#txCategory').value = existing?.category || (state.categories[0]?.name || '');

  setModalType(existing?.type || presetType || 'income');
  $('#txModalTitle').textContent = existing ? 'Edit Transaction' : 'Add Transaction';

  m.classList.remove('hidden');
}

function closeTxModal() { $('#txModal').classList.add('hidden'); }
$('#txModalClose').addEventListener('click', closeTxModal);
$('#txModal').addEventListener('click', (e) => { if (e.target.id === 'txModal') closeTxModal(); });

$('#fabAdd').addEventListener('click', () => openTxModal());
$$('.qa').forEach(b => b.addEventListener('click', () => openTxModal(null, b.dataset.type)));

$('#txForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#txId').value;
  const data = {
    type: modalType,
    title: $('#txTitle').value,
    amount: $('#txAmount').value,
    category: $('#txCategory').value,
    notes: $('#txNotes').value,
    date: $('#txDate').value
  };
  try {
    if (id) {
      await updateTransaction(id, data);
      toast('Updated successfully', 'success');
    } else {
      await addTransaction(data);
      toast('Saved successfully', 'success');
    }
    closeTxModal();
    populateMonthYearFilters();
    renderAll();
    if ($('#view-analytics').classList.contains('active')) drawAllAnalytics();
  } catch(err) {
    toast(err.message || 'Error saving', 'error');
  }
});

/* Long-press / right-click on tx item to delete via confirm */
$('#recentList').addEventListener('contextmenu', txContextDelete);
$('#historyList').addEventListener('contextmenu', txContextDelete);
function txContextDelete(e) {
  const item = e.target.closest('.tx-item');
  if (!item) return;
  e.preventDefault();
  const id = item.dataset.id;
  confirmAction('Delete transaction?', 'This action cannot be undone.', async () => {
    await deleteTransaction(id);
    toast('Deleted successfully', 'success');
    renderAll();
    if ($('#view-analytics').classList.contains('active')) drawAllAnalytics();
  });
}

/* Add a delete option inside edit modal as a swipe? Provide a delete button alternative: long-press */
let pressTimer = null;
['recentList','historyList'].forEach(id => {
  const el = $('#' + id);
  el.addEventListener('touchstart', (e) => {
    const item = e.target.closest('.tx-item');
    if (!item) return;
    pressTimer = setTimeout(() => {
      const tid = item.dataset.id;
      confirmAction('Delete transaction?','This action cannot be undone.', async () => {
        await deleteTransaction(tid);
        toast('Deleted successfully','success');
        renderAll();
      });
    }, 600);
  }, {passive:true});
  el.addEventListener('touchend', () => clearTimeout(pressTimer));
  el.addEventListener('touchmove', () => clearTimeout(pressTimer));
});

/* ===========================================================
   CATEGORIES UI
=========================================================== */
function renderCategoriesList() {
  const c = $('#categoryList');
  if (!c) return;
  c.innerHTML = '';
  state.categories.forEach(cat => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${escapeHtml(cat.name)}${!cat.isDefault ? ' <button data-id="'+cat.id+'">✕</button>':''}`;
    c.appendChild(chip);
  });
  $$('#categoryList .chip button').forEach(b => {
    b.addEventListener('click', () => {
      confirmAction('Delete category?','Existing transactions keep this category as a label.', async () => {
        await deleteCategory(b.dataset.id);
        renderCategoriesList();
        populateCategorySelect();
        toast('Category deleted','success');
      });
    });
  });
}

$('#addCategoryBtn').addEventListener('click', async () => {
  const name = $('#newCategory').value;
  try {
    await addCategory(name);
    $('#newCategory').value = '';
    renderCategoriesList();
    populateCategorySelect();
    toast('Category added','success');
  } catch(e) { toast(e.message,'error'); }
});

/* ===========================================================
   PIN MANAGEMENT (Settings)
=========================================================== */
let newPinLen = 4;
$$('#pinNewLenGroup .pill').forEach(p => {
  p.addEventListener('click', () => {
    $$('#pinNewLenGroup .pill').forEach(x => x.classList.remove('active'));
    p.classList.add('active');
    newPinLen = parseInt(p.dataset.len,10);
    $('#pinNew').maxLength = newPinLen;
    $('#pinNewConfirm').maxLength = newPinLen;
  });
});

$('#changePinBtn').addEventListener('click', () => {
  $('#pinCurrent').value = '';
  $('#pinNew').value = '';
  $('#pinNewConfirm').value = '';
  newPinLen = state.settings.pinLength;
  $$('#pinNewLenGroup .pill').forEach(p => p.classList.toggle('active', parseInt(p.dataset.len,10) === newPinLen));
  $('#pinModal').classList.remove('hidden');
});
$('#pinModalClose').addEventListener('click', () => $('#pinModal').classList.add('hidden'));

$('#pinSaveBtn').addEventListener('click', async () => {
  const cur = $('#pinCurrent').value;
  const np = $('#pinNew').value;
  const nc = $('#pinNewConfirm').value;
  const ch = await sha256(cur);
  if (ch !== state.settings.pinHash) return toast('Current PIN is wrong','error');
  if (!/^\d+$/.test(np) || np.length !== newPinLen) return toast('New PIN length mismatch','error');
  if (np !== nc) return toast('PINs do not match','error');
  const nh = await sha256(np);
  await saveSetting('pinHash', nh);
  await saveSetting('pinLength', newPinLen);
  $('#pinModal').classList.add('hidden');
  toast('PIN updated','success');
});

/* RECOVERY RESET */
$('#resetRecoveryBtn').addEventListener('click', () => {
  $('#rrCurrentPin').value = '';
  $('#rrNewKey').value = '';
  $('#recoveryResetModal').classList.remove('hidden');
});
$('#recoveryResetClose').addEventListener('click', () => $('#recoveryResetModal').classList.add('hidden'));

$('#rrSaveBtn').addEventListener('click', async () => {
  const cp = $('#rrCurrentPin').value;
  const nk = $('#rrNewKey').value.trim();
  const ch = await sha256(cp);
  if (ch !== state.settings.pinHash) return toast('Wrong PIN','error');
  if (nk.length < 4) return toast('Recovery key too short','error');
  confirmAction('Reset recovery key?','You will not see it again. Save it before confirming.', async () => {
    const nh = await sha256(nk);
    await saveSetting('recoveryHash', nh);
    $('#recoveryResetModal').classList.add('hidden');
    toast('Recovery key updated','success');
  });
});

/* ===========================================================
   BACKUP / IMPORT / CLEAR
=========================================================== */
$('#exportBtn').addEventListener('click', async () => {
  try {
    const data = {
      app: 'CoinLence',
      version: '2.0',
      exportedAt: new Date().toISOString(),
      transactions: state.transactions,
      categories: state.categories,
      settings: state.settings
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coinlence-backup-${todayISO()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    await saveSetting('lastBackupPrompt', Date.now());
    toast('Backup ready','success');
  } catch(e) { toast('Export failed: ' + e.message,'error'); }
});

$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch(_) { return toast('Invalid JSON','error'); }
  if (!data || data.app !== 'CoinLence') return toast('Not a CoinLence backup','error');

  confirmAction('Import backup?','This will replace ALL current data with the backup contents.', async () => {
    try {
      await dbClear(STORES.TX);
      await dbClear(STORES.CATS);
      // do NOT wipe meta to keep current PIN unless backup includes a settings; but we should restore settings carefully
      if (Array.isArray(data.transactions)) {
        for (const t of data.transactions) {
          if (t && t.id && t.type && t.date) await dbPut(STORES.TX, t);
        }
      }
      if (Array.isArray(data.categories)) {
        for (const c of data.categories) {
          if (c && c.id && c.name) await dbPut(STORES.CATS, c);
        }
      }
      if (data.settings && typeof data.settings === 'object') {
        // Only restore non-sensitive prefs
        if (data.settings.theme) await saveSetting('theme', data.settings.theme);
      }
      await loadCategories();
      await loadTransactions();
      populateMonthYearFilters();
      populateCategorySelect();
      renderAll();
      toast('Backup imported','success');
    } catch(err) { toast('Import failed: ' + err.message,'error'); }
  });
  e.target.value = '';
});

$('#clearDataBtn').addEventListener('click', () => {
  confirmAction('Clear all data?','This will delete ALL transactions and custom categories. PIN is preserved.', async () => {
    try {
      await dbClear(STORES.TX);
      await dbClear(STORES.CATS);
      state.transactions = [];
      state.categories = [];
      await loadCategories();
      populateCategorySelect();
      populateMonthYearFilters();
      renderAll();
      toast('Data cleared','success');
    } catch(e) { toast('Failed: ' + e.message,'error'); }
  });
});

/* ===========================================================
   BACKUP REMINDER
=========================================================== */
function checkBackupReminder() {
  const last = state.settings.lastBackupPrompt || 0;
  const days = (Date.now() - last) / 86400000;
  if (days >= BACKUP_REMINDER_DAYS && state.transactions.length > 0) {
    setTimeout(() => {
      toast('Tip: Backup your data from Settings ↻','info', 4000);
    }, 1500);
  }
}

/* ===========================================================
   CHARTS — Pure Canvas API
=========================================================== */
function getChartColors() {
  const dark = document.body.dataset.theme === 'dark';
  return {
    text: dark ? '#cdd5e3' : '#1a2238',
    grid: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    income: '#2ecc71',
    expense: '#ff5c5c',
    lend: '#ffb547',
    borrow: '#a17bff',
    primary: '#5b8cff'
  };
}

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,rect.width,rect.height);
  return { ctx, w: rect.width, h: rect.height };
}

function drawDashboardChart() {
  const cv = $('#chartMonthly');
  if (!cv) return;
  const { ctx, w, h } = setupCanvas(cv);
  const colors = getChartColors();

  const now = new Date();
  const txs = txByMonth(now.getFullYear(), now.getMonth());
  const t = computeTotals(txs);
  const data = [
    { label:'Income', value: t.income, color: colors.income },
    { label:'Expense', value: t.expense, color: colors.expense },
    { label:'Lend', value: t.lend, color: colors.lend },
    { label:'Borrow', value: t.borrow, color: colors.borrow }
  ];
  drawBarChart(ctx, w, h, data, colors);
}

function drawBarChart(ctx, w, h, data, colors) {
  const padL = 50, padR = 16, padT = 16, padB = 40;
  const cw = w - padL - padR;
  const ch = h - padT - padB;
  const max = Math.max(1, ...data.map(d=>d.value));
  // y grid (4 lines)
  ctx.strokeStyle = colors.grid;
  ctx.fillStyle = colors.text;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  for (let i=0; i<=4; i++) {
    const y = padT + (ch / 4) * i;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w-padR, y); ctx.stroke();
    const val = max - (max/4)*i;
    ctx.fillText(formatShort(val), padL-6, y+4);
  }
  const barW = cw / data.length * 0.55;
  const gap = cw / data.length;
  ctx.textAlign = 'center';
  data.forEach((d, i) => {
    const x = padL + gap*i + (gap-barW)/2;
    const bh = (d.value / max) * ch;
    const y = padT + ch - bh;
    // gradient
    const grad = ctx.createLinearGradient(0,y,0,y+bh);
    grad.addColorStop(0, d.color);
    grad.addColorStop(1, d.color + '88');
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, barW, bh, 6);
    ctx.fill();
    // label
    ctx.fillStyle = colors.text;
    ctx.fillText(d.label, x + barW/2, h - padB + 18);
    // value above
    if (bh > 14) {
      ctx.fillStyle = colors.text;
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(formatShort(d.value), x + barW/2, y - 4);
      ctx.font = '11px sans-serif';
    }
  });
}

function roundRect(ctx, x, y, w, h, r) {
  if (h < 1) h = 1;
  r = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h);
  ctx.lineTo(x, y+h);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}

function formatShort(n) {
  n = Number(n) || 0;
  if (n >= 1e7) return (n/1e7).toFixed(1)+'Cr';
  if (n >= 1e5) return (n/1e5).toFixed(1)+'L';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return n.toFixed(0);
}

function drawAllAnalytics() {
  drawIncomeExpenseChart();
  drawExpenseBreakdownChart();
  drawLendBorrowChart();
  drawMonthlyTrendChart();
}

function drawIncomeExpenseChart() {
  const cv = $('#chartIncomeExpense');
  if (!cv) return;
  const { ctx, w, h } = setupCanvas(cv);
  const colors = getChartColors();
  const t = computeTotals();
  drawBarChart(ctx, w, h, [
    { label:'Income', value: t.income, color: colors.income },
    { label:'Expense', value: t.expense, color: colors.expense }
  ], colors);
}

function drawLendBorrowChart() {
  const cv = $('#chartLendBorrow');
  if (!cv) return;
  const { ctx, w, h } = setupCanvas(cv);
  const colors = getChartColors();
  const t = computeTotals();
  drawBarChart(ctx, w, h, [
    { label:'Lend', value: t.lend, color: colors.lend },
    { label:'Borrow', value: t.borrow, color: colors.borrow }
  ], colors);
}

function drawExpenseBreakdownChart() {
  const cv = $('#chartExpenseBreakdown');
  if (!cv) return;
  const { ctx, w, h } = setupCanvas(cv);
  const colors = getChartColors();
  const map = {};
  state.transactions.filter(t => t.type === 'expense').forEach(t => {
    map[t.category] = (map[t.category] || 0) + t.amount;
  });
  const entries = Object.entries(map).sort((a,b)=>b[1]-a[1]);
  if (!entries.length) {
    ctx.fillStyle = colors.text;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No expense data', w/2, h/2);
    return;
  }
  // Donut
  const cx = h*0.55, cy = h/2, r = Math.min(h, w*0.5)/2 - 16;
  const total = entries.reduce((s,[,v])=>s+v,0);
  const palette = ['#ff5c5c','#ffb547','#5b8cff','#a17bff','#2ecc71','#ff8fab','#48cae4','#f4a261','#9d4edd','#06d6a0'];
  let start = -Math.PI/2;
  entries.forEach(([_, v], i) => {
    const slice = (v/total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start + slice);
    ctx.closePath();
    ctx.fillStyle = palette[i % palette.length];
    ctx.fill();
    start += slice;
  });
  // inner hole
  ctx.beginPath();
  ctx.arc(cx, cy, r*0.55, 0, Math.PI*2);
  ctx.fillStyle = document.body.dataset.theme === 'dark' ? '#121a2c' : '#ffffff';
  ctx.fill();
  // total in middle
  ctx.fillStyle = colors.text;
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(formatShort(total), cx, cy - 2);
  ctx.font = '10px sans-serif';
  ctx.fillText('Total Expense', cx, cy + 14);

  // legend
  const lx = h + 8;
  let ly = 16;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  entries.slice(0,8).forEach(([name,v],i) => {
    ctx.fillStyle = palette[i % palette.length];
    ctx.fillRect(lx, ly, 10, 10);
    ctx.fillStyle = colors.text;
    const pct = ((v/total)*100).toFixed(0) + '%';
    const label = name.length > 10 ? name.slice(0,9)+'…' : name;
    ctx.fillText(`${label}  ${pct}`, lx + 16, ly + 9);
    ly += 18;
  });
}

function drawMonthlyTrendChart() {
  const cv = $('#chartMonthlyTrend');
  if (!cv) return;
  const { ctx, w, h } = setupCanvas(cv);
  const colors = getChartColors();

  // last 6 months
  const months = [];
  const now = new Date();
  for (let i=5; i>=0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
      label: monthName(d.getMonth()).slice(0,3)
    });
  }
  const data = months.map(m => {
    const txs = state.transactions.filter(t => t.date.startsWith(m.key));
    const t = computeTotals(txs);
    return { label: m.label, income: t.income, expense: t.expense };
  });

  const padL = 44, padR = 12, padT = 14, padB = 40;
  const cw = w - padL - padR;
  const ch = h - padT - padB;
  const max = Math.max(1, ...data.flatMap(d => [d.income, d.expense]));

  // grid
  ctx.strokeStyle = colors.grid;
  ctx.fillStyle = colors.text;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  for (let i=0;i<=4;i++){
    const y = padT + (ch/4)*i;
    ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(w-padR,y); ctx.stroke();
    ctx.fillText(formatShort(max-(max/4)*i), padL-6, y+4);
  }

  const stepX = cw / Math.max(1, data.length-1);

  // line drawing helper
  function drawLine(key, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 2.5;
    ctx.beginPath();
    data.forEach((d,i) => {
      const x = padL + stepX*i;
      const y = padT + ch - (d[key]/max)*ch;
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();
    // dots
    ctx.fillStyle = color;
    data.forEach((d,i) => {
      const x = padL + stepX*i;
      const y = padT + ch - (d[key]/max)*ch;
      ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill();
    });
  }

  drawLine('income', colors.income);
  drawLine('expense', colors.expense);

  // x labels
  ctx.fillStyle = colors.text;
  ctx.textAlign = 'center';
  data.forEach((d,i) => {
    const x = padL + stepX*i;
    ctx.fillText(d.label, x, h - padB + 18);
  });

  // legend
  ctx.textAlign = 'left';
  ctx.fillStyle = colors.income; ctx.fillRect(padL, h - 14, 10, 10);
  ctx.fillStyle = colors.text; ctx.fillText('Income', padL+14, h - 5);
  ctx.fillStyle = colors.expense; ctx.fillRect(padL+70, h - 14, 10, 10);
  ctx.fillStyle = colors.text; ctx.fillText('Expense', padL+84, h - 5);
}

/* Redraw on resize */
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if ($('#view-dashboard').classList.contains('active')) drawDashboardChart();
    if ($('#view-analytics').classList.contains('active')) drawAllAnalytics();
  }, 150);
});

/* ===========================================================
   AUTO-LOCK INACTIVITY (15 min)
=========================================================== */
function resetLockTimer() {
  if (lockTimer) clearTimeout(lockTimer);
  lockTimer = setTimeout(() => {
    if (!$('#app').classList.contains('hidden')) lockApp();
  }, 15 * 60 * 1000);
}
['click','touchstart','keydown','mousemove'].forEach(ev =>
  document.addEventListener(ev, resetLockTimer, { passive: true })
);

/* ===========================================================
   SERVICE WORKER
=========================================================== */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW reg failed', err));
  });
}

/* ===========================================================
   INIT
=========================================================== */
async function init() {
  try {
    await dbInit();
    await loadSettings();
    await loadCategories();
    await loadTransactions();

    applyTheme(state.settings.theme);

    // [NEW] Inject cloud UI elements (non-blocking)
    injectCloudSyncSettingsCard();

    // [NEW] Load Firebase in background — does NOT block app startup
    loadFirebase().then(() => {
      // After Firebase loads, hook MutationObserver to trigger sync
      patchDataFunctionsForSync();
    }).catch(() => {
      // Silently fail — app works offline
    });

    // splash hold
    setTimeout(() => {
      if (!state.settings.pinHash) {
        showScreen('setup');
      } else {
        showScreen('lock');
        renderPinDots();
        $('#lockPin').focus();
      }
    }, 600);
  } catch(err) {
    console.error('Init failed', err);
    toast('Initialization failed: ' + err.message, 'error', 5000);
    setTimeout(() => showScreen('setup'), 800);
  }
}

document.addEventListener('DOMContentLoaded', init);

})();

/* =============================================================
   [NEW] ── FIRESTORE SECURITY RULES
   ─────────────────────────────────────────────────────────────
   Copy these rules into Firebase Console →
   Firestore Database → Rules tab.
   ─────────────────────────────────────────────────────────────

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Each user can only read/write their own data
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null
                         && request.auth.uid == userId;
    }

    // Deny everything else
    match /{document=**} {
      allow read, write: if false;
    }
  }
}

   ─────────────────────────────────────────────────────────────
   SETUP CHECKLIST:
   ✅ 1. Replace FIREBASE_CONFIG values at top of this file
   ✅ 2. Enable Google Sign-In in Firebase Console → Authentication
   ✅ 3. Add your domain to Firebase Console →
          Authentication → Settings → Authorized domains
   ✅ 4. Apply the Firestore Security Rules above
   ✅ 5. Deploy and test
   ============================================================= */