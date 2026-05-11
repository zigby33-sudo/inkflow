/* ── Inkflow Custom Modal System ───────────────────────────────── */

(function () {
  const overlay   = document.getElementById('inkModalOverlay');
  const modal     = document.getElementById('inkModal');
  const iconEl    = document.getElementById('inkModalIcon');
  const titleEl   = document.getElementById('inkModalTitle');
  const bodyEl    = document.getElementById('inkModalBody');
  const confirmBtn = document.getElementById('inkModalConfirm');
  const cancelBtn  = document.getElementById('inkModalCancel');

  let resolveCallback = null;

  function showModal(options = {}) {
    iconEl.textContent  = options.icon || '';
    iconEl.className    = 'ink-modal-icon ' + (options.iconClass || '') + ' redesigned-icon';
    iconEl.style.display = options.icon ? 'flex' : 'none';

    titleEl.textContent = options.title || '';
    bodyEl.innerHTML    = options.body  || '';

    confirmBtn.textContent = options.confirmText || 'Confirm';
    confirmBtn.className   = 'btn ink-modal-confirm ' +
      (options.destructive ? 'destructive' : 'btn-primary');

    cancelBtn.textContent  = options.cancelText || 'Cancel';
    cancelBtn.style.display = options.hideCancelBtn ? 'none' : '';

    overlay.classList.add('active');

    return new Promise((resolve) => {
      resolveCallback = resolve;
    });
  }

  function hideModal(result) {
    overlay.classList.remove('active');
    if (resolveCallback) {
      resolveCallback(result);
      resolveCallback = null;
    }
  }

  confirmBtn.addEventListener('click', () => hideModal(true));
  cancelBtn.addEventListener('click',  () => hideModal(false));

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hideModal(false);
  });

  document.addEventListener('keydown', (e) => {
    if (!overlay.classList.contains('active')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hideModal(false);
    } else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      e.stopPropagation();
      hideModal(true);
    }
  });

  window.inkModal = showModal;


  if (window.electron?.onUpdateAvailable) {
    window.electron.onUpdateAvailable((info) => {
      showModal({
        icon: '⬆',
        iconClass: 'update',
        title: 'Update Available',
        body: `
          <p>A new version of Inkflow is available: <strong>v${info.latest}</strong></p>
          <p><small>You are on v${info.current}</small></p>
          ${info.notes ? `<div class="release-notes">${info.notes}</div>` : ''}
        `,
        confirmText: 'Download Update',
        cancelText: 'Not Now',
      }).then((confirmed) => {
        if (confirmed) {
          if (info.downloadUrl) {
            window.electron.launchUpdater({ url: info.downloadUrl, assetName: info.assetName });
          } else {
            window.electron.openExternal(info.url);
          }
        }
      });
    });
  }


  if (window.electron?.onDbClearRequest) {
    window.electron.onDbClearRequest(() => {
      showModal({
        icon: '🗑',
        iconClass: 'danger',
        title: 'Clear History & Library?',
        body: `
          <p>This will permanently delete all your reading history, bookmarks, and local library data.</p>
          <div class="ink-modal-warning">
            <span class="warn-icon">⚠</span>
            <span>This action cannot be undone.</span>
          </div>
        `,
        confirmText: 'Clear Everything',
        cancelText:  'Keep My Data',
        destructive: true,
      }).then(async (confirmed) => {
        if (!confirmed) return;
        const success = await window.electron.dbClear();
        if (success) window.location.reload();
      });
    });
  }

})();
