# Repository Guidelines

## Project Structure

jjokmun is an offline Chrome Manifest V3 extension for writing memos and replies. All runtime files live in `extension/`, including the toolbar icons. The service worker in `background.js` opens `index.html`. Edit `app.js` for memo interactions, `scene.js` for the bookshop, and `styles.css` for layout.

Within `extension/`, `store.js` defines the memo model and validates backups. `vault.js` manages IndexedDB storage and locking, `crypto.js` handles encryption, and `imports.js` merges backups and undoes imports. Preserve compatibility with the existing `memo-alley` database and older backups when changing persistence.

In `extension/ui/`, edit `archive.js` for search and keyboard navigation and `backup-dialogs.js` for backup previews, password prompts, and undo confirmation. Browser regression tests live in `tests/`. The extension user guide is in `extension/README.md`, and the main README uses `docs/preview.png` for its screenshot.

## Local Development

Chrome runs the source directly. Enable **Developer mode** at `chrome://extensions`, choose **Load unpacked**, and select `extension/`. After edits, close open jjokmun tabs, reload the existing extension card, and click the toolbar icon. Keep the installation path stable so Chrome can find the same profile data.

## Testing

Use Node.js 24. From the repository root, run:

```powershell
cd tests
npm install                            # Install playwright-core
npx playwright-core install chromium   # Install the test browser
npm test                               # Run verify.cjs
```

To use an existing Chrome for Testing installation, set `MEMO_CHROME_PATH` to its executable and skip the browser install. Tests use Playwright Core, Node’s strict assertions, and temporary profiles. Add scenarios to `verify.cjs` or call a focused `.cjs` module from it, as with `undo.cjs`. Use synthetic memos. Cover affected behavior, especially legacy imports, multi-tab locking, and blocked network requests. The suite has no numeric coverage threshold.

## Coding Style

Use two-space indentation, single-quoted JavaScript strings, and semicolons. Follow the existing browser ES module and CommonJS test conventions. Use camelCase for functions and variables, uppercase constants such as `NOTE_LIMIT`, and kebab-case HTML IDs such as `memo-input`. Keep user-facing text in Korean. Match surrounding formatting by hand since the repository has no configured formatter or linter.

## Commits and Pull Requests

Recent commit subjects are short Korean summaries. Follow that pattern and mention compatibility effects when relevant. In a pull request, describe the user-visible change, link any related issue, and report the checks you ran. Include a screenshot for visible interface changes.
