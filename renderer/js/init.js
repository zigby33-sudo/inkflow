/**
 * Wire DOM, hydrate state from main process, then hand off to the router.
 */
import { S, api, readerState } from './state.js';
import { navigate, render } from './router.js';
import { DEFAULT_SOURCES } from './config.js';
import {
  applyFonts,
  applyAccent,
  syncWinMaxButton,
  showToast,
  showWhatsNew,
  resetReaderTimer,
} from './ui.js';
import {
  openReader,
  closeReader,
  shiftChapter,
  turnPage,
  jumpToPage,
  setReaderMode,
  setReaderDirection,
  toggleFullscreen,
  readDownloadedChapter,
} from './core.js';

async function boot() {
  S.db = await api.dbGet();
  S.downloads = await api.getDownloads();
  S.version = await api.getVersion();

  applyFonts();

  if (!S.db.history) S.db.history = {};
  if (!S.db.history.recent) S.db.history.recent = [];
  if (!S.db.progress) S.db.progress = {};
  if (!S.db.library) S.db.library = {};
  if (!S.db.settings) S.db.settings = {};

  if (!S.db.settings.sources) {
    S.db.settings.sources = structuredClone(DEFAULT_SOURCES);
  } else {
    let changed = false;
    for (const [id, meta] of Object.entries(DEFAULT_SOURCES)) {
      if (!S.db.settings.sources[id]) {
        S.db.settings.sources[id] = meta;
        changed = true;
      }
    }
    for (const id of Object.keys(S.db.settings.sources)) {
      if (!DEFAULT_SOURCES[id]) {
        delete S.db.settings.sources[id];
        changed = true;
      }
    }
    if (changed) api.dbSave(S.db);
  }

  document.getElementById('winMinBtn').addEventListener('click', () => api.winMinimize());
  document.getElementById('winMaxBtn').addEventListener('click', () => api.winMaximize());
  document.getElementById('winCloseBtn').addEventListener('click', () => api.winClose());
  api.winIsMaximized().then(syncWinMaxButton);
  api.onMaximizedChange(syncWinMaxButton);

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.view));
  });
  document.getElementById('logoBtn').addEventListener('click', () => navigate('home'));

  let searchTimer;
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    S.searchQuery = q;
    clearTimeout(searchTimer);
    if (q.length >= 2) searchTimer = setTimeout(() => navigate('search'), 380);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(searchTimer);
      S.searchQuery = e.target.value.trim();
      navigate('search');
    }
  });

  window.addEventListener('keydown', (e) => {
    const readerOpen = document.getElementById('readerView')?.classList.contains('active');
    if (readerOpen) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === '/' || (e.ctrlKey && (e.key === 'k' || e.key === 'K'))) {
      e.preventDefault();
      searchInput.focus();
      if (e.ctrlKey) searchInput.select();
    }
  });

  document.getElementById('closeReaderBtn').addEventListener('click', closeReader);
  document.getElementById('prevChBtn').addEventListener('click', () => shiftChapter(-1));
  document.getElementById('nextChBtn').addEventListener('click', () => shiftChapter(1));
  document.getElementById('prevPageBtn').addEventListener('click', () => turnPage(-1));
  document.getElementById('nextPageBtn').addEventListener('click', () => turnPage(1));
  document.getElementById('pageSelect').addEventListener('change', (e) => jumpToPage(parseInt(e.target.value, 10)));
  document.getElementById('chapterSelect').addEventListener('change', (e) => openReader(parseInt(e.target.value, 10)));
  document.getElementById('readerSettingsBtn').addEventListener('click', () => {
    document.getElementById('readerPanel').classList.toggle('hidden-panel');
  });
  document.getElementById('fullscreenBtn').addEventListener('click', toggleFullscreen);

  document.getElementById('readerHitboxLeft').addEventListener('click', () => turnPage(-1));
  document.getElementById('readerHitboxRight').addEventListener('click', () => turnPage(1));

  document.getElementById('readingModeSelect').addEventListener('change', (e) => {
    setReaderMode(e.target.value, true);
  });
  document.getElementById('pageWidthSelect').addEventListener('change', (e) => {
    const w = e.target.value === '9999' ? '100%' : `${e.target.value}px`;
    document.querySelectorAll('.reader-page').forEach((img) => {
      img.style.maxWidth = w;
    });
    readerState.pageWidth = e.target.value;
  });
  document.getElementById('readerDirectionSelect').addEventListener('change', (e) => {
    setReaderDirection(e.target.value, true);
  });
  document.getElementById('imageQualitySelect').addEventListener('change', (e) => {
    readerState.imageQuality = e.target.value;
    S.db.settings.imageQuality = e.target.value;
    api.settingsSave(S.db.settings);
    showToast(`Image quality: ${e.target.value === 'data-saver' ? 'Data Saver' : 'Original'}`);
  });
  document.getElementById('preloadSelect').addEventListener('change', (e) => {
    readerState.preloadCount = Number(e.target.value);
    S.db.settings.preloadPages = readerState.preloadCount;
    api.settingsSave(S.db.settings);
    showToast(`Preload pages: ${readerState.preloadCount}`);
  });
  document.getElementById('readerMangaTitle').addEventListener('click', closeReader);
  document.getElementById('reportChBtn').addEventListener('click', () => showToast('Thanks for the report!'));
  document.getElementById('clearCacheBtn').addEventListener('click', async () => {
    await api.clearCache();
    showToast('Cache cleared successfully');
  });

  api.onDownloadProgress(({ chapterId, current, total }) => {
    const btn = document.querySelector(`[data-ch-id="${chapterId}"] .ch-dl-btn`);
    if (btn) btn.title = `${current}/${total}`;
    const overlay = document.getElementById('dl-overlay-' + chapterId);
    if (overlay) {
      overlay.querySelector('.dl-progress-label').textContent = `Downloading page ${current}/${total}...`;
      overlay.querySelector('.progress-fill').style.width = `${Math.round((current / total) * 100)}%`;
    }
  });

  const readerView = document.getElementById('readerView');
  readerView.addEventListener('mousemove', () => {
    if (!readerView.classList.contains('active')) return;
    const toolbar = document.getElementById('readerToolbar');
    toolbar.classList.remove('hidden');
    resetReaderTimer();
  });

  const splash = document.getElementById('splashScreen');
  if (splash) {
    splash.style.opacity = '0';
    setTimeout(() => splash.remove(), 500);
  }

  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('source-btn')) {
      S.activeSource = e.target.dataset.source;
      render();
    }
  });

  if (S.db.settings.accentColor) applyAccent(S.db.settings.accentColor);

  api.onUpdateStatus((msg) => showToast(msg));

  api.onUpdateProgress((pct) => {
    S.updateProgress = pct;
    const wrap = document.getElementById('updateProgressWrap');
    if (wrap) {
      wrap.style.display = pct !== null && pct < 100 ? 'block' : 'none';
      const fill = document.getElementById('updateProgressFill');
      const label = document.getElementById('updateProgressLabel');
      if (fill) fill.style.width = `${Math.round(pct || 0)}%`;
      if (label) label.textContent = `Downloading update: ${Math.round(pct || 0)}%`;
    }
  });

  if (S.db.settings.lastVersion !== S.version) {
    setTimeout(() => showWhatsNew(S.version), 1000);
    S.db.settings.lastVersion = S.version;
    api.dbSave(S.db);
  }

  api.checkForUpdates();

  navigate('home');
}

boot();