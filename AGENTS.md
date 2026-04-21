# Obsidian Flashcards Agent Guide

This repository builds the `obsidian-flashcards` Obsidian plugin.

## Read First

1. Read `README.md` before changing code.
2. Treat `src/` as the source of truth.
3. Treat root-level `main.js` and `styles.css` as build artifacts that Obsidian loads.
4. Never commit user-local vault state such as `data.json`.

## Repo Shape

- `src/main.ts`: plugin entrypoint and wiring.
- `src/domain/`: persistent models and schemas.
- `src/data/`: repository, migrations, source-anchor resolution.
- `src/services/`: application behavior for dashboard, library, review, builder, and settings.
- `src/scheduling/`: FSRS scheduler and review queue.
- `src/ui/`: views, builder drawer, router, settings UI, and shared DOM components.
- `tests/`: automated coverage for core behavior.
- `manifest.json`, `main.js`, `styles.css`: distributable plugin artifacts used by Obsidian.

## Working Rules

- Prefer editing TypeScript and source CSS under `src/` instead of patching generated root artifacts.
- If you must hotfix a built artifact in this installed plugin folder, mirror the same change back to the matching source file before considering the work done.
- Keep UI changes visually consistent with the current plugin language: glass panels, compact controls, and low-friction side-panel workflows.
- Keep view classes thin. Business logic belongs in services or scheduling/data layers.
- Preserve migration safety when changing persisted shapes.

## Local Plugin Folder Notes

- This repo lives inside an actual vault plugin folder, so Obsidian reads the root artifacts directly from here.
- `data.json` is real user study data from this vault. Do not delete, rewrite casually, or commit it.
- After source edits, rebuild so the installed plugin stays runnable in place.

## Verification

Run the relevant checks after source changes:

```bash
npm install
npm run typecheck
npm run test:run
npm run build
```

For UI-only or wiring-only changes, still finish with `npm run build` so `main.js` and `styles.css` stay in sync with `src/`.
