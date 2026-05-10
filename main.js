const { app, BrowserWindow, ipcMain, protocol, net, session, nativeTheme, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const https = require('https');
const http = require('http');
const { URL, pathToFileURL } = require('url');

if (require('electron-squirrel-startup')) {
  app.quit();
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'inkflow', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

const USER_DATA = app.getPath('userData');
const DOWNLOADS_DIR = path.join(USER_DATA, 'downloads');
const DB_PATH = path.join(USER_DATA, 'db.json');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { library: {}, progress: {}, history: { recent: [] }, settings: {} }; }
}
function saveDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }

async function nodeFetch(url, options = {}) {
  const response = await net.fetch(url, {
    method: options.method || 'GET',
    headers: {
      'User-Agent': 'Inkflow/1.4.0 (Manga Reader)',
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

ipcMain.handle('jikan-fetch', async (_, urlPath) => {
  return apiGet('https://api.jikan.moe/v4' + urlPath);
});

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
    return res.body;
  } catch (e) { console.error('MPlus Fetch Error:', e); throw e; }
});

ipcMain.handle('comick-fetch', async (_, urlPath, params) => {
  const url = new URL('https://api.comick.fun' + urlPath);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (Array.isArray(v)) v.forEach(vi => url.searchParams.append(k, vi));
      else url.searchParams.set(k, String(v));
    });
  }
  return apiGet(url.toString());
});

const imageCache = new Map();
const IMAGE_CACHE_MAX = 200;
function cacheSet(url, value) {
  if (imageCache.size >= IMAGE_CACHE_MAX) {
    imageCache.delete(imageCache.keys().next().value);
  }
  imageCache.set(url, value);
}

ipcMain.handle('fetch-image', async (_, url) => {
  if (imageCache.has(url)) return imageCache.get(url);
  const res = await nodeFetch(url, { headers: { 'Referer': 'https://mangadex.org/' } });
  if (res.status >= 400) throw new Error(`Image fetch error ${res.status}`);
  const mime = res.headers['content-type'] || 'image/jpeg';
  const result = `data:${mime};base64,${res.body.toString('base64')}`;
  cacheSet(url, result);
  return result;
});

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
          await new Promise(r => setTimeout(r, 50));
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

  const metaPath = path.join(dir, 'meta.json');
  await fsp.writeFile(metaPath, JSON.stringify({ ...chapterMeta, pages, downloadedAt: Date.now() }));
  return { success: true, pages, dir };
});

ipcMain.on('window-minimize', () => win?.minimize());
ipcMain.on('window-maximize', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on('window-close', () => win?.close());
ipcMain.handle('window-is-maximized', () => win?.isMaximized());

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

ipcMain.handle('read-page', async (_, filePath) => {
  return `inkflow://local/${path.normalize(filePath)}`;
});

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

ipcMain.handle('clear-cache', async () => {
  imageCache.clear();
  await session.defaultSession.clearCache();
  return true;
});

ipcMain.handle('open-downloads-folder', async () => {
  await fsp.mkdir(DOWNLOADS_DIR, { recursive: true });
  const result = await shell.openPath(DOWNLOADS_DIR);
  return result === '';
});

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

ipcMain.handle('get-version', () => app.getVersion());

ipcMain.handle('open-external', (_, url) => {
  shell.openExternal(url);
});

ipcMain.on('request-db-clear', () => {
  win?.webContents.send('show-db-clear-confirmation');
});


const GITHUB_OWNER = 'zigby33';
const GITHUB_REPO  = 'inkflow';

function semverGt(a, b) {
  const parse = v => v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const [aMaj, aMin, aPat] = parse(a);
  const [bMaj, bMin, bPat] = parse(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPat > bPat;
}

async function checkGitHubForUpdate(silent = false) {
  const currentVersion = app.getVersion();
  console.log(`[Updater] Checking GitHub for updates. Current: v${currentVersion}`);
  win?.webContents.send('update-status', 'Checking for updates...');

  try {
    const data = await apiGet(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      { headers: { 'Accept': 'application/vnd.github.v3+json' } }
    );

    const latestVersion = (data.tag_name || '').replace(/^v/, '');
    console.log(`[Updater] Latest release on GitHub: v${latestVersion}`);

    if (!latestVersion) {
      win?.webContents.send('update-status', 'Could not read release version from GitHub.');
      win?.webContents.send('update-progress', null);
      return;
    }

    if (semverGt(latestVersion, currentVersion)) {
      const db = loadDB();
      if (silent && db.settings.notifiedUpdateVersion === latestVersion) {
        console.log(`[Updater] Already notified user about v${latestVersion}. Skipping prompt.`);
        return;
      }

      console.log(`[Updater] Update available: v${currentVersion} → v${latestVersion}`);
      win?.webContents.send('update-status', `Update available: v${latestVersion}`);
      win?.webContents.send('update-progress', null);

      win?.webContents.send('update-available', {
        latest: latestVersion,
        current: currentVersion,
        url: data.html_url,
        notes: (data.body || 'No notes provided.').slice(0, 400)
      });

      db.settings.notifiedUpdateVersion = latestVersion;
      saveDB(db);
    } else {
      console.log(`[Updater] Already up to date (v${currentVersion})`);
      if (!silent) {
        win?.webContents.send('update-status', `Inkflow v${currentVersion} is up to date.`);
      }
      win?.webContents.send('update-progress', null);
    }
  } catch (err) {
    console.error('[Updater] Error:', err);
    let msg = 'Update check failed: ' + err.message;
    if (err.message.includes('404')) {
      msg = 'No published releases found on GitHub yet.';
    } else if (err.message.includes('ENOTFOUND') || err.message.includes('ETIMEDOUT')) {
      msg = 'Network error — check your connection.';
    }
    if (!silent) win?.webContents.send('update-status', msg);
    win?.webContents.send('update-progress', null);
  }
}

function setupAutoUpdater() {
  const currentVersion = app.getVersion();
  console.log(`[Updater] App version: v${currentVersion}`);
  
  if (app.isPackaged) {
    setTimeout(() => checkGitHubForUpdate(true), 3000);
  } else {
    console.log('[Updater] Skipping update check in development mode.');
  }
}

ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    return 'Update checks are only available in packaged builds.';
  }
  await checkGitHubForUpdate(false);
  return 'Update check initiated.';
});

ipcMain.handle('get-theme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 820,
    minWidth: 900, minHeight: 600,
    show: false,
    backgroundColor: '#00000000',
    transparent: process.platform !== 'linux',
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 18, y: 18 },
    autoHideMenuBar: true,
    vibrancy: 'under-window',
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
    win.setBackgroundColor('#1a1a1a');
    win.setBackgroundMaterial('mica');
  }

  win.on('maximize', () => win.webContents.send('window-maximized', true));
  win.on('unmaximize', () => win.webContents.send('window-maximized', false));

  win.once('ready-to-show', () => {
    win.show();
  });

  // Open DevTools only in dev
  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools();
  }
}

nativeTheme.on('updated', () => {
  win?.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
});

app.whenReady().then(() => {
  protocol.handle('inkflow', (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'local') return new Response('Forbidden', { status: 403 });

    let decodedPath = decodeURIComponent(url.pathname);
    
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
  setupAutoUpdater();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
