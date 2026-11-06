# EduTools Whiteboard

A real-time whiteboard for the classroom. A teacher (the **admin**) opens a board and shares a six-character code. Students join from any browser, with no account and nothing to install, and write and draw on the same canvas together. The admin decides who is in the room and what they can do, and can add or remove students at any time.

It is one of the EduTools classroom apps and follows their conventions: static pages with no build step, Firebase Realtime Database with anonymous sign-in, short join codes, and no server of our own. It shares the `edutools-7c110` Firebase project with the other apps (for example `edutools_pinboard`).

> **Status: built and tested locally, not deployed yet.** The unit tests, the security-rule tests and a browser walkthrough all pass against the Firebase emulators. The new `whiteboards` rules are in [database.rules.json](database.rules.json) but are **not on the live database yet**. Until they are deployed, the app can't create boards in production. See [Deploying](#deploying).

## Features

**Students**

- Join with a code or link and a display name. No account needed.
- Pen, eraser, text, ten marker colors and three sizes, plus undo for their last drawing.
- See everyone's strokes appear live, even while they are still being drawn, with named cursors and a row of who is here.
- Refreshing the page keeps their place, because the anonymous identity survives a reload.
- Mouse, touch and stylus all work. Shortcuts: `P` pen, `E` eraser, `T` text, `1` `2` `3` sizes, `Ctrl+Z` undo.

**Admin**

- Start a board and get its code and join link. The code can be shown in large type for a projector.
- See a live roster of students, who is online, and who is waiting.
- **Add** students by admitting them. Each student's identity is created in their own browser, so the admin admits people who arrive with the code rather than creating accounts. With *Approve new students* on, new arrivals wait until the admin lets them in.
- **Remove** a student at any time. This blocks their browser from rejoining, can delete their drawings too, and can be undone with *Let back in*.
- Make one student view-only, or **lock** the whole board so only the admin can draw.
- Erase anything, or clear the board.
- Save the board as a PNG, and delete it when the lesson is over.

Not in the first version: shapes and lines, image paste, multiple pages, per-group boards, QR join codes, PDF export.

## How it works

1. **The admin starts a board.** `admin.html` signs the admin in anonymously, asks for a name and creates `whiteboards/{CODE}`. The admin's anonymous uid is stored as `meta/owner`, and that is what makes them the admin.
2. **Students join.** They open `student.html?code={CODE}` (or type the code on `index.html`), enter a name and land on the board. If approval is required they wait until the admin admits them.
3. **Everyone draws.**
   - The board is a fixed 1920 × 1080 space scaled to each screen, so every device shows the same layout.
   - A finished stroke or note is one write under `items/`. While a stroke is in progress its points are shared, throttled, at `live/{uid}` so others see it as it is drawn.
   - Each browser listens with `onChildAdded`, `onChildChanged` and `onChildRemoved`, so only changes are downloaded, never the whole board.
4. **The admin steers.** Admitting, removing, view-only, lock and clear are small writes to `meta`, `students` and `banned`. The security rules enforce them, not the UI, so a student can't get around them from the browser console.

### Data model

```text
whiteboards/{CODE}
├── meta               owner (admin's uid), title, locked, requireApproval, createdAt
├── students/{uid}     name, status ("pending" or "active"), viewOnly, joinedAt
├── banned/{uid}       name, at; removed students can no longer read or write the board
├── items/{id}         one stroke or note: type, author uid, color, size, pts | text/x/y, ts
├── live/{uid}         preview of the stroke being drawn right now, deleted once saved
└── presence/{uid}     name, color, cursor x/y, at; cleared on disconnect
```

Board codes are six characters with no look-alikes (no `0`, `1`, `I`, `L` or `O`), the same format the `mindmaps` and `worlds` rules already enforce.

A stroke's points are stored as one compact string (`"x,y x,y …"`) rather than an array, because Realtime Database turns arrays into numbered child nodes, which is slow and bulky for hundreds of points. A very long stroke is split into pieces that join up.

### Roles

| | Admin | Student | Removed, or no code |
|---|---|---|---|
| See the board and who is online | Yes | Yes, once admitted | No |
| Draw and write | Yes | Yes, unless the board is locked or they are view-only | No |
| Erase | Anything | Their own work | No |
| Lock the board, clear it | Yes | No | No |
| Admit, remove, set view-only | Yes | No | No |
| Delete the board | Yes | No | No |

## Repository layout

| Path | What it is |
|---|---|
| `index.html`, `admin.html`, `student.html` | Landing page, admin console, student view |
| `css/styles.css` | All styles |
| `assets/` | Favicon and the self-hosted fonts (Shantell Sans and Atkinson Hyperlegible, both under the SIL Open Font License; the licenses sit next to them) |
| [`js/config.js`](js/config.js), [`js/firebase.js`](js/firebase.js) | Firebase web config, and the SDK loaded from the CDN with anonymous sign-in and the `?emulator` switch |
| `js/db.js` | Everything the app sends to Firebase; the paths are documented at the top |
| `js/board.js` | The shared canvas: drawing, erasing, notes, live strokes, cursors |
| `js/tray.js` | The marker tray: tools, colors, sizes and keyboard shortcuts |
| `js/admin.js`, `js/student.js`, `js/index.js` | One controller per page |
| `js/access.js`, `js/strokes.js`, `js/util.js` | Pure logic, with no DOM or Firebase, covered by the unit tests |
| `js/render.js`, `js/ui.js`, `js/nav.js`, `js/storage.js`, `js/icons.js`, `js/code-form.js`, `js/doodle.js` | Canvas drawing and small helpers |
| [`database.rules.json`](database.rules.json) | Security rules for every EduTools app, including `whiteboards` |
| [`firebase.json`](firebase.json) | Rules file location and emulator ports (Auth `9099`, Database `9000`, UI off) |
| `tests/*.test.js` | Unit tests for the pure logic; CI runs these |
| `tests/rules/` | Security-rule tests, run against the emulator |
| `tests/e2e/` | A browser walkthrough of the whole app, run against the emulator |
| [`.github/workflows/pages.yml`](.github/workflows/pages.yml) | Tests on pushes to `main` and on pull requests; deploys to GitHub Pages from `main` |

