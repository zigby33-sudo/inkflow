// ═══════════════════════════════════════════════════════════════════
// INKFLOW — Renderer App Logic
// All API calls go through window.electron (IPC → main process)
// so MangaDex CORS restrictions are bypassed entirely.
// ═══════════════════════════════════════════════════════════════════

const api = window.electron;

// ── State ─────────────────────────────────────────────────────────
const S = {
  view: 'home',
  manga: null,
  chapters: [],
  currentChIdx: 0,
  db: { library: {}, progress: {}, history: {}, settings: {} },
  downloads: {},
  dlInProgress: new Set(),
  readerToolbarVisible: true,
  toolbarTimer: null,
  activeSource: 'mangadex',
  homeSort: 'followedCount',
  homeOffset: 0,
  updateProgress: null,
  libSearch: '',
  version: '',
};

// ── Init ──────────────────────────────────────────────────────────
async function init() {
  S.db = await api.dbGet();
  S.downloads = await api.getDownloads();
  S.version = await api.getVersion();

  // Apply high-quality system font stack
  applyFonts();

  // Initialize history if missing
  if (!S.db.history) S.db.history = {};
  if (!S.db.history.recent) S.db.history.recent = [];
  if (!S.db.progress) S.db.progress = {};
  if (!S.db.library) S.db.library = {};
  if (!S.db.settings) S.db.settings = {};
  const defaultSources = {
    mangadex: { enabled: true, name: 'MangaDex' },
    mal: { enabled: true, name: 'MyAnimeList' },
    mangaplus: { enabled: true, name: 'MangaPlus' }
  };

  if (!S.db.settings.sources) {
    S.db.settings.sources = defaultSources;
  } else {
    let changed = false;
    if (!S.db.settings.sources.mangaplus) { S.db.settings.sources.mangaplus = { enabled: true, name: 'MangaPlus' }; changed = true; }
    if (S.db.settings.sources.comick) { delete S.db.settings.sources.comick; changed = true; }
    for (const [id, meta] of Object.entries(defaultSources)) {
      if (!S.db.settings.sources[id]) {
        S.db.settings.sources[id] = meta;
        changed = true;
      }
    }
    if (changed) api.dbSave(S.db);
  }

  // Window Controls
  document.getElementById('winMinBtn').addEventListener('click', () => api.winMinimize());
  document.getElementById('winMaxBtn').addEventListener('click', () => api.winMaximize());
  document.getElementById('winCloseBtn').addEventListener('click', () => api.winClose());

  // Navigation
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.view));
  });
  document.getElementById('logoBtn').addEventListener('click', () => navigate('home'));

  // Search
  let searchTimer;
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', e => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    if (q.length >= 2) searchTimer = setTimeout(() => doSearch(q), 380);
  });
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { clearTimeout(searchTimer); doSearch(e.target.value.trim()); }
  });

  // Reader controls
  document.getElementById('closeReaderBtn').addEventListener('click', closeReader);
  document.getElementById('prevChBtn').addEventListener('click', () => shiftChapter(-1));
  document.getElementById('nextChBtn').addEventListener('click', () => shiftChapter(1));
  document.getElementById('prevPageBtn').addEventListener('click', () => turnPage(-1));
  document.getElementById('nextPageBtn').addEventListener('click', () => turnPage(1));
  document.getElementById('pageSelect').addEventListener('change', e => jumpToPage(parseInt(e.target.value)));
  document.getElementById('chapterSelect').addEventListener('change', e => openReader(parseInt(e.target.value)));
  document.getElementById('readerSettingsBtn').addEventListener('click', () => {
    document.getElementById('readerPanel').classList.toggle('hidden-panel');
  });
  document.getElementById('fullscreenBtn').addEventListener('click', toggleFullscreen);
  
  // Navigation Hitboxes
  document.getElementById('readerHitboxLeft').addEventListener('click', () => turnPage(-1));
  document.getElementById('readerHitboxRight').addEventListener('click', () => turnPage(1));

  document.getElementById('readingModeSelect').addEventListener('change', e => {
    setReaderMode(e.target.value);
  });
  document.getElementById('pageWidthSelect').addEventListener('change', e => {
    const w = e.target.value === '9999' ? '100%' : e.target.value + 'px';
    document.querySelectorAll('.reader-page').forEach(img => img.style.maxWidth = w);
    readerState.pageWidth = e.target.value;
  });
  document.getElementById('readerDirectionSelect').addEventListener('change', e => {
    setReaderDirection(e.target.value);
  });
  document.getElementById('readerMangaTitle').addEventListener('click', closeReader);
  document.getElementById('reportChBtn').addEventListener('click', () => showToast('Thanks for the report!'));
  document.getElementById('clearCacheBtn').addEventListener('click', async () => {
    await api.clearCache();
    showToast('Cache cleared successfully');
  });

  // Download progress events from main process
  api.onDownloadProgress(({ chapterId, current, total }) => {
    const btn = document.querySelector(`[data-ch-id="${chapterId}"] .ch-dl-btn`);
    if (btn) btn.title = `${current}/${total}`;
    const overlay = document.getElementById('dl-overlay-' + chapterId);
    if (overlay) {
      overlay.querySelector('.dl-progress-label').textContent = `Downloading page ${current}/${total}...`;
      overlay.querySelector('.progress-fill').style.width = `${Math.round(current / total * 100)}%`;
    }
  });

  // Immersive Reader: Auto-hide UI logic
  const readerView = document.getElementById('readerView');
  readerView.addEventListener('mousemove', () => {
    if (!readerView.classList.contains('active')) return;
    
    const toolbar = document.getElementById('readerToolbar');
    toolbar.classList.remove('hidden');
    
    resetReaderTimer();
  });

  // Hide Splash Screen
  const splash = document.getElementById('splashScreen');
  if (splash) {
    splash.style.opacity = '0';
    setTimeout(() => splash.remove(), 500);
  }
  
  // Setup source switching listener
  document.addEventListener('click', e => {
    if (e.target.classList.contains('source-btn')) {
      S.activeSource = e.target.dataset.source;
      render();
    }
  });

  // Apply Accent Color
  if (S.db.settings.accentColor) applyAccent(S.db.settings.accentColor);

  // Handle background update notifications
  api.onUpdateStatus((msg) => showToast(msg));

  api.onUpdateProgress((pct) => {
    S.updateProgress = pct;
    const wrap = document.getElementById('updateProgressWrap');
    if (wrap) {
      wrap.style.display = (pct !== null && pct < 100) ? 'block' : 'none';
      const fill = document.getElementById('updateProgressFill');
      const label = document.getElementById('updateProgressLabel');
      if (fill) fill.style.width = Math.round(pct || 0) + '%';
      if (label) label.textContent = `Downloading update: ${Math.round(pct || 0)}%`;
    }
  });

  // Version check for What's New popup
  const currentVersion = '1.3.0';
  if (S.db.settings.lastVersion !== currentVersion) {
    setTimeout(() => showWhatsNew(currentVersion), 1000); // Small delay for better UX
    S.db.settings.lastVersion = currentVersion;
    api.dbSave(S.db);
  }

  // Auto-check for updates on startup
  api.checkForUpdates();

  navigate('home');
}

function applyFonts() {
  if (document.getElementById('inkflow-fonts')) return;
  const style = document.createElement('style');
  style.id = 'inkflow-fonts';
  style.textContent = `
    :root {
      /* Modern system font stacks for better readability */
      --font-head: "Inter", "Segoe UI Variable Display", "Segoe UI", system-ui, -apple-system, sans-serif;
      --font-body: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
      --font-mono: "JetBrains Mono", "Cascadia Code", "Fira Code", "SFMono-Regular", "Consolas", monospace;
    }
    body {
      font-family: var(--font-body);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: optimizeLegibility;
    }
  `;
  document.head.appendChild(style);
}

function applyAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
}

function resetReaderTimer() {
  const toolbar = document.getElementById('readerToolbar');
  clearTimeout(S.toolbarTimer);
  S.toolbarTimer = setTimeout(() => {
    // Only hide if the settings panel isn't open
    if (document.getElementById('readerPanel').classList.contains('hidden-panel')) {
      toolbar.classList.add('hidden');
    }
  }, 3500);
}

// ── Navigation ────────────────────────────────────────────────────
function navigate(view, data = null) {
  S.view = view;
  if (data) S.manga = data;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const nb = document.querySelector(`.nav-btn[data-view="${view === 'detail' ? 'home' : view}"]`);
  if (nb) nb.classList.add('active');
  render();
}

function render() {
  const main = document.getElementById('mainContent');
  switch (S.view) {
    case 'home':      renderBrowse(main); break;
    case 'search':    renderSearch(main); break;
    case 'detail':    renderDetail(main); break;
    case 'library':   renderLibrary(main); break;
    case 'history':   renderHistory(main); break;
    case 'downloads': renderDownloads(main); break;
    case 'settings':  renderSettings(main); break;
  }
}

function setReaderMode(mode, save = false) {
  readerState.mode = mode;
  const sel = document.getElementById('readingModeSelect');
  if (sel) sel.value = mode;
  renderAllPages(document.getElementById('readerPages'));
  if (save) {
    S.db.settings.defaultMode = mode;
    api.dbSave(S.db);
    showToast(`Reader mode saved: ${mode}`);
  }
}

function setReaderDirection(direction, save = false) {
  readerState.direction = direction;
  const sel = document.getElementById('readerDirectionSelect');
  if (sel) sel.value = direction;
  showToast(`Direction: ${direction.toUpperCase()}`);
  if (save) {
    S.db.settings.defaultDirection = direction;
    api.dbSave(S.db);
    showToast(`Reader direction saved: ${direction.toUpperCase()}`);
  }
}

