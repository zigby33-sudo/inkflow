const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  mdexFetch: (path, params) => ipcRenderer.invoke('mdex-fetch', path, params),
  jikanFetch: (path) => ipcRenderer.invoke('jikan-fetch', path),
  mplusFetch: (path, params) => ipcRenderer.invoke('mplus-fetch', path, params),
  comickFetch: (path, params) => ipcRenderer.invoke('comick-fetch', path, params),
  fetchImage: (url) => ipcRenderer.invoke('fetch-image', url),
  fetchImagesBatch: (urls, concurrency) => ipcRenderer.invoke('fetch-images-batch', urls, concurrency),

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
  openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),

  dbGet: () => ipcRenderer.invoke('db-get'),
  dbSave: (db) => ipcRenderer.invoke('db-save', db),
  dbClear: () => ipcRenderer.invoke('db-clear'),
  settingsGet: () => ipcRenderer.invoke('settings-get'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  settingsSave: (settings) => ipcRenderer.invoke('settings-save', settings),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  launchUpdater: (info) => ipcRenderer.invoke('launch-updater', info),
  onUpdateStatus: (cb) => {
    const listener = (_, msg) => cb(msg);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  },
  onUpdateProgress: (cb) => {
    const listener = (_, data) => cb(data);
    ipcRenderer.on('update-progress', listener);
    return () => ipcRenderer.removeListener('update-progress', listener);
  },
  onUpdateAvailable: (cb) => {
    const listener = (_, data) => cb(data);
    ipcRenderer.on('update-available', listener);
    return () => ipcRenderer.removeListener('update-available', listener);
  },
  onDbClearRequest: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('show-db-clear-confirmation', listener);
    return () => ipcRenderer.removeListener('show-db-clear-confirmation', listener);
  },

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
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  requestDbClear: () => ipcRenderer.send('request-db-clear'),
});
