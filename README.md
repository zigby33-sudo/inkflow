# Inkflow — Manga Reader

A high-performance desktop manga reader with MangaDex browsing, MyAnimeList (MAL) stats, and fully offline reading via on-disk downloads.

> Note: This is an Electron app. All network requests/images are performed from the main process to avoid browser CORS limitations.

---

## Screens (what you can do)

- **Browse & Search**: Browse popular / recently updated titles from MangaDex and search across MangaDex.
- **Manga Details**: View chapters and metadata.
- **Inline Reading**: Open a chapter in the built-in reader (with toolbar hide/show).
- **Navigation**: Use prev/next and page controls while reading.
- **Library**: Save manga to your local library and track reading progress.
- **Offline Downloads**:
  - Download an entire chapter (all pages) to disk
  - “Download All” to fetch every chapter
  - Read downloaded chapters fully offline
  - Delete downloaded chapters/manga
- **Import Manga (local)**: Import from a **folder** (and optionally from **CBZ/ZIP**) into your local library.

---

## Quick Start

### Prerequisites

- **Node.js** v18+ https://nodejs.org
- **npm** (installed with Node.js)

### Run from source

```bash
# inside the inkflow folder
npm install
npm start
```

The app window will open.

---

## Offline Downloads & Data Storage

Inkflow stores your local data under the OS user data directory:

- **Windows**: `%APPDATA%\inkflow\`
- **macOS**: `~/Library/Application Support/inkflow/`
- **Linux**: `~/.config/inkflow/`

What’s stored:

- **Downloads folder**: `downloads/`
  - Each downloaded manga is saved under `downloads/<mangaId>/<chapterId>/`
  - Each chapter contains page files and a `meta.json` with chapter metadata
- **Local database**: `db.json`
  - Library entries
  - Reading progress
  - History
  - Settings (including update notification state)

---

## Reading Experience

- Open any manga → choose a chapter → click **Read**.
- The reader supports:
  - Chapter/page navigation
  - Reader settings (direction, reading mode, page width, image quality, preload, etc.)
  - Toolbar hide/show by clicking the page

---

## Library & Progress

- Use **Add to Library** to save manga locally.
- Library tab shows saved manga with reading progress.
- Your reading status persists across sessions.

Reading status types (as used by the app):

- Reading
- Completed
- On Hold
- Dropped
- Plan to Read

---

## MyAnimeList (MAL) Integration

On manga detail pages, Inkflow fetches MAL info such as:

- Score
- Rank
- Popularity
- Chapter count

It also provides a direct link to the MAL page.

---

## Updating / Auto-updater

Inkflow can check GitHub Releases for newer versions.

- Update checks only run when the app is **packaged** (not in development mode).
- It downloads/launches a separate updater process using the current executable.
- If you have a GitHub token available via `GITHUB_TOKEN`, it will be used to authenticate update checks.

---

## Importing Manga (local)

Inkflow supports importing manga from:

- **Folder**: each subfolder becomes a chapter (root-only defaults to `Chapter_1`).
- **CBZ/ZIP** (best-effort): the app attempts extraction using system tools (fallbacks to PowerShell on Windows).

During import:

- Images are copied/renamed into the download/chapter structure.
- A library entry is created (duplicates are avoided by using a deterministic “local” manga id derived from the title).

---

## Why No CORS Errors?

A plain HTML-only version failed because browsers block cross-origin requests to MangaDex (MangaDex doesn’t provide CORS headers).

Inkflow resolves this by routing API calls and image fetching through the **Electron main process** (Node.js environment), which is not subject to browser CORS restrictions.

---

## Development Commands

From `package.json`:

- Start (dev):
  - `npm start` (electron-forge start)
- Run directly with Electron:
  - `npm run` (electron .)
- Package:
  - `npm run package`
- Make installers:
  - `npm run make`

---

## Troubleshooting

- **App won’t start / missing deps**: run `npm install` again.
- **Images or API calls fail**:
  - Ensure you have a working internet connection.
  - Try clearing the image cache from the reader settings (if available).
- **Downloads don’t show up**:
  - Verify the `downloads/` folder exists inside your Inkflow user data directory.

---

## License

MIT

