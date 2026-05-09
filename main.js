const { app, BrowserWindow, ipcMain, protocol, net, session, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const https = require('https');
const http = require('http');
const { URL, pathToFileURL } = require('url');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) app.quit();

// Register custom protocol for high-performance image loading
protocol.registerSchemesAsPrivileged([
  { scheme: 'inkflow', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

// ─── Storage paths ────────────────────────────────────────────────────────────
const USER_DATA = app.getPath('userData');
const DOWNLOADS_DIR = path.join(USER_DATA, 'downloads');
const DB_PATH = path.join(USER_DATA, 'db.json');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { library: {}, progress: {}, settings: {} }; }
}
function saveDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }

// ─── HTTP helpers (Node.js - no CORS) ────────────────────────────────────────
async function nodeFetch(url, options = {}) {
  const response = await net.fetch(url, {
    method: options.method || 'GET',
    headers: {
      'User-Agent': 'Inkflow/1.0 (Manga Reader)',
      'Accept': 'application/json',
      ...options.headers
    },
    body: options.body
  });

  const arrayBuffer = await response.arrayBuffer();
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: Buffer.from(arrayBuffer)
  };
}

async function apiGet(url, options = {}) {
  const res = await nodeFetch(url, options);
  if (res.status === 429) throw new Error('Rate limited. Please wait a moment.');
  if (res.status >= 400) throw new Error(`API error ${res.status}`);
  return JSON.parse(res.body.toString('utf8'));
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

// MangaDex API proxy
ipcMain.handle('mdex-fetch', async (_, urlPath, params) => {
  const base = 'https://api.mangadex.org';
  const url = new URL(base + urlPath);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (Array.isArray(v)) v.forEach(vi => url.searchParams.append(k, vi));
      else url.searchParams.set(k, String(v));
    });
  }
  return apiGet(url.toString());
});

// Jikan (MAL) API proxy
ipcMain.handle('jikan-fetch', async (_, urlPath) => {
  return apiGet('https://api.jikan.moe/v4' + urlPath);
});

// MangaPlus (Discovery Proxy)
ipcMain.handle('mplus-fetch', async (_, urlPath, params = {}) => {
  try {
    const url = new URL('https://jumpg-webapi.tokyo-shonenjump.com/api' + urlPath);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await nodeFetch(url.toString(), {
      headers: {
        'Origin': 'https://mangaplus.shueisha.co.jp',
        'Referer': 'https://mangaplus.shueisha.co.jp/',
        'Session-Token': 'inkflow-v1'
      }
    });
    return res.body; // Returns Buffer
  } catch (e) { console.error('MPlus Fetch Error:', e); throw e; }
});

// Comick API proxy

// ─── In-memory image cache (covers & pages, max ~150 entries) ────────────────
const imageCache = new Map();
const IMAGE_CACHE_MAX = 200;
function cacheSet(url, value) {
  if (imageCache.size >= IMAGE_CACHE_MAX) {
    imageCache.delete(imageCache.keys().next().value);
  }
  imageCache.set(url, value);
}

// Fetch image as base64 (for display in renderer without CORS issues)
ipcMain.handle('fetch-image', async (_, url) => {
  if (imageCache.has(url)) return imageCache.get(url);
  const res = await nodeFetch(url, { headers: { 'Referer': 'https://mangadex.org/' } });
  if (res.status >= 400) throw new Error(`Image fetch error ${res.status}`);
  const mime = res.headers['content-type'] || 'image/jpeg';
  const result = `data:${mime};base64,${res.body.toString('base64')}`;
  cacheSet(url, result);
  return result;
});

