import { S } from './state.js';

const views = {
  renderBrowse: null,
  renderSearch: null,
  renderDetail: null,
  renderLibrary: null,
  renderHistory: null,
  renderDownloads: null,
  renderSettings: null,
};

export function registerViews(handlers) {
  Object.assign(views, handlers);
}

export function navigate(view) {
  S.lastView = S.view;
  S.view = view;
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  const navKey = view === 'detail' ? 'home' : view;
  const nb = document.querySelector(`.nav-btn[data-view="${navKey}"]`);
  if (nb) nb.classList.add('active');
  document.getElementById('mainContent').scrollTo(0, 0);
  render();
}

export function render() {
  const main = document.getElementById('mainContent');
  const { renderBrowse, renderSearch, renderDetail, renderLibrary, renderHistory, renderDownloads, renderSettings } = views;
  switch (S.view) {
    case 'home':
      renderBrowse(main);
      break;
    case 'search':
      renderSearch(main);
      break;
    case 'detail':
      renderDetail(main);
      break;
    case 'library':
      renderLibrary(main);
      break;
    case 'history':
      renderHistory(main);
      break;
    case 'downloads':
      renderDownloads(main);
      break;
    case 'settings':
      renderSettings(main);
      break;
    default:
      renderBrowse(main);
  }
}
