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

  /**
   * Show the modal. Returns a Promise that resolves true (confirm) or false (cancel).
   *
   * options: {
   *   title        : string
   *   body         : string (HTML)
   *   icon         : string (emoji / HTML entity)
   *   iconClass    : 'update' | 'danger'
   *   confirmText  : string
   *   cancelText   : string
   *   destructive  : boolean
   *   hideCancelBtn: boolean
   * }
   */
  function showModal(options = {}) {
    iconEl.textContent  = options.icon || '';
    iconEl.className    = 'ink-modal-icon ' + (options.iconClass || '');
    iconEl.style.display = options.icon ? 'flex' : 'none';

    titleEl.textContent = options.title || '';
    bodyEl.innerHTML    = options.body  || '';

    confirmBtn.textContent = options.confirmText || 'Confirm';
    confirmBtn.className   = 'ink-modal-btn ink-modal-confirm ' +
                              (options.destructive ? 'destructive' : 'primary');

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

  // Dismiss on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hideModal(false);
  });

  // Keyboard: Escape = cancel, Enter = confirm
  document.addEventListener('keydown', (e) => {
    if (!overlay.classList.contains('active')) return;
    if (e.key === 'Escape') hideModal(false);
    if (e.key === 'Enter')  hideModal(true);
  });

  /* ── Expose globally so app.js can use it ── */
  window.inkModal = showModal;


  /* ── Update Available ───────────────────────────────────────── */
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
        if (confirmed) window.electron.openExternal(info.url);
      });
    });
  }


  /* ── DB / Library Clear (triggered from main process) ───────── */
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


  /* ── Inline History Clear (replaces window.confirm in app.js) ── */
  //
  // app.js calls:  if (confirm('Clear all reading history?')) { ... }
  // We patch window.confirm to intercept only that specific call
  // and route it through our modal instead.
  //
  const _nativeConfirm = window.confirm.bind(window);

  window.confirm = function (message) {
    // Only intercept the history-clear prompt; let everything else through.
    if (typeof message === 'string' && message.toLowerCase().includes('reading history')) {
      // Can't make confirm() async, so we schedule the modal and return false
      // synchronously — then re-run the action ourselves on confirmation.
      showModal({
        icon: '🗑',
        iconClass: 'danger',
        title: 'Clear Reading History?',
        body: `
          <p>Your reading history and last-read progress will be removed.</p>
          <div class="ink-modal-warning">
            <span class="warn-icon">⚠</span>
            <span>This cannot be undone.</span>
          </div>
        `,
        confirmText: 'Clear History',
        cancelText:  'Keep History',
        destructive: true,
      }).then((confirmed) => {
        if (!confirmed) return;
        // Re-fire the clear logic that was gated behind confirm().
        // app.js pattern: S.db.history = …; api.dbSave(S.db); renderHistory(main); showToast(…)
        // We emit a synthetic click on the clear button so all that code runs normally.
        document.getElementById('clearHistoryBtn')?.click();
        // Fallback: dispatch a custom event app.js can also listen to.
        document.dispatchEvent(new CustomEvent('inkflow:clearHistory'));
      });

      return false; // prevent the original synchronous confirm path
    }

    return _nativeConfirm(message);
  };
})();
