# Obsidian Flashcards

An Obsidian plugin that brings Anki-style spaced repetition directly into your vault.

It lets you create cards from note selections, review them on an FSRS schedule, and manage the collection from a dedicated dashboard and library UI.

## What it does

- Create cards from the current selection or current line
- Support **Basic**, **Reverse**, and **Cloze** card modes
- Review due cards in a focused full-screen review flow
- Browse all cards in a filterable **Card Library**
- Create decks from the library
- Bulk **move**, **tag**, **suspend**, **unsuspend**, and **delete** cards
- Open the original source note directly from the builder or library
- Export and import plugin data as JSON or CSV
- Create manual cards without selecting a source note first
- Attach a source note later from the builder when you want context

## Install on another computer

### Option 1: build from source

```bash
git clone https://github.com/agocia/obsidian-flashcards.git
cd obsidian-flashcards
npm install
npm run build
```

Then copy these files into your vault:

```text
<your-vault>/.obsidian/plugins/obsidian-flashcards/
```

Required files:

- `main.js`
- `manifest.json`
- `styles.css`

After copying:

1. Open **Settings -> Community plugins**
2. Disable **Restricted mode** if needed
3. Enable **Flash Cards**

### Option 2: keep the repo for development

If you want the source repo available on another machine for editing:

```bash
git clone https://github.com/agocia/obsidian-flashcards.git
cd obsidian-flashcards
npm install
```

Useful commands:

```bash
npm run dev
npm run test:run
npm run typecheck
npm run build
```

For active plugin development, point your vault plugin folder at this repo and rebuild after changes.

## First-time usage flow

1. Open any Markdown note in Obsidian
2. Select text you want to remember
3. Run **Create Card from Selection or Current Line**
4. Save the card from the right-side builder drawer
5. Open **Flashcards** from the ribbon
6. Start a review session from the dashboard

You can also run **Create Blank Card** or click **Create Card** from the dashboard/library to make a card without any source note. Source context is optional: use **Attach Source Note** inside the builder if you want to link the card back to a note later.

## Main UI surfaces

### Dashboard

The dashboard is the plugin home screen. It shows:

- due cards
- new cards
- retention
- streak
- deck-scoped review selection
- next review block
- problem-card signals

### Card Library

The library is the management surface for the whole collection. It supports:

- search by prompt, answer, deck, tag, and source note
- filters for deck, tag, state, and source file
- deck-directory navigation with paged rendering so large libraries do not mount every card at once
- deck creation and deck renaming from the library
- right-side card editing through the same drawer used for card creation
- bulk actions through an inline action tray
- direct return to the dashboard
- direct jump back to the source note

### Builder Drawer

The builder opens in Obsidian's right sidebar so it behaves like a native side panel. It is designed for quick capture while keeping the source note visible and reachable.

The builder supports both source-backed cards and manual cards. Manual cards use an internal blank source anchor, so they are not forced to point to an Obsidian note. Use the deck selector's **New Deck** action when the target deck does not exist yet.

Saving a card keeps the builder open and clears the content fields so the next card can be captured without reopening the panel.

### Review View

The review view is the focused study surface. It supports:

- space to reveal
- `1` / `2` / `3` / `4` rating shortcuts
- FSRS schedule previews before rating

## Architecture

The codebase is organized into small layers so data rules, scheduling rules, and UI rendering stay separate.

### 1. Domain layer

`src/domain/`

- `models.ts` defines the persistent records and defaults
- `schemas.ts` validates stored plugin data

This is the single source of truth for the stored card/deck/tag/session shapes.

### 2. Data layer

`src/data/`

- `plugin-data-repository.ts` loads, caches, mutates, and saves plugin data
- `migrations.ts` upgrades old saved data to the current schema version
- `source-anchor-resolver.ts` tracks the note location used to create a card

This layer isolates persistence and migration logic from UI and business logic.

### 3. Service layer

`src/services/`

- `card-builder-service.ts`
- `dashboard-service.ts`
- `library-service.ts`
- `review-session-service.ts`
- `settings-service.ts`

These services implement the plugin behavior that the UI calls into.

### 4. Scheduling layer

`src/scheduling/`

- `fsrs-scheduler.ts` handles FSRS transitions
- `review-queue.ts` builds the due-card queue

This keeps spaced-repetition logic separate from rendering and persistence.

### 5. UI layer

`src/ui/`

- `views/` contains the main dashboard, review, and library surfaces
- `builder/` contains the right-side builder drawer
- `components/` contains reusable DOM render helpers
- `settings/` contains the plugin settings UI
- `router/` handles workspace leaf routing

### 6. Style layer

`src/styles/`

- shared tokens
- reusable plugin-level styles

The final distributable stylesheet is emitted as `styles.css`.

### 7. Plugin entrypoint

`src/main.ts`

The main plugin class wires together:

- repository
- services
- views
- commands
- ribbon action
- settings tab
- builder leaf

## Project structure

```text
obsidian-flashcards/
├── src/
│   ├── data/
│   ├── domain/
│   ├── parsing/
│   ├── scheduling/
│   ├── services/
│   ├── styles/
│   ├── ui/
│   │   ├── builder/
│   │   ├── components/
│   │   ├── router/
│   │   ├── settings/
│   │   └── views/
│   └── main.ts
├── tests/
├── manifest.json
├── styles.css
├── esbuild.mjs
├── vitest.config.ts
└── package.json
```

## Development notes

- The plugin stores data through the repository abstraction, not directly from views
- UI views should stay thin and call services for mutations
- Saved data is migrated on load through `src/data/migrations.ts`
- Suspension now preserves the card's pre-suspension state so unsuspending does not corrupt learning/relearning progress

## Test and verification commands

```bash
npm run test:run
npm run typecheck
npm run build
```

## Plugin output files

The built plugin artifacts are:

- `main.js`
- `manifest.json`
- `styles.css`

Those are the files Obsidian needs inside `.obsidian/plugins/obsidian-flashcards/`.

## Local Obsidian deployment note

Obsidian does not run files from `src/` directly. During development, visible changes require both steps:

```bash
npm run build
cp main.js styles.css manifest.json "<your-vault>/.obsidian/plugins/obsidian-flashcards/"
```

Then reload Obsidian or disable and re-enable the plugin. If `src/` changes but the vault plugin folder still has the old `main.js` or `styles.css`, the Obsidian UI will look unchanged.
