import { S } from './state.js';
import { CHANGELOG } from './config.js';

export function applyFonts() {
  if (document.getElementById('inkflow-fonts')) return;
  const style = document.createElement('style');
  style.id = 'inkflow-fonts';
  style.textContent = `
    :root {
      --font-head: "Inter Display", "Segoe UI Variable Display", sans-serif;
      --font-body: "Inter", system-ui, sans-serif;
      --font-mono: "JetBrains Mono", monospace;
      --radius-lg: 24px;
      --radius-md: 16px;
      --radius-sm: 10px;
      --shadow-soft: 0 10px 40px -10px rgba(0,0,0,0.4);
      --transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    body {
      font-family: var(--font-body);
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
      background: #0a0a0a;
      color: #e0e0e0;
      letter-spacing: -0.01em;
    }
    #mainContent { padding: 30px 40px; }
    .section-title { font-family: var(--font-head); font-weight: 900; font-size: 28px; letter-spacing: -0.5px; margin-bottom: 25px; display: flex; align-items: center; gap: 12px; }
    .section-title .ic { font-size: 24px; color: var(--accent); }
    .manga-card {
      background: var(--bg2);
      border-radius: var(--radius-md);
      border: 1px solid var(--glass-border);
      padding: 12px;
      transition: all var(--transition);
      cursor: pointer;
      position: relative;
    }
    .manga-card:hover {
      transform: translateY(-8px) scale(1.02);
      border-color: var(--accent);
      box-shadow: var(--shadow-soft);
      background: var(--bg3);
    }
    .manga-cover-wrap { border-radius: var(--radius-sm); overflow: hidden; margin-bottom: 12px; }
    .manga-cover { aspect-ratio: 2/3; object-fit: cover; width: 100%; transition: transform 0.6s ease; }
    .manga-card:hover .manga-cover { transform: scale(1.05); }
    .btn {
      padding: 10px 20px;
      border-radius: var(--radius-sm);
      font-weight: 700;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.5px;
      transition: all var(--transition);
      border: 1px solid transparent;
    }
    .btn-primary { background: var(--accent); color: #fff; box-shadow: 0 4px 15px -5px var(--accent); }
    .btn-primary:hover { filter: brightness(1.2); box-shadow: 0 8px 25px -5px var(--accent); transform: translateY(-1px); }
    .genre-chip { padding: 8px 18px; border-radius: var(--radius-lg); font-size: 12px; font-weight: 600; background: var(--bg2); border: 1px solid var(--glass-border); transition: all var(--transition); }
    .genre-chip:hover { border-color: var(--accent); color: var(--text1); }
    .genre-chip.active { background: var(--accent); border-color: var(--accent); color: #fff; }
    .hero-continue { padding: 30px; background: linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01)); backdrop-filter: blur(10px); border-radius: var(--radius-lg); border: 1px solid var(--glass-border); margin-bottom: 40px; display: flex; align-items: center; gap: 25px; transition: border-color var(--transition); }
    .hero-continue:hover { border-color: var(--accent); }
    .hero-thumb { width: 100px; height: 140px; border-radius: var(--radius-sm); box-shadow: 0 8px 20px rgba(0,0,0,0.4); object-fit: cover; }
  `;
  document.head.appendChild(style);
}

export function applyAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
}

export function resetReaderTimer() {
  const toolbar = document.getElementById('readerToolbar');
  clearTimeout(S.toolbarTimer);
  S.toolbarTimer = setTimeout(() => {
    if (document.getElementById('readerPanel').classList.contains('hidden-panel')) {
      toolbar.classList.add('hidden');
    }
  }, 3500);
}

export function syncWinMaxButton(isMaximized) {
  const btn = document.getElementById('winMaxBtn');
  if (!btn) return;
  btn.title = isMaximized ? 'Restore' : 'Maximize';
  btn.textContent = isMaximized ? '❐' : '□';
}

let toastTimer;
export function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '') + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function showWhatsNew(version) {
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
        ${CHANGELOG.map(
          (item) => `
          <li style="display:flex; gap:12px;">
            <span style="font-size:20px;">${item.icon}</span>
            <div>
              <div style="font-weight:bold; font-size:14px;">${item.title}</div>
              <div style="font-size:12px; color:var(--text2);">${item.desc}</div>
            </div>
          </li>
        `,
        ).join('')}
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
