import { S, api } from './state.js';

export function title(m) {
  const t = m.attributes?.title;
  return t?.en || t?.['ja-ro'] || t?.ja || Object.values(t || {})[0] || 'Unknown Title';
}

export function author(m) {
  return m.relationships?.find((r) => r.type === 'author')?.attributes?.name || '';
}

export function coverUrl(m) {
  const rel = m.relationships?.find((r) => r.type === 'cover_art');
  if (!rel?.attributes?.fileName) return null;
  return `https://uploads.mangadex.org/covers/${m.id}/${rel.attributes.fileName}.256.jpg`;
}

export function loading(msg = 'Loading...') {
  return `<div class="loading"><div class="spinner"></div>${msg}</div>`;
}

export function err(msg, retryFn = null) {
  const retryId = retryFn ? 'retry-' + Date.now() : null;
  const retryBtn = retryFn
    ? `<button id="${retryId}" class="btn btn-outline" style="margin-top:12px;font-size:11px;">↺ Retry</button>`
    : '';
  const html = `<div class="loading" style="flex-direction:column;gap:8px;"><span style="color:var(--accent)">⚠ ${msg}</span>${retryBtn}</div>`;
  if (retryFn) {
    setTimeout(() => {
      document.getElementById(retryId)?.addEventListener('click', retryFn);
    }, 50);
  }
  return html;
}

export async function loadImagesViaIPC(imgEls) {
  for (const img of imgEls) {
    const src = img.dataset.src;
    if (!src) continue;
    try {
      img.src = await api.fetchImage(src);
    } catch {
      img.alt = '⚠';
    }
  }
}

export function makeCoverImg(url, cls = 'manga-cover') {
  if (!url) return `<div class="${cls.includes('detail') ? 'detail-cover-ph' : 'manga-cover-ph'}">📖</div>`;
  return `<img class="${cls}" src="${url}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'manga-cover-ph',textContent:'📖'}))">`;
}

export function sourceDesc(id) {
  const descs = {
    mangadex: 'The largest free manga platform. Browse, read, and download thousands of titles.',
    mal: 'MyAnimeList scores, rankings and metadata for manga detail pages.',
    mangaplus: 'Official publisher. Browse trending Shonen/Seinen series.',
    comick: 'High-quality comic aggregator with wide library coverage.',
  };
  return descs[id] || '';
}

export function mangaCard(m) {
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