## Security rules

`js/config.js` holds the Firebase web config, which is public by design. The only thing protecting the data is [`database.rules.json`](database.rules.json), so the rules do the real enforcement and the UI just reflects them. For `whiteboards/$code` they:

- accept only codes that match `^[A-HJKMNP-Z2-9]{6}$`, and let boards be looked up by code but never listed;
- let any signed-in user create a board for an unused code (they become `owner`), and only the owner change it afterwards;
- let a student read the board only once they are `active` and not banned, and write only their own strokes, only while the board is unlocked and they are not view-only;
- stop a student admitting themselves, giving themselves `viewOnly`, or rewriting their record to shake off a restriction;
- keep every stroke and note well-formed: lowercase hex colors, bounded sizes and coordinates, a size cap on points and text, server timestamps, no unknown fields;
- let only the owner remove, block or unblock anyone, clear the board or delete it.

Removal takes effect at once. A removed browser's writes are refused, and the server also cuts off the board connection it already had open (checked on the emulator).

The rules tests in `tests/rules/` cover all of this. Run them after any change to the rules.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 22 or newer (CI uses 22).
- Java 21 or newer. The Firebase emulators run on the JVM, and recent Firebase CLI versions require it.
- A current browser. For the browser walkthrough, Chrome or Edge.

### Run it locally

```sh
npm install        # dev tools only: the Firebase CLI, a static server, and the test helpers

npm run emulators  # terminal 1: Auth (9099) and Realtime Database (9000), loading database.rules.json
npm run serve      # terminal 2: the site on http://localhost:8080
```

Then open `http://localhost:8080/?emulator`. Every page needs `?emulator` in its address to use the emulators; without it the page talks to the real shared database. The links the app builds carry it along for you.

To try it as a class, start a board in one window, then open the join link in a different browser profile or a private window for each student. Tabs in the same profile share one anonymous identity, so a second profile is how you test a second person.

The project id has to be `demo-cuteworld`, because [`js/firebase.js`](js/firebase.js) connects to the database namespace `demo-cuteworld-default-rtdb`. `demo-` projects need no credentials.

### Tests

```sh
npm test             # unit tests for the pure logic; the same command CI runs
npm run test:rules   # security rules, against its own emulators (stop "npm run emulators" first)
npm run test:e2e     # browser walkthrough; needs "npm run emulators" and "npm run serve" running
```

Keep logic you want covered by `npm test` in modules that touch neither the DOM nor Firebase (like `js/strokes.js`): Node can't import [`js/firebase.js`](js/firebase.js), which loads the SDK from a CDN URL. The walkthrough finds Chrome or Edge on its own; set `BROWSER_PATH` if it can't, and `SHOTS=some/folder` to save screenshots.

## Deploying

### The security rules

**Do this first.** Deploy the rules before the site goes live, or every board will fail with a permission error.

```sh
npx firebase-tools login
npx firebase-tools deploy --only database --project edutools-7c110
```

> **This is a shared database.** `database.rules.json` is the rule set for the whole `edutools-7c110` database, and every EduTools app uses it. A deploy replaces whatever is live. This file keeps the existing branches (`sessions`, `boards`, `polls`, `mindmaps`, `worlds`) exactly as they were, but if the other apps' repositories have newer rules than this copy, merge them in first. Otherwise those apps lose access.

### The site

The site is deployed to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml).

1. Push to a GitHub repository whose default branch is `main`.
2. In the repository, go to Settings, Pages, Build and deployment, and set Source to **GitHub Actions**. You only do this once.
3. From then on, pushes to `main` and pull requests run the unit tests, and pushes to `main` (or a manual run from the Actions tab) also deploy.

The deploy step copies exactly `index.html`, `admin.html`, `student.html`, `css`, `js` and `assets` into the published site. Tests, rules and docs are left out. There is no build step.

Anonymous sign-in must be enabled in the Firebase project (Authentication, Sign-in method, Anonymous). The other EduTools apps rely on it, so the shared project should already have it on.

## Good to know

- **The admin is a browser, not an account.** Admin rights belong to the anonymous identity stored in the browser that started the board, and "Boards from this browser" only lists boards that browser started. Use the same browser profile to get back in. Clearing site data or switching devices loses control of that board.
- **Removal is per identity.** A removed student can come back with a fresh identity by clearing site data or opening a private window. Turn on *Approve new students* if removal needs to stick, because a new identity then has to be admitted again.
- **The code is the key.** Anyone who has a board's code can watch it. Boards can't be listed and codes are hard to guess, but start a new board for each class. Boards don't expire on their own, so delete them when you're done.
- **Capacity.** On Firebase's free Spark plan the Realtime Database allows [100 simultaneous connections](https://firebase.google.com/docs/database/usage/limits) for the whole database, and every open tab counts as one. That is plenty for one class, but several classes using any of the EduTools apps at the same moment share that pool.
- **Privacy.** There are no accounts or e-mail addresses. The only personal detail the app asks for is the display name a student types, and the browser remembers nothing about students. An admin's browser remembers the codes and names of the boards it started.
- **Fonts are self-hosted**, so students' browsers make no requests to Google Fonts.
