# Inkflow Release Detection Troubleshooting Guide

## Current Status
- **App Version**: 1.4.0
- **Repository**: https://github.com/zigby33-sudo/inkflow
- **Update Provider**: GitHub (electron-updater)
- **Expected Feed URL**: https://github.com/zigby33-sudo/inkflow/releases.atom

## Why "No New Releases Found"?

The auto-updater checks for new releases on GitHub but needs specific conditions to be met.

### ✅ Checklist: GitHub Release Setup

#### 1. **Release Tag Format**
- [ ] Release tag **exactly matches** app version format
  - ✅ Correct: `1.4.0` (app is v1.4.0)
  - ✅ Correct: `v1.4.0` (electron-updater accepts both)
  - ❌ Wrong: `release-1.4.0`, `1.4`, `1.4.0-rc1`

**How to check**: Go to https://github.com/zigby33-sudo/inkflow/releases and verify tag names.

#### 2. **Windows Release Assets** (Required for Windows auto-update)
- [ ] Release contains **RELEASES** file
- [ ] Release contains **\*.nupkg** file (e.g., `inkflow-1.4.0-full.nupkg`)
- [ ] Release contains **Setup.exe** (optional but recommended)

**Why**: Windows auto-updater uses Squirrel.Windows format (.nupkg + RELEASES index).

**How to check**: 
1. Open a release on GitHub
2. Scroll down to "Assets"
3. Should see files like:
   ```
   RELEASES
   inkflow-1.4.0-full.nupkg
   Setup.exe (optional)
   ```

#### 3. **Release Status**
- [ ] Release is **not marked as a Draft**
- [ ] Release is **not marked as Pre-release** (unless auto-updater is configured for pre-releases)
- [ ] Release is **Published** (not in pending state)

**How to check**: 
1. Open the release on GitHub
2. Look for "Pre-release" or "Draft" badges/flags
3. Verify there's a green "Published" indicator

#### 4. **Repository Settings**
- [ ] Repository is **public** (GitHub releases API must be accessible)
- [ ] Repository owner is **zigby33-sudo** (not Zigby)
- [ ] Repository name is **inkflow**

**How to check**:
```bash
# Verify in your local repo
git remote -v
# Should show: origin https://github.com/zigby33-sudo/inkflow.git
```

#### 5. **Release Feed URL Validation**
Test the GitHub releases feed directly:

```
https://github.com/zigby33-sudo/inkflow/releases.atom
```

Open this in your browser. You should see XML with `<entry>` tags for each release.

---

## Debugging Steps

### Step 1: Check Main Process Console
When you run Inkflow in development or packaged mode, check the console for:

```
[AutoUpdater] Current app version: 1.4.0
[AutoUpdater] Checking releases at: https://github.com/zigby33-sudo/inkflow/releases
[AutoUpdater] Update available: v1.4.1
// or
[AutoUpdater] No updates available. Latest: 1.4.0
// or
[AutoUpdater] Error: 404 - No published releases found for v1.4.0
```

### Step 2: Verify App Version
In Inkflow UI:
1. Open **Settings**
2. Look for **Software Updates** section
3. Check displayed version: **Current version: v1.4.0**

This must match your GitHub release tag exactly.

### Step 3: Manual GitHub API Test
Test the GitHub API directly from terminal:

```bash
# Get latest release
curl https://api.github.com/repos/zigby33-sudo/inkflow/releases/latest

# Get all releases
curl https://api.github.com/repos/zigby33-sudo/inkflow/releases

# Get atom feed
curl https://github.com/zigby33-sudo/inkflow/releases.atom
```

If you get a 404, the release doesn't exist or the repo is wrong.

### Step 4: Check Release Assets
```bash
# List all assets for latest release
curl -s https://api.github.com/repos/zigby33-sudo/inkflow/releases/latest | jq '.assets[] | {name, download_count}'
```

Look for `RELEASES` and `*.nupkg` files.

---

## Common Issues & Fixes

### ❌ "No published releases found"
**Cause**: Release tag doesn't match app version exactly.

**Fix**: 
1. If release is tagged `v1.4.0` but app shows `1.4.0`, update app version in `package.json`:
   ```json
   "version": "1.4.0"
   ```
2. Or create a new release with correct tag format matching app version.

---

### ❌ "404 - Release not found"
**Cause**: Release doesn't exist on GitHub or repo path is wrong.

**Fix**:
1. Verify repository URL: https://github.com/zigby33-sudo/inkflow
2. Verify release exists: https://github.com/zigby33-sudo/inkflow/releases
3. If repo is private, make it public for auto-updater to access.

---

### ❌ "Release found but no update prompt"
**Cause**: Release assets missing Squirrel.Windows files (.nupkg, RELEASES).

**Fix**:
1. Download/generate Squirrel installers from electron-builder or electron-forge build
2. Add to release assets:
   - `RELEASES` (text file with checksums)
   - `inkflow-1.4.0-full.nupkg` (Squirrel package)
3. Rebuild and re-upload to GitHub release

---

### ❌ "Pre-release detected but not offered"
**Cause**: Release marked as "Pre-release" and auto-updater doesn't include pre-releases by default.

**Fix**: Either:
1. Uncheck "Pre-release" on the GitHub release, OR
2. Update electron-updater config in `main.js`:
   ```javascript
   autoUpdater.setFeedURL({
     provider: 'github',
     owner: 'zigby33-sudo',
     repo: 'inkflow',
     prerelease: true  // Add this
   });
   ```

---

## Building & Publishing Releases

### Using electron-forge (Recommended)
```bash
npm run make      # Build installers (creates Squirrel assets)
npm run publish   # Auto-publish to GitHub releases
```

This automatically:
- Creates .nupkg files
- Generates RELEASES file
- Uploads to GitHub

### Manual GitHub Release Upload
1. Go to https://github.com/zigby33-sudo/inkflow/releases
2. Click **"Create a new release"**
3. Tag version: `1.4.0` (must match package.json)
4. Title: `Inkflow v1.4.0`
5. Upload assets:
   - RELEASES (required for Windows)
   - inkflow-1.4.0-full.nupkg (required for Windows)
   - Setup.exe (optional)
6. Click **"Publish release"**

---

## Verification After Publish

After publishing a release:

1. **Wait 1-2 minutes** for GitHub to process the release
2. **Check feed URL**: https://github.com/zigby33-sudo/inkflow/releases.atom (should contain new release)
3. **Run Inkflow**: Click "Check for Updates" button
4. **Watch console**: Should see `[AutoUpdater] Update available: v1.4.x`

---

## Need More Help?

**Enable verbose logging**:
Edit `main.js` and look for setupAutoUpdater(). The console now logs:
- Current app version
- Feed URL being checked
- Update status and errors

These logs appear in:
- Terminal when running in dev mode
- DevTools Console (Ctrl+Shift+I) in packaged app

**Check electron-updater docs**: https://www.electron.build/auto-update