// Fetch multiple images in parallel (batch for reader preloading)
ipcMain.handle('fetch-images-batch', async (event, urls, concurrency = 6) => {
  const results = new Array(urls.length).fill(null);
  let idx = 0;
  async function worker() {
    while (idx < urls.length) {
      const i = idx++;
      const url = urls[i];
      try {
        if (imageCache.has(url)) {
          results[i] = imageCache.get(url);
        } else {
          const res = await nodeFetch(url, { headers: { 'Referer': 'https://mangadex.org/' } });
          const mime = res.headers['content-type'] || 'image/jpeg';
          const data = `data:${mime};base64,${res.body.toString('base64')}`;
          cacheSet(url, data);
          results[i] = data;
        }
        event.sender.send('batch-image-progress', { index: i, total: urls.length });
      } catch (e) {
        results[i] = null;
        event.sender.send('batch-image-progress', { index: i, total: urls.length });
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, worker);
  await Promise.all(workers);
  return results;
});

// Download chapter pages to disk
ipcMain.handle('download-chapter', async (event, mangaId, chapterId, chapterMeta, pageUrls) => {
  const dir = path.join(DOWNLOADS_DIR, mangaId, chapterId);
  await fsp.mkdir(dir, { recursive: true });

  const pages = new Array(pageUrls.length).fill(null);
  let completed = 0;
  let urlIdx = 0;

  async function downloadWorker() {
    while (urlIdx < pageUrls.length) {
      const i = urlIdx++;
      const url = pageUrls[i];
      const filePath = path.join(dir, `page_${String(i).padStart(3, '0')}.jpg`);

      try {
        const exists = await fsp.access(filePath).then(() => true).catch(() => false);
        if (!exists) {
          const res = await nodeFetch(url, { headers: { 'Referer': 'https://mangadex.org/' } });
          if (res.status < 400) await fsp.writeFile(filePath, res.body);
          else throw new Error(`HTTP ${res.status}`);
          await new Promise(r => setTimeout(r, 50)); // Politeness delay
        }
        pages[i] = filePath;
      } catch (e) {
        console.error(`Page ${i} download failed:`, e);
      } finally {
        completed++;
        event.sender.send('download-progress', { chapterId, current: completed, total: pageUrls.length });
      }
    }
  }

  const workers = Array.from({ length: Math.min(3, pageUrls.length) }, downloadWorker);
  await Promise.all(workers);

  // Save metadata
  const metaPath = path.join(dir, 'meta.json');
  await fsp.writeFile(metaPath, JSON.stringify({ ...chapterMeta, pages, downloadedAt: Date.now() }));
  return { success: true, pages, dir };
});

// Window Control IPC
ipcMain.on('window-minimize', () => win?.minimize());
ipcMain.on('window-maximize', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on('window-close', () => win?.close());
ipcMain.handle('window-is-maximized', () => win?.isMaximized());

// Get downloaded chapter list
ipcMain.handle('get-downloads', async () => {
  const result = {};
  try {
    const mangas = await fsp.readdir(DOWNLOADS_DIR);
    for (const mangaId of mangas) {
      const mangaDir = path.join(DOWNLOADS_DIR, mangaId);
      const stat = await fsp.stat(mangaDir);
      if (!stat.isDirectory()) continue;

      result[mangaId] = {};
      const chapters = await fsp.readdir(mangaDir);
      for (const chId of chapters) {
        const metaPath = path.join(mangaDir, chId, 'meta.json');
        try {
          const content = await fsp.readFile(metaPath, 'utf8');
          result[mangaId][chId] = JSON.parse(content);
        } catch { /* skip */ }
      }
    }
  } catch { /* ignore if dir missing */ }
  return result;
});

// Read a downloaded chapter page (returns a high-performance protocol URL)
ipcMain.handle('read-page', async (_, filePath) => {
  return `inkflow://local/${path.normalize(filePath)}`;
});

// Delete downloaded chapter
ipcMain.handle('delete-download', async (_, mangaId, chapterId) => {
  const dir = path.join(DOWNLOADS_DIR, mangaId, chapterId);
  try {
    await fsp.rm(dir, { recursive: true, force: true });
    const mangaDir = path.join(DOWNLOADS_DIR, mangaId);
    const remaining = await fsp.readdir(mangaDir);
    if (remaining.length === 0) await fsp.rmdir(mangaDir);
  } catch (err) {
    console.error('Delete failed:', err);
  }
  return { success: true };
});

// Clear both in-memory image cache and Electron's network cache
ipcMain.handle('clear-cache', async () => {
  imageCache.clear();
  await session.defaultSession.clearCache();
  return true;
});

// DB operations (library + progress)
ipcMain.handle('db-get', async () => await loadDB());
ipcMain.handle('db-save', async (_, db) => { await saveDB(db); return true; });
ipcMain.handle('db-clear', async () => { saveDB({ library: {}, progress: {}, history: { recent: [] }, settings: {} }); return true; });
ipcMain.handle('settings-get', async () => loadDB().settings || {});
ipcMain.handle('settings-save', async (_, settings) => {
  const db = loadDB();
  db.settings = { ...(db.settings || {}), ...settings };
  saveDB(db);
  return true;
});
ipcMain.handle('get-theme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

// ─── Window ───────────────────────────────────────────────────────────────────
let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820,
    minWidth: 900, minHeight: 600,
    show: false,
    backgroundColor: '#00000000', // Transparent for mica/vibrancy
    transparent: process.platform !== 'linux',
    frame: false, // Make window frameless
    titleBarStyle: 'hidden', // Keeps native traffic lights on macOS
    trafficLightPosition: { x: 18, y: 18 }, // Improved padding
    autoHideMenuBar: true,
    vibrancy: 'under-window', // macOS effect
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    icon: path.join(__dirname, 'assets', 'logo.ico'),
  });

  win.loadFile('renderer/index.html');

  if (process.platform === 'win32') {
    win.setBackgroundMaterial('mica'); // Modern Windows 11 effect
  }

  win.on('maximize', () => win.webContents.send('window-maximized', true));
  win.on('unmaximize', () => win.webContents.send('window-maximized', false));

  // Smooth show once ready
  win.once('ready-to-show', () => {
    win.show();
  });

  // Open DevTools only in dev
  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools();
  }
}

// Notify renderer when system theme changes
nativeTheme.on('updated', () => {
  win?.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
});

app.whenReady().then(() => {
  // Handle the 'inkflow://' protocol to serve local images efficiently
  protocol.handle('inkflow', (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'local') return new Response('Forbidden', { status: 403 });

    let decodedPath = decodeURIComponent(url.pathname);
    
    // Normalize Windows path formatting (/C:/path -> C:/path)
    if (process.platform === 'win32' && decodedPath.startsWith('/')) {
      decodedPath = decodedPath.slice(1);
    }
    
    const normalizedPath = path.normalize(decodedPath);
    const normalizedDownloads = path.normalize(DOWNLOADS_DIR);

    if (normalizedPath.startsWith(normalizedDownloads)) {
      return net.fetch(pathToFileURL(normalizedPath).toString());
    }
    return new Response('Forbidden', { status: 403 });
  });

  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
