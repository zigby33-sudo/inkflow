# 墨 Inkflow — Manga Reader

A desktop manga reader with MangaDex browsing, MyAnimeList stats, and offline downloads.

## Requirements

- **Node.js** v18 or newer → https://nodejs.org
- **npm** (comes with Node.js)

## Setup & Run

```bash
# 1. Extract the inkflow folder anywhere you like

# 2. Open a terminal in that folder
cd inkflow

# 3. Install dependencies (first time only)
npm install

# 4. Launch the app
npm start
```

That's it. The app window will open.

## Features

### Browse & Search
- Home screen shows popular and recently-updated manga from MangaDex
- Search bar finds any manga across MangaDex's full catalog

### Reading
- Click any manga → detail page with chapters
- Click **Read** on any chapter to open the inline reader
- Prev / Next chapter buttons in the reader toolbar
- Click anywhere on the page to hide/show the toolbar

### MyAnimeList Integration
- Each manga detail page automatically fetches MAL score, rank, popularity, chapter count
- Set your reading status (Reading / Completed / On Hold / Dropped / Plan to Read)
- Direct link to the MAL page

### Library
- ☆ Add to Library button saves manga locally
- Library tab shows all saved manga with reading progress bar
- Reading status persists across sessions

### Offline Downloads
- ↓ button on each chapter row downloads all pages to disk
- **Download All** button downloads every chapter in the series
- Downloads tab shows all saved chapters, readable fully offline
- Delete individual chapters or entire manga from downloads

## Data Storage

All data lives in your OS user data folder:
- **Windows**: `%APPDATA%\inkflow\`
- **macOS**: `~/Library/Application Support/inkflow/`
- **Linux**: `~/.config/inkflow/`

Library, reading progress, and downloaded chapters are all stored there.

## Why No CORS Errors?

The HTML-only version failed because browsers block cross-origin requests to MangaDex
(they don't set CORS headers for third-party sites). This Electron app routes all API
calls and image fetches through the **main process** (Node.js), which has no CORS
restrictions — so everything loads correctly.
