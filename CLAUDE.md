# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A classroom whiteboard in the EduTools family: students join with a six-character code and draw/write on one shared canvas, and the admin (teacher) admits/removes students, locks the board and clears it. A static site (no build step) on Firebase Realtime Database with anonymous auth, deployed to GitHub Pages. It shares the Firebase project `edutools-7c110` with other EduTools apps. [README.md](README.md) has the feature list, data model and roles table.

State (2026-11-06): implemented, and the unit, rules and browser tests all pass locally. **Not deployed:** the `whiteboards` rules are in `database.rules.json` but have not been deployed to the live database, and the project is not a git repository yet.

## Commands

```sh
npm install         # dev tools only; the app itself has no dependencies
npm run emulators   # Auth :9099 + Realtime Database :9000, loads database.rules.json (needs Java 21+)
npm run serve       # static site on :8080 (ES modules don't load from file://)
npm test            # unit tests, what CI runs (node --test "tests/*.test.js")
npm run test:rules  # security-rule tests; starts its own emulators, so stop "npm run emulators" first
npm run test:e2e    # browser walkthrough; needs emulators + serve running; finds Chrome/Edge itself
node --test tests/strokes.test.js                            # one file
node --test --test-name-pattern="thin" "tests/*.test.js"     # one test, by name
```

Open pages with `?emulator` (for example `http://localhost:8080/?emulator`). Without it they use the real shared database. `npx firebase-tools deploy --only database --project edutools-7c110` deploys rules; see below before running it.

## Architecture

- **No bundler; Firebase comes from the CDN.** `js/firebase.js` is the one place the SDK version (12.19.0) is pinned. It appears in four URLs there (app, auth, database, and the `export *` line), so bump them together. Other modules import Firebase only from `./firebase.js`, which re-exports all of `firebase-database.js` plus `app`, `auth`, `db` and `signIn()`. Only `js/db.js` and the page controllers use it; keep Firebase out of everything else.
- **`js/db.js` is the only module that says anything to Firebase.** Its header documents every path. `board.js` uses it for `items`, `live` and `presence`; `admin.js` and `student.js` use it for `meta`, `students` and `banned`.
- **Pure logic is kept apart so Node can test it.** `util.js`, `strokes.js` and `access.js` import neither the DOM nor Firebase (Node can't import `firebase.js`, which pulls https URLs). `access.js` mirrors the rules for the UI (`getAbility`, `studentScreen`, `buildRoster`); the rules remain the real enforcement.
- **Identity is the anonymous uid.** `signIn()` waits for `auth.authStateReady()` and returns the uid. "Admin" is just `meta/owner === auth.uid`. It survives refreshes but not cleared site data, and there is no recovery. Never store anything about students in the browser: school computers are shared, and an earlier prefilled-name feature was removed for that reason.
- **The board.** `board.js` builds two stacked canvases (`base` for saved items, `live` for strokes in progress, other people's and the eraser ring) plus DOM cursors and a note editor. Everything is in 1920×1080 board units and scaled to the screen; `fit()` sizes it with JS and the canvas rect is cached (`forgetRect`) so pointer moves don't force layout. One database write per finished stroke or note, a throttled preview at `live/{uid}`, and child listeners rather than `onValue`. Long strokes are chunked (`chunkPoints`) to stay under the rules' size cap. Items are ordered by push id.
- **Presence must be re-announced.** The server runs `onDisconnect` clean-up when a connection drops, so `announce()` is called again on every `.info/connected` true. The student page also announces from the waiting screen so the admin sees waiting students as online.
- **Never trust data from other browsers.** Items go through `parseItem` (fixes colors, sizes, coordinates), presence is validated in `showPerson`, and anything shown is set with `textContent` or `el()` children, never `innerHTML`.
- **The admin roster is patched in place.** Rows are built once per person and updated, not rebuilt (`makeRow`/`fill` in `admin.js`). Rebuilding on every presence change made clicks land on buttons that had just been replaced, which happens constantly while students arrive.
- **`?emulator` is read per page load**, so every link must carry it. Build links with `pageUrl()` from `js/nav.js` (it is in its own module so the landing page doesn't load the SDK), or in dev the next page silently uses production. The emulator ports in `js/firebase.js` must match `firebase.json`, and the hard-coded namespace `demo-cuteworld-default-rtdb` is why the emulators run under project `demo-cuteworld`.

## Limits live in three places

Field limits are written in `js/util.js` / `js/strokes.js` (`NAME_MAX`, `TITLE_MAX`, `TEXT_MAX`, `MAX_PAIRS`, the color pattern, 1920×1080), in `database.rules.json`, and in the README. Change them together and add a case to `tests/rules/whiteboards.rules.test.js`. For example, `MAX_PAIRS` at 10 characters a pair has to stay under the 20000-character `pts` cap, and a unit test checks that.

## database.rules.json

- It is the ruleset for the **whole shared database** (`sessions`, `boards`, `polls`, `mindmaps`, `worlds`, and now `whiteboards`). `firebase deploy --only database` overwrites everything live, so keep the other apps' branches untouched and don't deploy unless the user asks. The file uses CRLF line endings; keep them.
- Follow the file's conventions: strict schemas ending in `"$other": { ".validate": false }`, server time as `newData.val() === now`, ownership through `meta/owner`, no `.read` on the collection so boards can't be listed, `.indexOn` for every child you query by.
- Rules evaluate against `root.child(...)` data, so a write that changes who may read (admitting, banning) takes effect for the next operation. The server also cancels a removed browser's open listeners (checked on the emulator).

## CSS and UI

- Design tokens are CSS variables at the top of `css/styles.css`, with a dark scheme. The board itself stays white. Fonts are self-hosted in `assets/fonts` (SIL OFL licenses alongside), so students' browsers never call Google Fonts.
- Specificity trap: `input[type="text"]` beats a bare class, so field variants are written `input.code-input` and `input.name-input`.
- Only `transform` and `opacity` are animated (cursors use `transform: translate`), and `prefers-reduced-motion` is honoured.
- The `web-design-guidelines` skill is installed (`.claude/skills`); the UI was reviewed against it. One rule is deliberately not followed: it asks for Title Case headings and buttons, but this product uses sentence case.

## Style

JS uses ES modules, 2-space indent, semicolons, single quotes, and short comments that explain why rather than what. Copy is sentence case, plain, and avoids "we".
