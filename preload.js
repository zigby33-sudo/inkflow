const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // API proxies (all run in Node.js, bypassing CORS)
  mdexFetch: (path, params) => ipcRenderer.invoke('mdex-fetch', path, params),
  jikanFetch: (path) => ipcRenderer.invoke('jikan-fetch', path),
  mplusFetch: (path, params) => ipcRenderer.invoke('mplus-fetch', path, params),
  comickFetch: (path, params) => ipcRenderer.invoke('comick-fetch', path, params),
  fetchImage: (url) => ipcRenderer.invoke('fetch-image', url),
  fetchImagesBatch: (urls, concurrency) => ipcRenderer.invoke('fetch-images-batch', urls, concurrency),

  // Downloads
  downloadChapter: (mangaId, chapterId, meta, pageUrls) =>
    ipcRenderer.invoke('download-chapter', mangaId, chapterId, meta, pageUrls),
  getDownloads: () => ipcRenderer.invoke('get-downloads'),
  readPage: (filePath) => ipcRenderer.invoke('read-page', filePath),
  deleteDownload: (mangaId, chapterId) => ipcRenderer.invoke('delete-download', mangaId, chapterId),
  onDownloadProgress: (cb) => {
    const listener = (_, data) => cb(data);
    ipcRenderer.on('download-progress', listener);
    return () => ipcRenderer.removeListener('download-progress', listener);
  },
  onBatchImageProgress: (cb) => {
    const listener = (_, data) => cb(data);
    ipcRenderer.on('batch-image-progress', listener);
    return () => ipcRenderer.removeListener('batch-image-progress', listener);
  },
  clearCache: () => ipcRenderer.invoke('clear-cache'),

  // Database (library, progress, settings)
  dbGet: () => ipcRenderer.invoke('db-get'),
  dbSave: (db) => ipcRenderer.invoke('db-save', db),
  dbClear: () => ipcRenderer.invoke('db-clear'),
  settingsGet: () => ipcRenderer.invoke('settings-get'),
  settingsSave: (settings) => ipcRenderer.invoke('settings-save', settings),

  // Window controls
  winMinimize: () => ipcRenderer.send('window-minimize'),
  winMaximize: () => ipcRenderer.send('window-maximize'),
  winClose: () => ipcRenderer.send('window-close'),
  winIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onMaximizedChange: (cb) => {
    const listener = (_, isMax) => cb(isMax);
    ipcRenderer.on('window-maximized', listener);
    return () => ipcRenderer.removeListener('window-maximized', listener);
  },
  getTheme: () => ipcRenderer.invoke('get-theme'),
  onThemeChange: (cb) => {
    const listener = (_, theme) => cb(theme);
    ipcRenderer.on('theme-changed', listener);
    return () => ipcRenderer.removeListener('theme-changed', listener);
  },
});
