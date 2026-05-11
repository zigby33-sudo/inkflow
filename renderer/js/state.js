/** Shared UI + persisted session (db is loaded in init). */
export const api = window.electron;

export const S = {
  view: 'home',
  manga: null,
  chapters: [],
  currentChIdx: 0,
  db: { library: {}, progress: {}, history: {}, settings: {} },
  downloads: {},
  dlInProgress: new Set(),
  toolbarTimer: null,
  activeSource: 'mangadex',
  homeSort: 'followedCount',
  homeOffset: 0,
  updateProgress: null,
  libSearch: '',
  libSort: 'added',
  libFilter: 'all',
  version: '',
  searchQuery: '',
  lastView: 'home',
};

export const readerState = {
  pages: [],
  urls: [],
  loaded: new Set(),
  pending: new Set(),
  total: 0,
  currentPage: 0,
  isOffline: false,
  pageWidth: '800',
  mode: 'single',
  direction: 'ltr',
  imageQuality: 'original',
  preloadCount: 3,
  zoom: 100,
  fitMode: 'width',
  touchStartX: 0,
  touchStartY: 0,
  isZoomed: false,
};
