function jumpToPage(pageIdx) {
  if (pageIdx >= 0 && pageIdx < readerState.total) {
    readerState.currentPage = pageIdx;
    renderAllPages(document.getElementById('readerPages'));
    updateReaderUI();
    saveReadingPosition();
    const toolbar = document.getElementById('readerToolbar');
    if (toolbar) {
      toolbar.classList.remove('hidden');
      resetReaderTimer();
    }
  }
}
