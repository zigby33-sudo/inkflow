# Inkflow — Implementation TODO

## Feature: Bookmarks + Download Cancel/Retry + Import Cover Thumbnail

### Step 1 — Explore + confirm UI insertion points
- [ ] Inspect `renderer/index.html` for reader toolbar + download overlay markup
- [ ] Inspect `renderer/js/core.js` bookmark data structures used by progress/history

### Step 2 — Add persistent bookmark support
- [ ] Add DB schema fields for bookmarks (per mangaId + chapterId)
- [ ] Implement reader UI: “Bookmark” button + bookmark list
- [ ] Restore bookmarks on `openReader()` and `readDownloadedChapter()`

### Step 3 — Add chapter download cancel + retry
- [ ] Add IPC/cancellation mechanism in main process download worker
- [ ] Track page failures during `download-chapter` and report counts
- [ ] Add Cancel/Retry buttons to download overlay UI

### Step 4 — Improve local import covers
- [ ] During `importFromFolder`/`importFromArchive`, select first image as cover
- [ ] Copy/resize cover to a deterministic location under userData
- [ ] Save `db.library[mangaId].cover` for local entries

### Step 5 — Styling + polish
- [ ] Add minimal CSS for bookmark UI and download overlay controls

### Step 6 — Verification
- [ ] Manual tests: import folder, import CBZ/ZIP, download chapter, cancel, retry, bookmark save/load