async function loadOfflineChapterPages(filePaths, readerPages, readerLoading, loadingText, loadingBar) {
  const total = Array.isArray(filePaths) ? filePaths.length : 0;
  readerState.total = total;
  readerState.pages = new Array(total).fill(null);
  readerState.urls = [];
  readerState.loaded = new Set();

  loadingText.textContent = `Loading ${total} offline pages...`;
  let idx = 0;
  let loadedCount = 0;
  const CONCURRENCY = 6;

  async function worker() {
    while (idx < total) {
      const i = idx++;
      try {
        const b64 = await api.readPage(filePaths[i]);
        readerState.pages[i] = b64;
        readerState.loaded.add(i);
        loadedCount++;
        const pct = Math.round((loadedCount / total) * 100);
        if (loadingBar) loadingBar.style.width = pct + '%';
        loadingText.textContent = `Loading page ${loadedCount}/${total}...`;
        if (i === readerState.currentPage) renderTargetPage(readerPages, readerLoading);
      } catch (e) {
        readerState.pages[i] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
}

async function loadOnlineChapterPages(pageUrls, readerPages, readerLoading, loadingText, loadingBar) {
  readerState.total = pageUrls.length;
  readerState.urls = pageUrls;
  readerState.pages = new Array(pageUrls.length).fill(null);
  readerState.loaded = new Set();

  loadingText.textContent = `Loading ${pageUrls.length} pages...`;
  if (loadingBar) loadingBar.style.width = '5%';

  let loadedCount = 0;
  const unsubProgress = api.onBatchImageProgress(({ index, total }) => {
    loadedCount++;
    const pct = Math.round((loadedCount / total) * 100);
    if (loadingBar) loadingBar.style.width = pct + '%';
    loadingText.textContent = `Loading pages... ${loadedCount}/${total}`;
    // Render first page as soon as available
    if (index === readerState.currentPage) renderTargetPage(readerPages, readerLoading);
  });

  // Load current page immediately
  api.fetchImage(pageUrls[readerState.currentPage]).then(data => {
    readerState.pages[readerState.currentPage] = data;
    readerState.loaded.add(readerState.currentPage);
    if (readerState.mode === 'single') renderTargetPage(readerPages, readerLoading);
  }).catch(() => {});

  const results = await api.fetchImagesBatch(pageUrls, 5);
  if (unsubProgress) unsubProgress();
  results.forEach((data, i) => {
    readerState.pages[i] = data;
    if (data) readerState.loaded.add(i);
  });
}

// ── HISTORY ───────────────────────────────────────────────────────
function renderHistory(main) {
  const recent = S.db.history?.recent || [];
  const progress = S.db.history || {};

  if (recent.length === 0) {
    main.innerHTML = `
      <div class="section-title"><span class="ic">⏱</span> Reading History</div>
      <div class="empty-state"><div class="icon">🕐</div><p>No reading history yet.<br>Start reading manga and your history will appear here.</p></div>`;
    return;
  }

  // Find the last read manga for "continue reading"
  const lastId = S.db.history.lastMangaId;
  const lastManga = lastId ? recent.find(m => m.id === lastId) : null;
  const lastChProgress = lastManga ? S.db.history[lastManga.id] : null;
  const lastChId = lastChProgress ? Object.keys(lastChProgress).filter(k => k !== 'recent' && k !== 'lastMangaId').pop() : null;

  let heroHtml = '';
  if (lastManga && lastChId) {
    const pg = lastChProgress[lastChId];
    heroHtml = `
      <div class="hero-continue" data-manga-id="${lastManga.id}">
        ${lastManga.cover ? `<img class="hero-thumb" src="${lastManga.cover}" onerror="this.style.display='none'">` : '<div class="hero-thumb" style="background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:24px;">📖</div>'}
        <div class="hero-meta">
          <div class="hero-label">▶ Continue Reading</div>
          <div class="hero-title">${lastManga.title}</div>
          <div class="hero-sub">Last read: Page ${pg + 1}</div>
        </div>
        <button class="btn btn-primary" style="flex-shrink:0">Continue →</button>
      </div>`;
  }

  main.innerHTML = `
    <div class="section-title"><span class="ic">⏱</span> Reading History</div>
    ${heroHtml}
    <div class="section-title" style="font-size:11px;margin-top:4px;">Recently Viewed</div>
    <div class="manga-grid" id="histGrid"></div>`;

  // Fill grid
  const grid = document.getElementById('histGrid');
  grid.innerHTML = recent.map(m => {
    const readCount = Object.keys(S.db.history[m.id] || {}).filter(k => k !== 'recent' && k !== 'lastMangaId').length;
    return `
      <div class="manga-card" data-manga-id="${m.id}">
        <div class="manga-cover-wrap">
          ${m.cover ? `<img class="manga-cover" src="${m.cover}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'manga-cover-ph',textContent:'📖'}))">` : '<div class="manga-cover-ph">📖</div>'}
        </div>
        <div class="manga-info">
          <div class="manga-title">${m.title}</div>
          <div class="manga-sub">${readCount > 0 ? `${readCount} chapter${readCount !== 1 ? 's' : ''} read` : m.attributes?.status || ''}</div>
        </div>
        ${!!S.db.library[m.id] ? '<div class="manga-badge">★</div>' : ''}
      </div>`;
  }).join('');

  grid.querySelectorAll('[data-manga-id]').forEach(c => {
    c.addEventListener('click', () => openManga(c.dataset.mangaId));
  });

  // Hero continue button
  main.querySelector('.hero-continue')?.addEventListener('click', (e) => {
    const mid = e.currentTarget.dataset.mangaId;
    openManga(mid);
  });

  // Clear history button
  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn btn-ghost';
  clearBtn.style.cssText = 'font-size:11px;margin-top:16px;';
  clearBtn.textContent = '✕ Clear History';
  clearBtn.addEventListener('click', () => {
    if (confirm('Clear all reading history?')) {
      S.db.history = { recent: [], lastMangaId: null };
      api.dbSave(S.db);
      renderHistory(main);
      showToast('History cleared');
    }
  });
  main.appendChild(clearBtn);
}

// ── SOURCES / SETTINGS ────────────────────────────────────────────
async function renderSettings(main) {
  // Ensure we have the latest settings from the database
  S.db.settings = await api.settingsGet();
  const sources = S.db.settings.sources || {};

  // Storage info
  const libCount = Object.keys(S.db.library || {}).length;
  const dlManga = Object.keys(S.downloads || {}).length;
  const dlChapters = Object.values(S.downloads || {}).reduce((acc, chs) => acc + Object.keys(chs).length, 0);
  const totalPages = Object.values(S.downloads || {}).flatMap(m => Object.values(m)).reduce((acc, ch) => acc + (ch.pages?.length || 0), 0);

  main.innerHTML = `
    <div class="settings-container">
      <div class="section-title" style="display:flex; justify-content:space-between; align-items:center;"><span><span class="ic">⚙</span> Settings</span> <span style="font-size:10px; opacity:0.5; font-family:var(--font-mono); font-weight:normal; letter-spacing:0.5px;">v1.3.0 STABLE</span></div>
      <div class="section-title" style="display:flex; justify-content:space-between; align-items:center;"><span><span class="ic">⚙</span> Settings</span> <span style="font-size:10px; opacity:0.5; font-family:var(--font-mono); font-weight:normal; letter-spacing:0.5px;">v${S.version} STABLE</span></div>

      <div class="settings-group">
        <div class="settings-group-title">Appearance</div>
        <div class="settings-row">
          <div class="settings-info">
            <div class="settings-name">Accent Color</div>
            <div class="settings-desc">Personalize the application theme color.</div>
          </div>
          <div style="display:flex; gap:10px;">
            ${['#4a90e2', '#a855f7', '#22c55e', '#eab308', '#ef4444'].map(c => `
              <div class="accent-btn" data-color="${c}" style="width:22px; height:22px; border-radius:50%; background:${c}; cursor:pointer; border:2px solid ${S.db.settings.accentColor === c ? '#fff' : 'transparent'}; box-shadow:0 0 0 1px rgba(255,255,255,0.1)"></div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Content Sources</div>
        ${Object.entries(sources).map(([id, meta]) => `
          <div class="settings-row source-item">
            <div class="settings-info">
              <div class="settings-name">${meta.name}</div>
              <div class="settings-desc">${sourceDesc(id)}</div>
            </div>
            <label class="switch">
              <input type="checkbox" data-source-id="${id}" ${meta.enabled ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
          </div>
        `).join('')}
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Reader Preferences</div>
        <div class="settings-row">
          <div class="settings-info">
            <div class="settings-name">Reading Direction</div>
            <div class="settings-desc">Choose your preferred page flow.</div>
          </div>
          <select class="reader-select" id="defaultDirectionSel">
            <option value="ltr" ${(S.db.settings.defaultDirection || 'ltr') === 'ltr' ? 'selected' : ''}>Left → Right</option>
            <option value="rtl" ${(S.db.settings.defaultDirection || 'ltr') === 'rtl' ? 'selected' : ''}>Right → Left (Manga)</option>
          </select>
        </div>
        <div class="settings-row">
          <div class="settings-info">
            <div class="settings-name">Image Quality</div>
            <div class="settings-desc">Data Saver compresses images to save bandwidth.</div>
          </div>
          <select class="reader-select" id="imageQualitySel">
            <option value="original" ${(S.db.settings.imageQuality || 'original') === 'original' ? 'selected' : ''}>Original</option>
            <option value="data-saver" ${(S.db.settings.imageQuality || 'original') === 'data-saver' ? 'selected' : ''}>Data Saver</option>
          </select>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Storage & Cache</div>
        <div class="settings-row">
          <div class="settings-info">
            <div class="settings-name">Software Updates</div>
            <div class="settings-desc">Keep Inkflow up to date with the latest features.</div>
            <div id="updateProgressWrap" style="display:none; margin-top:10px; width:100%;">
              <div class="progress-bar" style="height:4px; background:var(--bg3);"><div id="updateProgressFill" class="progress-fill" style="width:0%; background:var(--accent);"></div></div>
              <div id="updateProgressLabel" style="font-size:10px; color:var(--text2); margin-top:4px;">Downloading update...</div>
            </div>
          </div>
          <button class="btn btn-primary" id="checkUpdateBtn">Check for Updates</button>
        </div>
        <div class="settings-row">
          <div class="settings-info">
            <div class="settings-name">Version History</div>
            <div class="settings-desc">See what changed in the latest update.</div>
          </div>
          <button class="btn btn-ghost" id="viewChangelogBtn">View Changelog</button>
        </div>
        <div class="settings-row">
          <div class="settings-info">
            <div class="settings-name">Local Library</div>
            <div class="settings-desc">${libCount} series tracking progress.</div>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-info">
            <div class="settings-name">Downloads</div>
            <div class="settings-desc">${dlChapters} chapters (${totalPages} pages) saved.</div>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-info">
            <div class="settings-name">Image Cache</div>
            <div class="settings-desc">Clearing cache will free up memory.</div>
          </div>
          <button class="btn btn-ghost" id="clearCacheSettingsBtn">🗑 Clear</button>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Shortcuts</div>
        <div class="shortcuts-grid">
          ${[
            ['← / →', 'Prev/Next Page'],
            ['[ / ]', 'Prev/Next Chapter'],
            ['F', 'Fullscreen'],
            ['H', 'Toggle UI'],
            ['D', 'Flip Direction'],
            ['Esc', 'Close Reader'],
          ].map(([key, desc]) => `
            <div class="settings-row" style="padding: 10px 16px;">
              <kbd class="kbd" style="background:var(--bg3); padding:2px 6px; border-radius:4px; font-family:var(--font-mono); font-size:11px; border:1px solid var(--glass-border);">${key}</kbd>
              <span style="font-size:12px; color:var(--text2);">${desc}</span>
            </div>`).join('')}
        </div>
      </div>
    </div>
  `;

  // Appearance Listeners
  main.querySelectorAll('.accent-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const color = btn.dataset.color;
      S.db.settings.accentColor = color;
      applyAccent(color);
      await api.settingsSave(S.db.settings);
      renderSettings(main);
    });
  });

  // Event Listeners for Saving immediately
  main.querySelectorAll('[data-source-id]').forEach(chk => {
    chk.addEventListener('change', async () => {
      S.db.settings.sources[chk.dataset.sourceId].enabled = chk.checked;
      await api.settingsSave(S.db.settings);
      showToast(`${S.db.settings.sources[chk.dataset.sourceId].name} ${chk.checked ? 'enabled' : 'disabled'}`);
    });
  });

  document.getElementById('defaultDirectionSel')?.addEventListener('change', async (e) => {
    S.db.settings.defaultDirection = e.target.value;
    await api.settingsSave(S.db.settings);
    showToast('Default direction saved');
  });

  document.getElementById('imageQualitySel')?.addEventListener('change', async (e) => {
    S.db.settings.imageQuality = e.target.value;
    await api.settingsSave(S.db.settings);
    showToast('Image quality preference saved');
  });

  // If an update was already downloading when we opened Settings, show the bar
  if (S.updateProgress !== null && S.updateProgress < 100) {
    const wrap = document.getElementById('updateProgressWrap');
    if (wrap) {
      wrap.style.display = 'block';
      document.getElementById('updateProgressFill').style.width = Math.round(S.updateProgress) + '%';
      document.getElementById('updateProgressLabel').textContent = `Downloading update: ${Math.round(S.updateProgress)}%`;
    }
  }

  document.getElementById('viewChangelogBtn')?.addEventListener('click', () => {
    showWhatsNew('1.3.0');
    showWhatsNew(S.version);
  });

  document.getElementById('checkUpdateBtn')?.addEventListener('click', async () => {
    const status = await api.checkForUpdates();
    showToast(status);
  });

  document.getElementById('clearCacheSettingsBtn')?.addEventListener('click', async () => {
    await api.clearCache();
    showToast('Image cache cleared');
  });
}

function sourceDesc(id) {
  const descs = {
    mangadex: 'The largest free manga platform. Browse, read, and download thousands of titles.',
    mal: 'MyAnimeList scores, rankings and metadata for manga detail pages.',
    mangaplus: 'Official publisher. Browse trending Shonen/Seinen series.',
  };
  return descs[id] || '';
}

async function renderBrowse(main) {
  const sources = S.db.settings.sources || {};
  const enabled = Object.entries(sources).filter(([_, v]) => v?.enabled);
  
  const sourceBar = `
    <div class="source-bar" style="margin-bottom: 20px; display: flex; gap: 10px; border-bottom: 1px solid var(--glass-border); padding-bottom: 10px;">
      ${enabled.map(([id, meta]) => `
        <button class="nav-btn source-btn ${S.activeSource === id ? 'active' : ''}" data-source="${id}">${meta?.name || id}</button>
      `).join('')}
    </div>
  `;

  // Setup source switcher UI
  main.innerHTML = sourceBar + loading(`Loading ${sources[S.activeSource]?.name || 'Source'}...`);

  try {
    if (S.activeSource === 'mangaplus') {
      await renderMangaPlusBrowse(main, sourceBar);
    } else if (S.activeSource === 'mal') {
      await renderMALBrowse(main, sourceBar);
    } else {
      await renderHome(main);
      // Prepend source bar without destroying existing listeners
      main.insertAdjacentHTML('afterbegin', sourceBar);
    }
  } catch (e) {
    main.innerHTML = sourceBar + err(e.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────
function title(m) {
  const t = m.attributes?.title;
  return t?.en || t?.['ja-ro'] || t?.ja || Object.values(t || {})[0] || 'Unknown Title';
}
function author(m) {
  return m.relationships?.find(r => r.type === 'author')?.attributes?.name || '';
}
function coverUrl(m) {
  const rel = m.relationships?.find(r => r.type === 'cover_art');
  if (!rel?.attributes?.fileName) return null;
  return `https://uploads.mangadex.org/covers/${m.id}/${rel.attributes.fileName}.256.jpg`;
}

function loading(msg = 'Loading...') {
  return `<div class="loading"><div class="spinner"></div>${msg}</div>`;
}
function err(msg, retryFn = null) {
  const retryId = retryFn ? 'retry-' + Date.now() : null;
  const retryBtn = retryFn ? `<button id="${retryId}" class="btn btn-outline" style="margin-top:12px;font-size:11px;">↺ Retry</button>` : '';
  const html = `<div class="loading" style="flex-direction:column;gap:8px;"><span style="color:var(--accent)">⚠ ${msg}</span>${retryBtn}</div>`;
  if (retryFn) {
    setTimeout(() => {
      document.getElementById(retryId)?.addEventListener('click', retryFn);
    }, 50);
  }
  return html;
}

// ── Image loading with IPC proxy ──────────────────────────────────
// Images are fetched through the main process to bypass MangaDex hotlink blocks
async function loadImagesViaIPC(imgEls) {
  for (const img of imgEls) {
    const src = img.dataset.src;
    if (!src) continue;
    try {
      const b64 = await api.fetchImage(src);
      img.src = b64;
    } catch {
      img.alt = '⚠';
    }
  }
}

// For cover thumbnails, set src directly — in Electron the renderer can
// reach MangaDex cover CDN (it's only the API and chapter images that
// need the main process proxy due to Referer checks).
function makeCoverImg(url, cls = 'manga-cover') {
  if (!url) return `<div class="${cls.includes('detail') ? 'detail-cover-ph' : 'manga-cover-ph'}">📖</div>`;
  return `<img class="${cls}" src="${url}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'manga-cover-ph',textContent:'📖'}))">`;
}

// ── HOME ──────────────────────────────────────────────────────────
const GENRE_TAGS = [
  { label: '⚔️ Action',    id: '391b0423-d847-456f-aff0-8b0cfc03066b' },
  { label: '💘 Romance',   id: 'e5301a23-ebd9-49dd-a0cb-2add944c7fe9' },
  { label: '😂 Comedy',    id: '4d32cc48-9f00-4cca-9b5a-a839f0764984' },
  { label: '👻 Horror',    id: 'cdad7e68-1419-41dd-bdce-27753074a640' },
  { label: '🌟 Fantasy',   id: 'cdc58593-87dd-415e-bbc0-2ec27bf404cc' },
  { label: '🔬 Sci-Fi',    id: '256c8bd9-4904-4360-bf4f-508a76d67183' },
  { label: '🧟 Isekai',    id: 'ace04997-f6bd-436e-b261-779182193d3d' },
  { label: '🥊 Sports',    id: '69964a64-2f90-4d33-beeb-e3bdbbe4a929' },
];

let homeActiveGenre = null;

async function renderHome(main) {
  const sort = S.homeSort || 'followedCount';
  S.homeOffset = 0;
  main.innerHTML = loading(`Loading catalog sorted by ${sort}...`);
  try {
    const res = await api.mdexFetch('/manga', {
      limit: 100,
      [`order[${sort}]`]: 'desc',
      'includes[]': ['cover_art', 'author'],
      'contentRating[]': ['safe', 'suggestive'],
      'availableTranslatedLanguage[]': ['en'],
    });

    const sortOptions = [
      { id: 'followedCount', label: 'Popularity' },
      { id: 'rating', label: 'Rating' },
      { id: 'updatedAt', label: 'Latest Updates' },
      { id: 'createdAt', label: 'Newest Additions' }
    ];

    // Continue reading hero
    const lastId = S.db.history?.lastMangaId;
    const lastManga = lastId ? S.db.history?.recent?.find(m => m.id === lastId) : null;
    const lastChProgress = lastManga ? S.db.history[lastManga.id] : null;
    const lastChId = lastChProgress ? Object.keys(lastChProgress).filter(k => k !== 'recent' && k !== 'lastMangaId').pop() : null;
    const heroHtml = (lastManga && lastChId) ? `
      <div class="hero-continue" data-manga-id="${lastManga.id}">
        ${lastManga.cover ? `<img class="hero-thumb" src="${lastManga.cover}" onerror="this.style.display='none'">` : '<div class="hero-thumb" style="background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:24px;">📖</div>'}
        <div class="hero-meta">
          <div class="hero-label">▶ Continue Reading</div>
          <div class="hero-title">${lastManga.title}</div>
          <div class="hero-sub">Tap to pick up where you left off</div>
        </div>
        <button class="btn btn-primary" style="flex-shrink:0">Continue →</button>
      </div>` : '';

    main.innerHTML = `
      ${heroHtml}
      <div class="home-controls" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:15px; padding:0 4px;">
        <div class="section-title" style="margin:0"><span class="ic">✨</span> Discovery</div>
        <select id="homeSortSelect" class="reader-select" style="width:auto; font-size:12px;">
          ${sortOptions.map(o => `<option value="${o.id}" ${sort === o.id ? 'selected' : ''}>Sort by: ${o.label}</option>`).join('')}
        </select>
      </div>

      <div class="genre-filter-bar" id="genreBar">
        ${GENRE_TAGS.map(g =>
          `<button class="genre-chip${homeActiveGenre === g.id ? ' active' : ''}" data-genre-id="${g.id}">${g.label}</button>`
        ).join('')}
      </div>
      <div id="genreSection" style="display:none">
        <div class="section-title" id="genreSectionTitle"><span class="ic">🏷</span> Genre</div>
        <div class="manga-grid" id="genreGrid"></div>
      </div>
      <div id="defaultSections">
        <div class="manga-grid" id="popGrid"></div>
        <div id="loadMoreHomeWrap" style="text-align:center; padding:20px 0 50px;">
          <button id="loadMoreHomeBtn" class="btn btn-outline" style="width:200px; font-size:12px;">Load More</button>
        </div>
      </div>
    `;
    fillGrid('popGrid', res.data);

    // Hero click
    main.querySelector('.hero-continue')?.addEventListener('click', (e) => {
      openManga(e.currentTarget.dataset.mangaId);
    });

    // Genre filter chips
    document.querySelectorAll('.genre-chip').forEach(btn => {
      btn.addEventListener('click', () => filterByGenre(btn.dataset.genreId, btn.textContent));
    });

    // Sort dropdown listener
    document.getElementById('homeSortSelect').addEventListener('change', e => {
      S.homeSort = e.target.value;
      renderHome(main);
    });

    // Load More listener
    document.getElementById('loadMoreHomeBtn').addEventListener('click', loadMoreHome);
  } catch (e) {
    main.innerHTML = err('Failed to load: ' + e.message, () => renderHome(main));
  }
}

async function loadMoreHome() {
  const btn = document.getElementById('loadMoreHomeBtn');
  if (!btn) return;
  
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Loading...';
  
  S.homeOffset += 100;
  const sort = S.homeSort || 'followedCount';
  
  try {
    const res = await api.mdexFetch('/manga', {
      limit: 100,
      offset: S.homeOffset,
      [`order[${sort}]`]: 'desc',
      'includes[]': ['cover_art', 'author'],
      'contentRating[]': ['safe', 'suggestive'],
      'availableTranslatedLanguage[]': ['en'],
    });

    if (res.data && res.data.length > 0) {
      const grid = document.getElementById('popGrid');
      const temp = document.createElement('div');
      temp.innerHTML = res.data.map(m => mangaCard(m)).join('');
      
      // Bind events to the new batch of cards before appending
      temp.querySelectorAll('[data-manga-id]').forEach(card => {
        card.addEventListener('click', () => openManga(card.dataset.mangaId));
      });
      
      while (temp.firstChild) {
        grid.appendChild(temp.firstChild);
      }

      btn.disabled = false;
      btn.textContent = originalText;
      if (res.data.length < 100) document.getElementById('loadMoreHomeWrap').style.display = 'none';
    } else {
      document.getElementById('loadMoreHomeWrap').style.display = 'none';
    }
  } catch (e) {
    showToast('Failed to load more: ' + e.message, true);
    btn.disabled = false;
    btn.textContent = 'Retry Load More';
    S.homeOffset -= 100;
  }
}

async function renderMangaPlusBrowse(main, sourceBar) {
  try {
    // To prevent empty results, we query the high-relevance 'Shonen' demographic
    // with safe content ratings.
    const res = await api.mdexFetch('/manga', {
      limit: 32,
      'publicationDemographic[]': ['shounen', 'seinen'],
      'order[relevance]': 'desc',
      'contentRating[]': ['safe', 'suggestive'],
      'includes[]': ['cover_art'],
      'availableTranslatedLanguage[]': ['en']
    });

    if (!res.data || res.data.length === 0) throw new Error("No series found.");

    main.innerHTML = sourceBar + `
      <div class="section-title"><span class="ic">✨</span> MangaPlus Official Trending</div>
      <div class="manga-grid" id="mplusGrid"></div>`;

    const grid = document.getElementById('mplusGrid');
    grid.innerHTML = res.data.map(m => {
      const c = coverUrl(m);
      const t = title(m);
      return `
        <div class="manga-card" data-mplus-title="${t.replace(/"/g, '&quot;')}">
          <div class="manga-cover-wrap">
            ${c ? `<img class="manga-cover" src="${c}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=manga-cover-ph>📖</div>'">` : '<div class="manga-cover-ph">📖</div>'}
          </div>
          <div class="manga-info">
            <div class="manga-title">${t}</div>
            <div class="manga-sub">Official Publisher</div>
          </div>
          <div class="manga-badge" style="background:#000; color:#fff; border:1px solid #333">M+</div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.manga-card').forEach(card => {
      card.addEventListener('click', () => {
        const q = card.dataset.mplusTitle;
        document.getElementById('searchInput').value = q;
        doSearch(q);
      });
    });
  } catch (e) {
    main.innerHTML = sourceBar + err('Mplus sync failed: ' + e.message);
  }
}

// ── MPlus Downloader Hook ─────────────────────────────────────────
async function downloadMplusChapter(mplusId, chapterId) {
  showToast("Initializing MangaPlus secure download...");
  // Logic flow for real scraper:
  // 1. Fetch chapter binary: api.mplusFetch(`/manga_viewer?chapter_id=${chapterId}...`)
  // 2. Decode Protobuf (requires external parser logic)
  // 3. For each page:
  //    a. Fetch encrypted JPG
  //    b. Run descrambling algorithm (pixel re-mapping)
  //    c. Save decrypted image to DOWNLOADS_DIR
  
  // Note: Due to Shueisha's encryption, this requires a canvas-based 
  // descrambler usually handled in the main process via sharp.
}

async function renderMALBrowse(main, sourceBar) {
  try {
    const res = await api.jikanFetch('/top/manga?limit=20');
    main.innerHTML = sourceBar + `
      <div class="section-title"><span class="ic">🌍</span> Globally Popular</div>
      <div class="manga-grid" id="malGrid"></div>`;

    const grid = document.getElementById('malGrid');
    grid.innerHTML = res.data.map(m => `
      <div class="manga-card" data-mal-title="${m.title}">
        <div class="manga-cover-wrap">
          <img class="manga-cover" src="${m.images.jpg.large_image_url || m.images.jpg.image_url}" loading="lazy" onerror="this.src=''">
        </div>
        <div class="manga-info">
          <div class="manga-title">${m.title}</div>
          <div class="manga-sub">Score: ${m.score}</div>
        </div>
      </div>
    `).join('');
    
    grid.querySelectorAll('[data-mal-title]').forEach(card => {
      card.addEventListener('click', () => {
        const q = card.dataset.malTitle;
        document.getElementById('searchInput').value = q;
        doSearch(q);
      });
    });
  } catch (e) {
    main.innerHTML = sourceBar + err('MAL load failed');
  }
}

async function filterByGenre(tagId, label) {
  if (homeActiveGenre === tagId) {
    // Toggle off
    homeActiveGenre = null;
    document.getElementById('genreSection').style.display = 'none';
    document.getElementById('defaultSections').style.display = '';
    document.querySelectorAll('.genre-chip').forEach(b => b.classList.remove('active'));
    return;
  }
  homeActiveGenre = tagId;
  document.querySelectorAll('.genre-chip').forEach(b => {
    b.classList.toggle('active', b.dataset.genreId === tagId);
  });
  const genreSection  = document.getElementById('genreSection');
  const defaultSec    = document.getElementById('defaultSections');
  const genreTitle    = document.getElementById('genreSectionTitle');
  const genreGrid     = document.getElementById('genreGrid');

  defaultSec.style.display = 'none';
  genreSection.style.display = '';
  genreTitle.innerHTML = `<span class="ic">🏷</span> ${label}`;
  genreGrid.innerHTML = loading('Loading...');

  try {
    const res = await api.mdexFetch('/manga', {
      limit: 30,
      'includedTags[]': [tagId],
      'order[followedCount]': 'desc',
      'includes[]': ['cover_art', 'author'],
      'contentRating[]': ['safe', 'suggestive'],
      'availableTranslatedLanguage[]': ['en'],
    });
    genreGrid.innerHTML = '';
    fillGrid('genreGrid', res.data);
  } catch (e) {
    genreGrid.innerHTML = err('Failed: ' + e.message);
  }
}

function fillGrid(id, mangas) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = mangas.map(m => mangaCard(m)).join('');
  el.querySelectorAll('[data-manga-id]').forEach(card => {
    card.addEventListener('click', () => openManga(card.dataset.mangaId));
  });
}

function mangaCard(m) {
  const inLib = !!S.db.library[m.id];
  const hasDl = !!S.downloads[m.id];
  const cover = coverUrl(m);
  return `
    <div class="manga-card" data-manga-id="${m.id}">
      <div class="manga-cover-wrap">
        ${cover ? `<img class="manga-cover" src="${cover}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'manga-cover-ph',textContent:'📖'}))">` : '<div class="manga-cover-ph">📖</div>'}
      </div>
      <div class="manga-info">
        <div class="manga-title">${title(m)}</div>
        <div class="manga-sub">${m.attributes.status || ''}</div>
      </div>
      ${inLib ? '<div class="manga-badge">★</div>' : ''}
      ${hasDl ? '<div class="manga-badge dl">↓</div>' : ''}
    </div>`;
}

// ── SEARCH ────────────────────────────────────────────────────────
async function doSearch(q) {
  if (!q || q.length < 2) return;
  S.view = 'search';
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const main = document.getElementById('mainContent');
  main.innerHTML = loading(`Searching sources for "${q}"...`);

  const sources = S.db.settings.sources;
  const searchPromises = [];
  const enabledSourceIds = [];

  // 1. Prepare search tasks for enabled sources
  if (sources.mangadex.enabled) {
    enabledSourceIds.push('mangadex');
    searchPromises.push(api.mdexFetch('/manga', {
      title: q, limit: 20,
      'includes[]': ['cover_art', 'author'],
      'contentRating[]': ['safe', 'suggestive'],
      'availableTranslatedLanguage[]': ['en'],
    }));
  }

  if (sources.comick.enabled) {
    enabledSourceIds.push('comick');
    searchPromises.push(api.comickFetch('/comic/search', {
      q: q, limit: 15, tl: 'en'
    }));
  }

  if (sources.mal.enabled) {
    enabledSourceIds.push('mal');
    searchPromises.push(api.jikanFetch(`/manga?q=${encodeURIComponent(q)}&limit=20`));
  }

  // 2. Execute parallel searches
  const results = await Promise.allSettled(searchPromises);

  // 3. Build the results UI
  let html = `<div class="section-title"><span class="ic">⌕</span> Search Results: "${q}"</div>`;
  
  results.forEach((result, idx) => {
    const sourceId = enabledSourceIds[idx];
    const sourceName = sources[sourceId].name;

    if (result.status === 'rejected') {
      html += `<div style="margin-bottom:20px; color:var(--accent); font-size:11px;">⚠ ${sourceName} search failed.</div>`;
      return;
    }

    if (sourceId === 'mangadex') {
      html += `<div class="section-title" style="font-size:12px; margin-top:20px;">MangaDex</div>
               <div class="manga-grid" id="srGridMD"></div>`;
    } else if (sourceId === 'mal') {
      html += `<div class="section-title" style="font-size:12px; margin-top:20px;">MyAnimeList</div>
               <div class="manga-grid" id="srGridMAL"></div>`;
    }
  });

  main.innerHTML = html;

  // 4. Fill grids and bind events
  results.forEach((result, idx) => {
    if (result.status === 'rejected') return;
    const sourceId = enabledSourceIds[idx];
    const data = result.value;

    if (sourceId === 'mangadex') {
      fillGrid('srGridMD', data.data);
    } else if (sourceId === 'mal') {
      const grid = document.getElementById('srGridMAL');
      grid.innerHTML = data.data.map(m => `
        <div class="manga-card" data-mal-title="${m.title.replace(/"/g, '&quot;')}">
          <div class="manga-cover-wrap">
            <img class="manga-cover" src="${m.images.jpg.large_image_url || m.images.jpg.image_url}" loading="lazy" onerror="this.src=''">
          </div>
          <div class="manga-info">
            <div class="manga-title">${m.title}</div>
            <div class="manga-sub">Score: ${m.score || 'N/A'}</div>
          </div>
        </div>`).join('');

      grid.querySelectorAll('[data-mal-title]').forEach(card => {
        card.addEventListener('click', () => {
          const title = card.dataset.malTitle;
          document.getElementById('searchInput').value = title;
          doSearch(title); // Re-search to find the MDex entry with chapters
        });
      });
    }
  });
}

// ── DETAIL ────────────────────────────────────────────────────────
async function openManga(id) {
  const main = document.getElementById('mainContent');
  main.innerHTML = loading('Loading manga...');
  S.view = 'detail';
  try {
    const mr = await api.mdexFetch(`/manga/${id}`, { 'includes[]': ['cover_art', 'author', 'artist'] });
    S.manga = mr.data;

    // Add to Recent History
    const tStr = title(S.manga);
    const mData = {
      id: S.manga.id,
      title: tStr,
      cover: coverUrl(S.manga),
      attributes: { status: S.manga.attributes.status }
    };
    // Pass raw title to helper for historical consistency
    S.db.history.recent = [mData, ...S.db.history.recent.filter(m => m.id !== mData.id)].slice(0, 24);
    S.db.history.lastMangaId = mData.id;
    api.dbSave(S.db);

    // Paginate through ALL chapters (handles 1000+ chapter series like One Piece)
    main.innerHTML = loading('Loading chapters...');
    const allChapters = [];
    const PAGE_SIZE = 100;
    let offset = 0;
    while (true) {
      const cr = await api.mdexFetch('/chapter', {
        manga: id, limit: PAGE_SIZE, offset,
        'translatedLanguage[]': ['en'],
        'order[chapter]': 'asc',
        'includes[]': ['scanlation_group'],
      });
      allChapters.push(...cr.data);
      if (allChapters.length >= cr.total || cr.data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    S.chapters = allChapters;
    renderDetail(main);
  } catch (e) {
    main.innerHTML = err(e.message);
  }
}

async function renderDetail(main) {
  const m = S.manga;
  if (!m) { renderHome(main); return; }

  const cover = coverUrl(m);
  const t = title(m);
  const a = author(m);
  const desc = m.attributes.description?.en || m.attributes.description?.ja || '';
  const tags = (m.attributes.tags || []).slice(0, 10).map(t => t.attributes.name.en).filter(Boolean);
  const inLib = !!S.db.library[m.id];

  // Build chapters HTML
  const progress = S.db.progress[m.id] || [];
  const chaptersHtml = S.chapters.length === 0
    ? '<div class="loading" style="color:var(--text2)">No English chapters available.</div>'
    : S.chapters.map((ch, i) => chapterRow(ch, i, m.id, progress)).join('');

  const descTruncated = desc.length > 300;

  main.innerHTML = `
    <button class="back-btn" id="backBtn">← Back</button>
    <div class="detail-header">
      <div class="detail-cover-wrap">
        ${cover ? `<img src="${cover}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'detail-cover-ph',textContent:'📖'}))">` : '<div class="detail-cover-ph">📖</div>'}
      </div>
      <div class="detail-meta">
        <div class="detail-title">${t}</div>
        ${a ? `<div class="detail-author">by ${a}</div>` : ''}
        <div class="tags">${tags.map(tg => `<span class="tag">${tg}</span>`).join('')}</div>
        ${desc ? `
          <div class="detail-desc ${descTruncated ? '' : 'expanded'}" id="detailDesc">${desc}</div>
          ${descTruncated ? `<button class="read-more-btn" id="readMoreBtn">Show More ▾</button>` : ''}
        ` : ''}
        <div class="detail-actions">
          <button class="btn btn-primary" id="startReadBtn" ${S.chapters.length === 0 ? 'disabled' : ''}>▶ Start Reading</button>
          <button class="btn btn-outline ${inLib ? 'active' : ''}" id="libBtn">${inLib ? '★ In Library' : '☆ Add to Library'}</button>
          <button class="btn btn-green" id="dlAllBtn">↓ Download All</button>
          <select id="malStatusSel">
            <option value="">— Reading Status —</option>
            <option value="reading">Reading</option>
            <option value="completed">Completed</option>
            <option value="on_hold">On Hold</option>
            <option value="dropped">Dropped</option>
            <option value="plan_to_read">Plan to Read</option>
          </select>
        </div>
        <div id="dlOverallProgress"></div>
      </div>
    </div>

    <div id="malSection"></div>

    <div class="chapter-list">
      <div class="chapter-list-header">
        <div class="section-title" style="margin-bottom:0"><span class="ic">§</span> Chapters (${S.chapters.length})</div>
        ${S.chapters.length > 10 ? `
          <div class="chapter-search-wrap">
            <input type="text" class="chapter-search-input" id="chapterSearch" placeholder="Filter chapters...">
            <select class="reader-select" id="chapterSort" style="width:auto;font-size:11px;">
              <option value="asc">Oldest First</option>
              <option value="desc">Newest First</option>
            </select>
          </div>` : ''}
      </div>
      <div id="chapterListEl">${chaptersHtml}</div>
    </div>`;

  // Restore MAL status
  const savedStatus = S.db.library[m.id]?.malStatus || '';
  document.getElementById('malStatusSel').value = savedStatus;

  // Wire buttons
  document.getElementById('backBtn').addEventListener('click', () => navigate('home'));
  document.getElementById('startReadBtn').addEventListener('click', () => openReader(0));
  document.getElementById('libBtn').addEventListener('click', () => toggleLibrary());
  document.getElementById('dlAllBtn').addEventListener('click', () => downloadAll());
  document.getElementById('malStatusSel').addEventListener('change', e => setMalStatus(e.target.value));

  // Expandable description
  document.getElementById('readMoreBtn')?.addEventListener('click', () => {
    const descEl = document.getElementById('detailDesc');
    const btn = document.getElementById('readMoreBtn');
    descEl.classList.toggle('expanded');
    btn.textContent = descEl.classList.contains('expanded') ? 'Show Less ▴' : 'Show More ▾';
  });

  // Chapter search/filter
  const chSearch = document.getElementById('chapterSearch');
  const chSort = document.getElementById('chapterSort');
  const filterChapters = () => {
    const q = chSearch?.value.toLowerCase() || '';
    const sortDir = chSort?.value || 'asc';
    const progress = S.db.progress[m.id] || [];
    let filtered = S.chapters.map((ch, i) => ({ ch, i }));
    if (q) {
      filtered = filtered.filter(({ ch }) => {
        const num = String(ch.attributes.chapter || '');
        const t2 = (ch.attributes.title || '').toLowerCase();
        return num.includes(q) || t2.includes(q);
      });
    }
    if (sortDir === 'desc') filtered = filtered.reverse();
    const listEl = document.getElementById('chapterListEl');
    listEl.innerHTML = filtered.length
      ? filtered.map(({ ch, i }) => chapterRow(ch, i, m.id, progress)).join('')
      : `<div class="loading" style="color:var(--text2);padding:20px">No chapters match "${q}"</div>`;
    bindChapterRows();
  };
  chSearch?.addEventListener('input', filterChapters);
  chSort?.addEventListener('change', filterChapters);

  // Wire chapter rows
  bindChapterRows();

  // Async: load MAL data
  loadMALData(t);
}

function chapterRow(ch, i, mangaId, readList) {
  const num = ch.attributes.chapter || '?';
  const ctitle = ch.attributes.title || '';
  const date = ch.attributes.publishAt ? new Date(ch.attributes.publishAt).toLocaleDateString() : '';
  const isRead = readList.includes(ch.id);
  const isDl = !!S.downloads[mangaId]?.[ch.id];
  const inProgress = S.dlInProgress.has(ch.id);
  return `
    <div class="chapter-item ${isRead ? 'read' : ''}" data-ch-id="${ch.id}" data-ch-idx="${i}">
      <div class="ch-num">Ch. ${num}</div>
      <div class="ch-title">${ctitle || 'Chapter ' + num}</div>
      ${isDl ? '<span class="chip chip-green">Saved</span>' : ''}
      <div class="ch-date">${date}</div>
      <div class="ch-dl-btn ${isDl ? 'downloaded' : inProgress ? 'downloading' : ''}" data-action="dl" title="${isDl ? 'Downloaded' : 'Download for offline'}">
        ${isDl ? '✓' : inProgress ? '↻' : '↓'}
      </div>
      <button class="btn btn-primary" data-action="read" style="padding:4px 10px;font-size:10px">Read</button>
    </div>
    ${inProgress ? `<div class="dl-progress-bar-wrap" id="dl-overlay-${ch.id}">
      <div class="dl-progress-label">Starting download...</div>
      <div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div>
    </div>` : ''}`;
}

function bindChapterRows() {
  document.querySelectorAll('.chapter-item').forEach(row => {
    const idx = parseInt(row.dataset.chIdx);
    const chId = row.dataset.chId;
    row.querySelector('[data-action="read"]')?.addEventListener('click', e => {
      e.stopPropagation(); openReader(idx);
    });
    row.querySelector('[data-action="dl"]')?.addEventListener('click', e => {
      e.stopPropagation(); downloadChapter(idx);
    });
  });
}

// ── MAL via Jikan ─────────────────────────────────────────────────
async function loadMALData(mangaTitle) {
  try {
    const res = await api.jikanFetch(`/manga?q=${encodeURIComponent(mangaTitle)}&limit=1`);
    const item = res.data?.[0];
    if (!item) return;
    const el = document.getElementById('malSection');
    if (!el) return;
    el.innerHTML = `
      <div class="mal-card">
        <div class="mal-card-title">📊 MyAnimeList</div>
        <div class="mal-stats">
          <div class="mal-stat"><div class="mal-stat-val">${item.score || '—'}</div><div class="mal-stat-label">Score</div></div>
          <div class="mal-stat"><div class="mal-stat-val">${(item.scored_by || 0).toLocaleString()}</div><div class="mal-stat-label">Voters</div></div>
          <div class="mal-stat"><div class="mal-stat-val">${item.rank ? '#' + item.rank : '—'}</div><div class="mal-stat-label">Rank</div></div>
          <div class="mal-stat"><div class="mal-stat-val">${item.popularity ? '#' + item.popularity : '—'}</div><div class="mal-stat-label">Popularity</div></div>
          <div class="mal-stat"><div class="mal-stat-val">${item.chapters || '—'}</div><div class="mal-stat-label">Chapters</div></div>
          <div class="mal-stat"><div class="mal-stat-val">${item.volumes || '—'}</div><div class="mal-stat-label">Volumes</div></div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <span class="chip chip-${item.status === 'Finished' ? 'green' : 'gold'}">${item.status || '—'}</span>
          <span class="chip chip-blue">${item.type || 'Manga'}</span>
          ${(item.genres || []).slice(0, 5).map(g => `<span class="chip chip-gray">${g.name}</span>`).join('')}
          <a href="https://myanimelist.net/manga/${item.mal_id}" target="_blank"
             style="margin-left:auto;font-family:var(--font-mono);font-size:10px;color:var(--blue);text-decoration:none">
            View on MAL →
          </a>
        </div>
      </div>`;
  } catch (_) { /* MAL data optional */ }
}

// ── LIBRARY ───────────────────────────────────────────────────────
function toggleLibrary() {
  const m = S.manga;
  if (S.db.library[m.id]) {
    delete S.db.library[m.id];
    showToast('Removed from library');
  } else {
    S.db.library[m.id] = {
      id: m.id, title: title(m), cover: coverUrl(m),
      status: m.attributes.status, addedAt: Date.now(),
    };
    showToast('Added to library ★');
  }
  api.dbSave(S.db);
  renderDetail(document.getElementById('mainContent'));
}

function setMalStatus(status) {
  if (!status) return;
  const m = S.manga;
  if (!S.db.library[m.id]) {
    S.db.library[m.id] = { id: m.id, title: title(m), cover: coverUrl(m), status: m.attributes.status, addedAt: Date.now() };
  }
  S.db.library[m.id].malStatus = status;
  api.dbSave(S.db);
  showToast('Status: ' + status.replace(/_/g, ' '));
}

function renderLibrary(main) {
  const ids = Object.keys(S.db.library);
  if (ids.length === 0) {
    main.innerHTML = `
      <div class="section-title"><span class="ic">★</span> My Library</div>
      <div class="empty-state"><div class="icon">📚</div><p>No manga saved yet.<br>Browse and click ☆ Add to Library.</p></div>`;
    return;
  }

  const categories = [
    { id: 'all', label: 'All' },
    { id: 'reading', label: 'Reading' },
    { id: 'plan_to_read', label: 'Plan to Read' },
    { id: 'completed', label: 'Completed' },
    { id: 'dropped', label: 'Dropped' }
  ];

  const activeCat = S.libFilter || 'all';
  const libSearch = S.libSearch || '';

  main.innerHTML = `
    <div class="section-title"><span class="ic">★</span> My Library</div>
    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:15px; flex-wrap:wrap;">
      <div class="tabs" style="margin:0">
        ${categories.map(c => `<button class="tab ${activeCat === c.id ? 'active' : ''}" data-cat="${c.id}">${c.label}</button>`).join('')}
      </div>
      <input type="text" id="libSearchInput" class="chapter-search-input" style="width:200px; margin:0; font-size:11px;" placeholder="Search your library..." value="${libSearch}">
    </div>
    <div class="manga-grid" id="libGrid"></div>`;

  main.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      S.libFilter = t.dataset.cat;
      const grid = document.getElementById('libGrid');
      const filtered = performLibFilter(ids, S.libFilter, S.libSearch);
      renderLibGrid(grid, filtered);
      main.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.cat === S.libFilter));
    });
  });

  document.getElementById('libSearchInput')?.addEventListener('input', e => {
    S.libSearch = e.target.value;
    const grid = document.getElementById('libGrid');
    const filtered = performLibFilter(ids, S.libFilter || 'all', S.libSearch);
    renderLibGrid(grid, filtered);
  });

  const filteredIds = performLibFilter(ids, activeCat, libSearch);
  renderLibGrid(document.getElementById('libGrid'), filteredIds);
}

function performLibFilter(ids, category, search) {
  let filtered = category === 'all' 
    ? ids 
    : ids.filter(id => S.db.library[id].malStatus === category);

  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(id => S.db.library[id].title.toLowerCase().includes(q));
  }
  return filtered;
}

function renderLibGrid(grid, filteredIds) {
  if (!grid) return;
  grid.innerHTML = filteredIds.map(id => {
    const e = S.db.library[id];
    const hasDl = !!S.downloads[id];
    const readCount = (S.db.progress[id] || []).length;
    return `
      <div class="manga-card" data-manga-id="${id}">
        <div class="manga-cover-wrap">
          ${e.cover ? `<img class="manga-cover" src="${e.cover}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'manga-cover-ph',textContent:'📖'}))">` : '<div class="manga-cover-ph">📖</div>'}
        </div>
        <div class="manga-info">
          <div class="manga-title">${e.title}</div>
          <div class="manga-sub">${e.malStatus ? e.malStatus.replace(/_/g, ' ') : e.status || ''}</div>
          ${readCount > 0 ? `<div class="progress-bar" title="${readCount} chapters read"><div class="progress-fill" style="width:${Math.min(100, readCount)}%"></div></div><div style="font-size:9px;color:var(--text2);margin-top:2px;">${readCount} ch read</div>` : ''}
        </div>
        <div class="manga-badge">★</div>
        ${hasDl ? '<div class="manga-badge dl">↓</div>' : ''}
      </div>`;
  }).join('');
  grid.querySelectorAll('[data-manga-id]').forEach(c => {
    c.addEventListener('click', () => openManga(c.dataset.mangaId));
  });
}

// ── DOWNLOADS PAGE ────────────────────────────────────────────────
function renderDownloads(main) {
  const mangaIds = Object.keys(S.downloads);
  if (mangaIds.length === 0) {
    main.innerHTML = `
      <div class="section-title"><span class="ic">↓</span> Downloads</div>
      <div class="empty-state"><div class="icon">💾</div><p>No downloaded chapters yet.<br>Open any manga and press ↓ to save chapters for offline reading.</p></div>`;
    return;
  }
  let html = `<div class="section-title"><span class="ic">↓</span> Downloaded — ${mangaIds.length} manga</div>`;
  for (const mid of mangaIds) {
    const chIds = Object.keys(S.downloads[mid]);
    const meta = S.db.library[mid];
    const totalPages = chIds.reduce((acc, cid) => acc + (S.downloads[mid][cid].pages?.length || 0), 0);
    html += `
      <div class="dl-manga-card">
        <div class="dl-manga-header">
          ${meta?.cover ? `<img class="dl-manga-thumb" src="${meta.cover}" onerror="this.style.display='none'">` : '<div class="dl-manga-thumb" style="display:flex;align-items:center;justify-content:center;font-size:20px">📖</div>'}
          <div style="flex:1;min-width:0">
            <div style="font-family:var(--font-head);font-weight:900;font-size:14px;cursor:pointer;margin-bottom:3px" data-open-manga="${mid}">${meta?.title || mid}</div>
            <div style="font-family:var(--font-mono);font-size:10px;color:var(--text2)">${chIds.length} chapter(s) · ${totalPages} pages</div>
          </div>
          <button class="btn btn-ghost" style="font-size:10px" data-delete-all="${mid}">✕ Delete All</button>
        </div>
        ${chIds.map(cid => {
          const ch = S.downloads[mid][cid];
          return `<div class="dl-chapter-row">
            <span style="font-family:var(--font-mono);font-size:11px;color:var(--accent);width:55px;flex-shrink:0">Ch. ${ch.chapter || '?'}</span>
            <span style="flex:1;font-size:12px">${ch.title || 'Chapter ' + ch.chapter}</span>
            <span class="chip chip-green">${Array.isArray(ch.pages) ? ch.pages.length : 0} pages</span>
            <button class="btn btn-primary" style="font-size:10px;padding:4px 10px" data-read-dl="${mid}|${cid}">Read</button>
            <button class="btn btn-ghost" style="font-size:10px;padding:4px 8px" data-delete-ch="${mid}|${cid}">✕</button>
          </div>`;
        }).join('')}
      </div>`;
  }
  main.innerHTML = html;
  main.querySelectorAll('[data-open-manga]').forEach(el => {
    el.addEventListener('click', () => openManga(el.dataset.openManga));
  });
  main.querySelectorAll('[data-delete-all]').forEach(el => {
    el.addEventListener('click', async () => {
      const mid = el.dataset.deleteAll;
      const chIds = Object.keys(S.downloads[mid]);
      for (const cid of chIds) await api.deleteDownload(mid, cid);
      delete S.downloads[mid];
      showToast('Deleted all downloads');
      renderDownloads(main);
    });
  });
  main.querySelectorAll('[data-delete-ch]').forEach(el => {
    el.addEventListener('click', async () => {
      const [mid, cid] = el.dataset.deleteCh.split('|');
      await api.deleteDownload(mid, cid);
      delete S.downloads[mid][cid];
      if (Object.keys(S.downloads[mid]).length === 0) delete S.downloads[mid];
      showToast('Chapter deleted');
      renderDownloads(main);
    });
  });
  main.querySelectorAll('[data-read-dl]').forEach(el => {
    el.addEventListener('click', () => {
      const [mid, cid] = el.dataset.readDl.split('|');
      readDownloadedChapter(mid, cid);
    });
  });
}

// ── READER ────────────────────────────────────────────────────────
// Stores loaded pages (b64 strings) for current chapter
const readerState = {
  pages: [],
  urls: [],
  loaded: new Set(),
  total: 0,
  currentPage: 0,
  isOffline: false,
  pageWidth: '800',
  mode: 'single',
  direction: 'ltr',
  zoom: 100,
  fitMode: 'width', // 'width', 'height', 'screen', 'original'
  touchStartX: 0,
  touchStartY: 0,
  isZoomed: false
};

async function openReader(chIdx) {
  S.currentChIdx = chIdx;
  const ch = S.chapters[chIdx];
  if (!ch) return;

  const readerView  = document.getElementById('readerView');
  const readerPages = document.getElementById('readerPages');
  const readerLoading = document.getElementById('readerLoading');
  const loadingText   = document.getElementById('readerLoadingText');
  const loadingBar    = document.getElementById('readerLoadingBar');

  readerView.classList.add('active');
  // Ensure the top bar is visible when opening the reader
  document.getElementById('readerToolbar').classList.remove('hidden');
  readerPages.innerHTML = '';
  readerLoading.style.display = 'flex';
  if (loadingBar) loadingBar.style.width = '0%';
  loadingText.textContent = 'Fetching chapter...';

  const num    = ch.attributes.chapter || '?';
  const ctitle = ch.attributes.title   || '';
  document.getElementById('readerTitle').textContent = `Chapter ${num}${ctitle ? ' — ' + ctitle : ''}`;
  document.getElementById('readerMangaTitle').textContent = S.manga ? title(S.manga) : '';
  document.getElementById('pageCount').textContent = '';

  // Update Sidebar Info
  const sidebarTitle = document.getElementById('sidebarMangaTitle');
  const sidebarCover = document.getElementById('sidebarCoverWrap');
  const sidebarChInfo = document.getElementById('sidebarChapterInfo');
  if (sidebarTitle) {
    sidebarTitle.textContent = S.manga ? title(S.manga) : 'Unknown Manga';
    sidebarTitle.style.cssText = 'overflow-wrap: anywhere; word-break: break-word; max-width: 100%; font-size: 14px;';
  }
  if (sidebarCover) {
    const url = coverUrl(S.manga);
    sidebarCover.innerHTML = url ? `<img src="${url}" style="width:100%; max-height: 260px; border-radius:8px; box-shadow: 0 4px 20px rgba(0,0,0,0.6); aspect-ratio: 2/3; object-fit: cover;">` : '<div class="manga-cover-ph">📖</div>';
  }
  if (sidebarChInfo) {
    sidebarChInfo.innerHTML = `
      <div style="font-family:var(--font-head); font-weight:900; color:var(--accent); font-size:15px; margin-bottom:2px; line-height:1.2; overflow-wrap: anywhere; word-break: break-word; width: 100%;">Chapter ${num}</div>
      <div style="font-size:11px; color:var(--text2); line-height:1.3; margin-bottom:10px; font-weight:500; overflow-wrap: anywhere; word-break: break-word; width: 100%;">${ctitle || 'No chapter title'}</div>
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        <span class="chip chip-blue" style="text-transform:capitalize">${S.manga?.attributes?.status || 'Ongoing'}</span>
        <span class="chip chip-gray">${S.manga?.attributes?.contentRating || 'safe'}</span>
        ${(S.manga?.attributes?.tags || []).slice(0, 3).map(t => `<span class="chip chip-gray" style="font-size:9px">${t.attributes.name.en}</span>`).join('')}
      </div>
    `;
  }

  // Populate chapter select
  const chSel = document.getElementById('chapterSelect');
  chSel.innerHTML = S.chapters.map((c, i) => {
    const n = c.attributes.chapter || '?';
    const t2 = c.attributes.title ? ` — ${c.attributes.title}` : '';
    return `<option value="${i}" ${i === chIdx ? 'selected' : ''}>Chapter ${n}${t2}</option>`;
  }).join('');

  // Reset page select
  document.getElementById('pageSelect').innerHTML = '<option>—</option>';

  const mid = S.manga?.id;
  const dlChapter = S.downloads[mid]?.[ch.id];

  readerState.pages   = [];
  readerState.loaded  = new Set();
  readerState.total   = 0;
  readerState.isOffline = !!dlChapter;
  readerState.mode = 'single';
  readerState.direction = S.db.settings?.defaultDirection || document.getElementById('readerDirectionSelect').value || 'ltr';
  // Sync UI selects to defaults
  document.getElementById('readingModeSelect').value = readerState.mode;
  document.getElementById('readerDirectionSelect').value = readerState.direction;

  // Restore reading position
  const savedPos = Number(S.db.history?.[mid]?.[ch.id] ?? 0);
  readerState.currentPage = Number.isFinite(savedPos) ? savedPos : 0;

  try {
    if (dlChapter) {
      const filePaths = Array.isArray(dlChapter.pages) ? dlChapter.pages : [];
      readerState.currentPage = Math.max(0, Math.min(readerState.currentPage, filePaths.length - 1));
      await loadOfflineChapterPages(filePaths, readerPages, readerLoading, loadingText, loadingBar);
    } else {
      const res = await api.mdexFetch(`/at-home/server/${ch.id}`);
      const base = res.baseUrl;
      const hash = res.chapter.hash;
      const pageUrls = res.chapter.data.map(p => `${base}/data/${hash}/${p}`);
      readerState.currentPage = Math.max(0, Math.min(readerState.currentPage, pageUrls.length - 1));
      await loadOnlineChapterPages(pageUrls, readerPages, readerLoading, loadingText, loadingBar);
    }

    // Render all pages
    readerLoading.style.display = 'none';
    renderAllPages(readerPages);
    readerPages.scrollTop = 0;

    document.getElementById('pageCount').textContent = `${readerState.total} pages`;
    updateReaderUI();

    markRead(ch.id);

    // Keyboard nav
    document.addEventListener('keydown', readerKeyHandler);
  } catch (e) {
    readerLoading.style.display = 'none';
    readerPages.innerHTML = `<div style="padding:60px;color:var(--accent);font-family:var(--font-mono);font-size:12px;text-align:center">⚠ Failed to load pages<br>${e.message}</div>`;
  }
}

function renderTargetPage(readerPages, readerLoading) {
  const src = readerState.pages[readerState.currentPage];
  if (!src) return;
  readerLoading.style.display = 'none';
  if (readerState.mode === 'single') renderAllPages(readerPages);
  // In scroll mode we wait for full render or background filling
}

function renderAllPages(readerPages) {
  const pw = readerState.pageWidth || '800';
  const maxW = pw === '9999' ? '100%' : pw + 'px';
  const styleStr = getPageStyleString();
  
  // Apply Mode
  readerPages.classList.toggle('mode-single', readerState.mode === 'single');
  
  const src = readerState.pages[readerState.currentPage];
  readerPages.innerHTML = src
    ? `<img class="reader-page active" src="${src}" data-page="${readerState.currentPage}" style="${styleStr}; transition: opacity 0.2s ease-in-out;" onwheel="handleReaderWheel(event)" ontouchstart="handleTouchStart(event)" ontouchend="handleTouchEnd(event)" onmousedown="handleMouseDown(event)">`
    : `<div class="reader-page-ph">Loading page ${readerState.currentPage + 1}...</div>`;
  
  // Preload next pages with direction awareness
  preloadNextPages();

  document.getElementById('pageCount').textContent = `${readerState.total} pages`;
  const pageSel = document.getElementById('pageSelect');
  pageSel.innerHTML = readerState.pages.map((_, i) =>
    `<option value="${i}" ${i === readerState.currentPage ? 'selected' : ''}>Page ${i + 1}</option>`
  ).join('');
}

async function preloadNextPages() {
  if (readerState.isOffline) return;
  
  // Direction-aware preloading
  const isRTL = readerState.direction === 'rtl';
  const lookahead = 3;
  
  // Preload in the direction the user is reading
  let rangesToPreload = [];
  if (isRTL) {
    // RTL: preload backwards
    const start = Math.max(0, readerState.currentPage - 1);
    const end = Math.max(0, readerState.currentPage - lookahead);
    for (let i = start; i >= end; i--) rangesToPreload.push(i);
  } else {
    // LTR: preload forwards
    const start = readerState.currentPage + 1;
    const end = Math.min(readerState.total, start + lookahead);
    for (let i = start; i < end; i++) rangesToPreload.push(i);
  }
  
  for (const i of rangesToPreload) {
    if ((!readerState.loaded.has(i) || !readerState.pages[i]) && readerState.urls[i]) {
      try {
        const b64 = await api.fetchImage(readerState.urls[i]);
        readerState.pages[i] = b64;
        readerState.loaded.add(i);
      } catch {}
    }
  }
}

function turnPage(dir) {
  // Adjust dir for RTL
  const actualDir = readerState.direction === 'rtl' ? -dir : dir;

  // Briefly show the toolbar when turning pages so you can see progress
  const toolbar = document.getElementById('readerToolbar');
  toolbar.classList.remove('hidden');
  resetReaderTimer();

  const nextIdx = readerState.currentPage + actualDir;
  if (nextIdx >= 0 && nextIdx < readerState.total) {
    readerState.currentPage = nextIdx;
    renderAllPages(document.getElementById('readerPages'));
    updateReaderUI();
    saveReadingPosition();
  } else if (nextIdx >= readerState.total) {
    shiftChapter(1);
  } else if (nextIdx < 0) {
    shiftChapter(-1);
  }
}

function saveReadingPosition() {
  const mid = S.manga?.id;
  const chId = S.chapters[S.currentChIdx]?.id;
  if (!mid || !chId) return;
  if (!S.db.history[mid]) S.db.history[mid] = {};
  S.db.history[mid][chId] = readerState.currentPage;
  api.dbSave(S.db);
}

function updateReaderUI() {
  document.getElementById('pageSelect').value = readerState.currentPage;
  const pct = Math.round(((readerState.currentPage + 1) / readerState.total) * 100);
  document.getElementById('pageCount').textContent = `Page ${readerState.currentPage + 1} / ${readerState.total} (${pct}%)`;
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
}

function readerKeyHandler(e) {
  const readerView = document.getElementById('readerView');
  if (!readerView.classList.contains('active')) {
    document.removeEventListener('keydown', readerKeyHandler);
    return;
  }
  switch (e.key) {
    case 'Escape':     closeReader(); break;
    case 'f':
    case 'F':          toggleFullscreen(); e.preventDefault(); break;
    case 'h':
    case 'H':          toggleReaderUI(); break;
    case 'd':
    case 'D':          toggleReadingDirection(); break;
    case 'ArrowRight':
    case 'ArrowDown':  turnPage(1); break;
    case 'ArrowLeft': 
    case 'ArrowUp':    turnPage(-1); break;
    case ' ':          turnPage(1); e.preventDefault(); break;
    case 'Home':       jumpToPage(0); e.preventDefault(); break;
    case 'End':        jumpToPage(readerState.total - 1); e.preventDefault(); break;
    case 'PageUp':     turnPage(-5); e.preventDefault(); break;
    case 'PageDown':   turnPage(5); e.preventDefault(); break;
    case '+':
    case '=':          zoomIn(); e.preventDefault(); break;
    case '-':
    case '_':          zoomOut(); e.preventDefault(); break;
    case '0':          resetZoom(); e.preventDefault(); break;
    case '[': shiftChapter(-1); break;
    case ']': shiftChapter(1);  break;
  }
}

function toggleReaderUI() {
  document.getElementById('readerToolbar').classList.toggle('hidden');
  document.getElementById('readerPanel').classList.toggle('hidden-panel');
}

function toggleReadingDirection() {
  const sel = document.getElementById('readerDirectionSelect');
  sel.value = sel.value === 'ltr' ? 'rtl' : 'ltr';
  sel.dispatchEvent(new Event('change'));
}

// ── READER ZOOM & GESTURE HANDLING ────────────────────────────────
function getPageStyleString() {
  let style = '';
  const pw = readerState.pageWidth || '800';
  const maxW = pw === '9999' ? '100%' : pw + 'px';
  
  // Apply zoom
  const scale = readerState.zoom / 100;
  style += `max-width: ${maxW}; transform: scale(${scale});`;
  
  // Apply fit mode styling
  if (readerState.fitMode === 'height') {
    style += ` max-height: 100vh; object-fit: contain;`;
  } else if (readerState.fitMode === 'screen') {
    style += ` max-height: 100vh; max-width: 100%; object-fit: contain;`;
  }
  
  return style;
}

function zoomIn() {
  const newZoom = Math.min(readerState.zoom + 10, 300);
  if (newZoom !== readerState.zoom) {
    readerState.zoom = newZoom;
    readerState.isZoomed = readerState.zoom !== 100;
    renderAllPages(document.getElementById('readerPages'));
    showToast(`Zoom: ${readerState.zoom}%`);
  }
}

function zoomOut() {
  const newZoom = Math.max(readerState.zoom - 10, 50);
  if (newZoom !== readerState.zoom) {
    readerState.zoom = newZoom;
    readerState.isZoomed = readerState.zoom !== 100;
    renderAllPages(document.getElementById('readerPages'));
    showToast(`Zoom: ${readerState.zoom}%`);
  }
}

function resetZoom() {
  if (readerState.zoom !== 100) {
    readerState.zoom = 100;
    readerState.isZoomed = false;
    renderAllPages(document.getElementById('readerPages'));
    showToast('Zoom: 100%');
  }
}

function handleReaderWheel(e) {
  if (readerState.mode !== 'single') return; // Allow natural scroll in scroll mode
  
  // Zoom with Ctrl+Wheel
  if (e.ctrlKey) {
    e.preventDefault();
    e.deltaY > 0 ? zoomOut() : zoomIn();
  }
  // Turn pages with wheel
  else if (!readerState.isZoomed) {
    e.preventDefault();
    turnPage(e.deltaY > 0 ? 1 : -1);
  }
}

function handleTouchStart(e) {
  readerState.touchStartX = e.touches[0].clientX;
  readerState.touchStartY = e.touches[0].clientY;
}

function handleTouchEnd(e) {
  if (readerState.mode !== 'single') return; // Gesture nav in single mode only
  
  const touchEndX = e.changedTouches[0].clientX;
  const touchEndY = e.changedTouches[0].clientY;
  const diffX = readerState.touchStartX - touchEndX;
  const diffY = Math.abs(readerState.touchStartY - touchEndY);
  
  // Horizontal swipe (min 50px)
  if (Math.abs(diffX) > 50 && diffY < 100) {
    if (diffX > 0) turnPage(1);  // Swipe left = next page
    else turnPage(-1);            // Swipe right = prev page
  }
}

function handleMouseDown(e) {
  // Two-finger pinch zoom detection via mouse would be complex
  // Keeping this for future pinch zoom on touch devices via Hammer.js if needed
}

async function readDownloadedChapter(mid, chId) {
  const dlCh = S.downloads[mid]?.[chId];
  if (!dlCh) return;

  // Build a minimal chapter entry so openReader can work
  // We store the chapter in a temporary slot
  S.currentChIdx = -1;  // won't navigate chapters
  const fakeChapters = S.chapters;
  S.chapters = [];  // blank so shiftChapter is a no-op

  const readerView    = document.getElementById('readerView');
  const readerPages   = document.getElementById('readerPages');
  const readerLoading = document.getElementById('readerLoading');
  const loadingText   = document.getElementById('readerLoadingText');
  const loadingBar    = document.getElementById('readerLoadingBar');
  const readerPagesEl = document.getElementById('readerPages');
  const toolbar       = document.getElementById('readerToolbar');

  readerView.classList.add('active');
  toolbar.classList.remove('hidden');
  readerPages.innerHTML = '';
  readerLoading.style.display = 'flex';
  if (loadingBar) loadingBar.style.width = '0%';
  document.getElementById('readerTitle').textContent = `Ch. ${dlCh.chapter || '?'} (Offline)`;
  document.getElementById('readerMangaTitle').textContent = S.db.library[mid]?.title || 'Downloaded Manga';

  // Update Sidebar Info (Offline)
  const sidebarTitle = document.getElementById('sidebarMangaTitle');
  const sidebarCover = document.getElementById('sidebarCoverWrap');
  const sidebarChInfo = document.getElementById('sidebarChapterInfo');
  const meta = S.db.library[mid];

  if (sidebarTitle) {
    sidebarTitle.textContent = meta?.title || 'Downloaded Manga';
    sidebarTitle.style.cssText = 'overflow-wrap: anywhere; word-break: break-word; max-width: 100%; font-size: 14px;';
  }
  if (sidebarCover) {
    const url = meta?.cover || null;
    sidebarCover.innerHTML = url ? `<img src="${url}" style="width:100%; max-height: 260px; border-radius:8px; box-shadow: 0 4px 20px rgba(0,0,0,0.6); aspect-ratio: 2/3; object-fit: cover;">` : '📖';
  }
  if (sidebarChInfo) {
    sidebarChInfo.innerHTML = `
      <div style="font-family:var(--font-head); font-weight:900; color:var(--accent); font-size:15px; margin-bottom:2px; line-height:1.2; overflow-wrap: anywhere; word-break: break-word; width: 100%;">Chapter ${dlCh.chapter || '?'}</div>
      <div style="font-size:11px; color:var(--text2); line-height:1.3; margin-bottom:10px; font-weight:500; overflow-wrap: anywhere; word-break: break-word; width: 100%;">${dlCh.title || 'Offline Content'}</div>
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        <span class="chip chip-green">Downloaded</span>
        <span class="chip chip-gray" style="text-transform:capitalize">${meta?.status || 'Ongoing'}</span>
      </div>
    `;
  }

  document.getElementById('pageCount').textContent = '';

  readerState.pages  = new Array(dlCh.pages.length).fill(null);
  readerState.total  = dlCh.pages.length;

  const savedPos = S.db.history?.[mid]?.[chId] || 0;
  readerState.currentPage = savedPos;

  readerState.loaded = new Set();
  readerState.isOffline = true;
  readerState.mode = 'single';
  readerState.direction = document.getElementById('readerDirectionSelect').value || 'ltr';

  try {
    let loadedCount = 0;
    const CONCURRENCY = 6;
    let idx = 0;
    async function worker() {
      while (idx < dlCh.pages.length) {
        const i = idx++;
        try {
          const b64 = await api.readPage(dlCh.pages[i]);
          readerState.pages[i] = b64;
          readerState.loaded.add(i);
          loadedCount++;
          const pct = Math.round(loadedCount / dlCh.pages.length * 100);
          if (loadingBar) loadingBar.style.width = pct + '%';
          loadingText.textContent = `Loading page ${loadedCount}/${dlCh.pages.length}...`;
          if (i === readerState.currentPage) renderTargetPage(readerPagesEl, readerLoading);
        } catch (e) {
          readerState.pages[i] = null;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, dlCh.pages.length) }, worker));
    
    readerLoading.style.display = 'none';
    renderAllPages(readerPagesEl);
    readerPages.scrollTop = 0;
    updateReaderUI();
    markRead(chId);
    document.addEventListener('keydown', readerKeyHandler);
  } catch (e) {
    readerLoading.style.display = 'none';
    readerPages.innerHTML = `<div style="padding:60px;color:var(--accent);font-family:var(--font-mono)">⚠ ${e.message}</div>`;
  }

  S.chapters = fakeChapters;
}

function jumpToPage(idx) {
  readerState.currentPage = Math.max(0, Math.min(idx, readerState.total - 1));
  // Ensure toolbar is visible on jump
  document.getElementById('readerToolbar').classList.remove('hidden');
  resetReaderTimer();
  renderAllPages(document.getElementById('readerPages'));
  updateReaderUI();
  saveReadingPosition();
}

function closeReader() {
  document.getElementById('readerView').classList.remove('active');
  document.removeEventListener('keydown', readerKeyHandler);
}

function shiftChapter(delta) {
  const newIdx = S.currentChIdx + delta;
  if (newIdx >= 0 && newIdx < S.chapters.length) openReader(newIdx);
}

function toggleReaderToolbar() {
  const tb = document.getElementById('readerToolbar');
  tb.classList.toggle('hidden');
}

function markRead(chId) {
  const mid = S.manga?.id;
  if (!mid) return;
  if (!S.db.progress[mid]) S.db.progress[mid] = [];
  if (!S.db.progress[mid].includes(chId)) S.db.progress[mid].push(chId);
  S.db.history.lastMangaId = mid;
  if (!S.db.history.recent) S.db.history.recent = [];
  const titleText = S.manga ? title(S.manga) : S.db.library[mid]?.title || 'Downloaded Manga';
  const historyEntry = { id: mid, title: titleText, cover: coverUrl(S.manga) || S.db.library[mid]?.cover, attributes: { status: S.manga?.attributes?.status || S.db.library[mid]?.status } };
  S.db.history.recent = [historyEntry, ...S.db.history.recent.filter(item => item.id !== mid)].slice(0, 24);
  api.dbSave(S.db);
}

// ── DOWNLOADS ─────────────────────────────────────────────────────
async function downloadChapter(chIdx) {
  const ch = S.chapters[chIdx];
  const mid = S.manga?.id;
  if (!ch || !mid) return;
  if (S.downloads[mid]?.[ch.id]) { showToast('Already downloaded'); return; }
  if (S.dlInProgress.has(ch.id)) { showToast('Download in progress...'); return; }

  S.dlInProgress.add(ch.id);
  // Re-render row to show progress
  const rowEl = document.querySelector(`[data-ch-id="${ch.id}"]`);
  if (rowEl) {
    const dlBtn = rowEl.querySelector('.ch-dl-btn');
    if (dlBtn) { dlBtn.classList.add('downloading'); dlBtn.textContent = '↻'; }
    // Insert progress bar after row
    const progressHtml = `<div class="dl-progress-bar-wrap" id="dl-overlay-${ch.id}">
      <div class="dl-progress-label">Fetching page list...</div>
      <div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div>
    </div>`;
    rowEl.insertAdjacentHTML('afterend', progressHtml);
  }

  try {
    const res = await api.mdexFetch(`/at-home/server/${ch.id}`);
    const base = res.baseUrl;
    const hash = res.chapter.hash;
    const pageUrls = res.chapter.data.map(p => `${base}/data/${hash}/${p}`);

    const meta = {
      chapter: ch.attributes.chapter || '?',
      title: ch.attributes.title || '',
      pages: pageUrls.length,
    };

    const result = await api.downloadChapter(mid, ch.id, meta, pageUrls);

    // Update state
    if (!S.downloads[mid]) S.downloads[mid] = {};
    S.downloads[mid][ch.id] = { ...meta, pages: result.pages, downloadedAt: Date.now() };

    // Save manga meta to library
    if (!S.db.library[mid]) {
      S.db.library[mid] = { id: mid, title: title(S.manga), cover: coverUrl(S.manga), status: S.manga.attributes?.status };
      api.dbSave(S.db);
    }

    S.dlInProgress.delete(ch.id);
    showToast(`✓ Chapter ${meta.chapter} downloaded (${result.pages.length} pages)`);

    // Update UI
    document.getElementById(`dl-overlay-${ch.id}`)?.remove();
    if (rowEl) {
      const dlBtn = rowEl.querySelector('.ch-dl-btn');
      if (dlBtn) { dlBtn.classList.remove('downloading'); dlBtn.classList.add('downloaded'); dlBtn.textContent = '✓'; }
      rowEl.insertAdjacentHTML('beforeend', ' <span class="chip chip-green">Saved</span>');
    }
  } catch (e) {
    S.dlInProgress.delete(ch.id);
    document.getElementById(`dl-overlay-${ch.id}`)?.remove();
    if (rowEl) {
      const dlBtn = rowEl.querySelector('.ch-dl-btn');
      if (dlBtn) { dlBtn.classList.remove('downloading'); dlBtn.textContent = '↓'; }
    }
    showToast('⚠ Download failed: ' + e.message, true);
  }
}

async function downloadAll() {
  if (!S.chapters.length) return;
  const mid = S.manga?.id;
  let count = 0;
  for (let i = 0; i < S.chapters.length; i++) {
    const ch = S.chapters[i];
    if (S.downloads[mid]?.[ch.id]) continue;
    await downloadChapter(i);
    count++;
    await sleep(600);
  }
  showToast(`✓ Downloaded ${count} new chapters`);
}

// ── UTILS ─────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let toastTimer;
function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '') + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

function showWhatsNew(version) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.85); backdrop-filter: blur(10px);
    display: flex; align-items: center; justify-content: center;
    z-index: 10000; opacity: 0; transition: opacity 0.3s ease;
  `;

  overlay.innerHTML = `
    <div class="modal-content" style="
      background: var(--bg2); border: 1px solid var(--glass-border);
      border-radius: 16px; padding: 32px; width: 450px; max-width: 90%;
      box-shadow: 0 20px 50px rgba(0,0,0,0.5); transform: translateY(20px);
      transition: transform 0.3s ease;
    ">
      <div style="font-family:var(--font-head); font-weight:900; font-size:24px; margin-bottom:8px; color:var(--accent);">What's New in v${version}</div>
      <div style="font-size:13px; color:var(--text2); margin-bottom:24px;">Welcome back! Here is what we've improved in this update.</div>
      
      <ul style="list-style:none; padding:0; margin:0 0 32px 0; display:flex; flex-direction:column; gap:16px;">
        <li style="display:flex; gap:12px;">
          <span style="font-size:20px;">🎨</span>
          <div>
            <div style="font-weight:bold; font-size:14px;">Accent Colors</div>
            <div style="font-size:12px; color:var(--text2);">Personalize Inkflow with your choice of theme colors in Settings.</div>
          </div>
        </li>
        <li style="display:flex; gap:12px;">
          <span style="font-size:20px;">🔍</span>
          <div>
            <div style="font-weight:bold; font-size:14px;">Library Search</div>
            <div style="font-size:12px; color:var(--text2);">New search bar in Library view makes finding series a breeze.</div>
          </div>
        </li>
        <li style="display:flex; gap:12px;">
          <span style="font-size:20px;">⚡</span>
          <div>
            <div style="font-weight:bold; font-size:14px;">Performance Refinement</div>
            <div style="font-size:12px; color:var(--text2);">Refactored UI components for snappier filtering and smoother navigation.</div>
          </div>
        </li>
        <li style="display:flex; gap:12px;">
          <span style="font-size:20px;">🛡️</span>
          <div>
            <div style="font-weight:bold; font-size:14px;">Security & Stability</div>
            <div style="font-size:12px; color:var(--text2);">Hardened API handlers and removed legacy code to ensure a crash-free experience.</div>
          </div>
        </li>
      </ul>

      <button class="btn btn-primary" id="closeWhatsNew" style="width:100%; padding:12px;">Awesome, let's go!</button>
    </div>
  `;

  document.body.appendChild(overlay);
  setTimeout(() => {
    overlay.style.opacity = '1';
    overlay.querySelector('.modal-content').style.transform = 'translateY(0)';
  }, 10);

  document.getElementById('closeWhatsNew').onclick = () => {
    overlay.style.opacity = '0';
    overlay.querySelector('.modal-content').style.transform = 'translateY(20px)';
    setTimeout(() => overlay.remove(), 300);
  };
}

// ── Boot ──────────────────────────────────────────────────────────
init();
