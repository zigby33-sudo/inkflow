// Hand-off to standalone updater if the flag is present
if (process.argv.includes('--updater')) {
  require('./updater/main.js');
  return; // Prevent the rest of the main app from loading
}

const { app, BrowserWindow, ipcMain, protocol, net, session, nativeTheme, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { URL, pathToFileURL } = require('url');
const { spawn } = require('child_process');

if (require('electron-squirrel-startup')) {
  app.quit();
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'inkflow', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

const USER_DATA = app.getPath('userData');
const DOWNLOADS_DIR = path.join(USER_DATA, 'downloads');
const COVERS_DIR = path.join(USER_DATA, 'covers');
const DB_PATH = path.join(USER_DATA, 'db.json');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { library: {}, progress: {}, history: { recent: [] }, settings: {}, bookmarks: {} }; }
}
function saveDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }

async function nodeFetch(url, options = {}) {
  const response = await net.fetch(url, {
    method: options.method || 'GET',
    headers: {
      'User-Agent': `Inkflow/${app.getVersion()} (Manga Reader)`,
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


// Ensure Electron globals exist when this file is executed in the real app.
// (A plain node require would fail; that’s expected.)
// In the renderer/import flow we only use Electron runtime.

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

const activeDownloads = new Set();

ipcMain.handle('download-chapter', async (event, mangaId, chapterId, chapterMeta, pageUrls) => {
  const dir = path.join(DOWNLOADS_DIR, mangaId, chapterId);
  await fsp.mkdir(dir, { recursive: true });

  activeDownloads.add(chapterId);
  const pages = new Array(pageUrls.length).fill(null);
  let completed = 0;
  let failed = 0;
  let urlIdx = 0;

  async function downloadWorker() {
    while (urlIdx < pageUrls.length) {
      if (!activeDownloads.has(chapterId)) break;
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
        failed++;
        console.error(`Page ${i} download failed:`, e);
      } finally {
        completed++;
        event.sender.send('download-progress', { chapterId, current: completed, total: pageUrls.length, failed });
      }
    }
  }

  const workers = Array.from({ length: Math.min(3, pageUrls.length) }, downloadWorker);
  await Promise.all(workers);
  activeDownloads.delete(chapterId);

  const metaPath = path.join(dir, 'meta.json');
  await fsp.writeFile(metaPath, JSON.stringify({ ...chapterMeta, pages, downloadedAt: Date.now() }));
  return { success: true, pages, dir };
});

ipcMain.handle('cancel-download', (_, chapterId) => {
  activeDownloads.delete(chapterId);
  return true;
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
ipcMain.handle('db-clear', async () => { saveDB({ library: {}, progress: {}, history: { recent: [] }, settings: {}, bookmarks: {} }); return true; });
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

// ──────────────────────────────────────────────────────────────
// Import manga from local computer (folder or CBZ/ZIP)
// ──────────────────────────────────────────────────────────────

const IMPORT_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function stableMangaIdFromTitle(titleStr) {
  // Deterministic id so importing same title twice doesn't create duplicates.
  // Uses a simple hash to avoid pulling extra deps.
  const s = String(titleStr || 'untitled').trim().toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Make it look UUID-ish length.
  const x = (h >>> 0).toString(16).padStart(8, '0');
  return `local-${x}`;
}

function sanitizeSegment(seg) {
  return String(seg || '').trim().replace(/[\\/:*?"<>|\x00-\x1F]/g, '_');
}

function naturalSort(a, b) {
  // Natural compare for filenames like page_2.jpg
  const ax = String(a).toLowerCase();
  const bx = String(b).toLowerCase();
  const rx = /\d+|\D+/g;
  const as = ax.match(rx) || [ax];
  const bs = bx.match(rx) || [bx];
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const av = as[i];
    const bv = bs[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    const an = /^\d+$/.test(av);
    const bn = /^\d+$/.test(bv);
    if (an && bn) {
      const diff = parseInt(av, 10) - parseInt(bv, 10);
      if (diff !== 0) return diff;
    } else {
      if (av !== bv) return av < bv ? -1 : 1;
    }
  }
  return 0;
}

async function copyDirContentsForChapter({ srcDir, destChapterDir }) {
  await fsp.mkdir(destChapterDir, { recursive: true });
  const entries = await fsp.readdir(srcDir, { withFileTypes: true });

  const imageEntries = entries
    .filter(e => e.isFile())
    .map(e => e.name)
    .filter(name => {
      const ext = path.extname(name).toLowerCase();
      return IMPORT_IMAGE_EXTS.has(ext);
    })
    .sort(naturalSort);

  const pages = [];
  let pageIdx = 0;
  for (const fileName of imageEntries) {
    const srcPath = path.join(srcDir, fileName);
    const ext = path.extname(fileName).toLowerCase();
    const destPath = path.join(destChapterDir, `page_${String(pageIdx).padStart(3, '0')}${ext}`);
    await fsp.copyFile(srcPath, destPath);
    pages.push(destPath);
    pageIdx++;
  }

  return pages;
}

async function importFromFolder(folderPath) {
  const rootEntries = await fsp.readdir(folderPath, { withFileTypes: true });
  const subdirs = rootEntries.filter(e => e.isDirectory()).map(e => e.name);

  // Prefer explicit meta.json/title.txt if present at root.
  let titleStr = path.basename(folderPath);
  const metaPath = path.join(folderPath, 'meta.json');
  const titleTxt = path.join(folderPath, 'title.txt');
  try {
    if (fs.existsSync(metaPath)) {
      const raw = await fsp.readFile(metaPath, 'utf8');
      const meta = JSON.parse(raw);
      titleStr = meta?.title || meta?.manga?.title || titleStr;
    } else if (fs.existsSync(titleTxt)) {
      titleStr = (await fsp.readFile(titleTxt, 'utf8')).split(/\r?\n/)[0].trim() || titleStr;
    }
  } catch { /* ignore */ }

  const mangaId = stableMangaIdFromTitle(titleStr);
  const mangaDir = path.join(DOWNLOADS_DIR, mangaId);
  await fsp.mkdir(mangaDir, { recursive: true });

  // Determine chapters:
  // - If there are subfolders, each subfolder becomes a chapter.
  // - Else, treat root as single chapter.
  const chapterCandidates = subdirs.length > 0 ? subdirs : ['Chapter_1'];

  let firstChapterPage = null;
  let chapterIdx = 0;
  for (const chapFolder of chapterCandidates) {
    const chapterLabel = chapFolder === 'Chapter_1' ? '1' : sanitizeSegment(chapFolder);
    const chapterId = `${mangaId}-ch-${String(chapterIdx + 1).padStart(3, '0')}`;
    const destChapterDir = path.join(mangaDir, chapterId);

    const srcDir = subdirs.length > 0 ? path.join(folderPath, chapFolder) : folderPath;
    const pages = await copyDirContentsForChapter({ srcDir, destChapterDir });

    // If chapter has no pages, skip.
    if (!pages.length) continue;
    if (!firstChapterPage) firstChapterPage = pages[0];

    const meta = {
      chapter: chapterIdx + 1,
      title: chapterLabel,
      pages: pages.length,
    };

    const metaPathOut = path.join(destChapterDir, 'meta.json');
    await fsp.writeFile(metaPathOut, JSON.stringify({ ...meta, pages, downloadedAt: Date.now() }, null, 2));

    chapterIdx++;
  }

  let coverUrl = null;
  if (firstChapterPage) {
    const coverPath = path.join(COVERS_DIR, `${mangaId}.jpg`);
    try {
      const img = nativeImage.createFromPath(firstChapterPage);
      const thumbnail = img.resize({ height: 450 });
      await fsp.writeFile(coverPath, thumbnail.toJPEG(85));
      coverUrl = `inkflow://local/${path.normalize(coverPath)}`;
    } catch (e) {
      console.error('Local cover generation failed:', e);
    }
  }

  // Create library entry
  const db = loadDB();
  if (!db.library) db.library = {};
  db.library[mangaId] = {
    ...(db.library[mangaId] || {}),
    id: mangaId,
    title: titleStr,
    cover: coverUrl || (db.library[mangaId]?.cover || null),
    status: 'local',
    addedAt: db.library[mangaId]?.addedAt || Date.now(),
  };
  // Ensure db.downloads is NOT used (renderer uses getDownloads from filesystem)
  saveDB(db);

  return { mangaId, title: titleStr };
}

async function importFromArchive(archivePath) {
  // Optional CBZ/ZIP support: try unzip into temp folder.
  // This repo currently has no unzip dependency; use system `tar`/`unzip` when available.
  // On Windows, `unzip` may or may not exist. We'll attempt both.
  const osTmp = app.getPath('temp');
  const tmpDir = path.join(osTmp, `inkflow-import-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await fsp.mkdir(tmpDir, { recursive: true });

  // Try `tar` first (works if installed), then `powershell Expand-Archive`.
  try {
    await new Promise((resolve, reject) => {
      const ext = path.extname(archivePath).toLowerCase();
      // `tar` doesn't support .cbz reliably; still try.
      const cmd = `tar -xf "${archivePath}" -C "${tmpDir}"`;
      const child = spawn(cmd, { shell: true, stdio: 'ignore' });
      child.on('error', reject);
      child.on('exit', code => (code === 0 ? resolve() : reject(new Error('tar extract failed'))));
    });
  } catch {
    // PowerShell fallback
    await new Promise((resolve, reject) => {
      const cmd = `powershell -NoProfile -Command "Expand-Archive -Force -LiteralPath '${archivePath}' -DestinationPath '${tmpDir}'"`;
      const child = spawn(cmd, { shell: true, stdio: 'ignore' });
      child.on('error', reject);
      child.on('exit', code => (code === 0 ? resolve() : reject(new Error('Expand-Archive failed'))));
    });
  }

  // Determine root folder inside tmp
  const entries = await fsp.readdir(tmpDir, { withFileTypes: true });
  const rootDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
  const rootFolder = rootDirs.length === 1 ? path.join(tmpDir, rootDirs[0]) : tmpDir;

  try {
    return await importFromFolder(rootFolder);
  } finally {
    // best-effort cleanup
    try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

ipcMain.handle('pick-import-source', async () => {
  // Return a discriminated union: { type: 'folder', path } or { type:'archive', path }
  const { dialog } = require('electron');
  const choice = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Folder', 'CBZ/ZIP', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'Import manga',
    message: 'Import from a folder or a CBZ/ZIP archive?',
  });

  if (choice.response === 0) {
    const picked = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select manga folder'
    });
    if (picked.canceled || !picked.filePaths?.[0]) return null;
    return { type: 'folder', path: picked.filePaths[0] };
  }

  if (choice.response === 1) {
    const picked = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: 'Select CBZ/ZIP archive',
      filters: [{ name: 'Archives', extensions: ['cbz', 'zip'] }]
    });
    if (picked.canceled || !picked.filePaths?.[0]) return null;
    return { type: 'archive', path: picked.filePaths[0] };
  }

  return null;
});

ipcMain.handle('import-manga', async (_, picked) => {
  if (!picked?.type || !picked?.path) throw new Error('Invalid import source');

  if (picked.type === 'folder') {
    return await importFromFolder(picked.path);
  }

  if (picked.type === 'archive') {
    return await importFromArchive(picked.path);
  }

  throw new Error('Unsupported import type');
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

  const headers = { 'Accept': 'application/vnd.github.v3+json' };
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  }

  try {
    const data = await apiGet(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      { headers }
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

      // Find the appropriate binary asset (e.g., Setup.exe)
      const asset = data.assets?.find(a => a.name.endsWith('.exe'));

      win?.webContents.send('update-available', {
        latest: latestVersion,
        current: currentVersion,
        url: data.html_url,
        downloadUrl: asset?.browser_download_url,
        assetName: asset?.name,
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

ipcMain.handle('launch-updater', async (_, { url, assetName }) => {
  // Use the current executable but pass the --updater flag
  const child = spawn(process.execPath, [
    app.getAppPath(), 
    '--updater', 
    `--url=${url}`, 
    `--asset=${assetName}`
  ], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  app.quit();
});

ipcMain.handle('get-theme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900,
    minWidth: 1000, minHeight: 700,
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
    const checkInside = (root) => {
      const rel = path.relative(path.normalize(root), normalizedPath);
      return rel !== '' &&
        !rel.startsWith('..' + path.sep) &&
        rel !== '..' &&
        !path.isAbsolute(rel);
    };

    if (checkInside(DOWNLOADS_DIR) || checkInside(COVERS_DIR)) {
      return net.fetch(pathToFileURL(normalizedPath).toString());
    }
    return new Response('Forbidden', { status: 403 });
  });

  createWindow();
  setupAutoUpdater();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
