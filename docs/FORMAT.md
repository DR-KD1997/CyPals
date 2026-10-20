# The `.cypal` companion format (version 1)

A `.cypal` file is a ZIP archive holding one companion and everything it needs.

```
cypal.json             manifest
companion.json         the Companion object (schema 1)
lorebooks/<id>.json    each shared lorebook the companion links to
assets/…               models, Live2D folders, portraits, backgrounds, animation clips
card.png               optional: a Character Card V2+V3 PNG for other apps
```

MIME type `application/x-cypal+zip`. Text entries are deflated; already-compressed
binaries (PNG, JPEG, WebP, VRM, GLB, MOC3, audio) are stored uncompressed.

## `cypal.json`

```json
{
  "format": "cypal",
  "version": 1,
  "app": "CyPals 0.1.0",
  "exportedAt": "2026-10-20T12:00:00.000Z",
  "companionId": "cp_…",
  "name": "Pip"
}
```

Readers must reject files whose `version` is greater than the highest they support.

## `companion.json`

Defined in [`src/core/types.ts`](../src/core/types.ts) (`Companion`). Key parts:

- `character` — a superset of Character Card V3 `data` fields (camelCase), plus
  `extensions` holding unknown card fields under `cypals/unknown_fields` and V3-only
  fields under `ccv3/*`, so a card survives import → export unchanged.
- `avatars[]` — any mix of:
  - `model3d`: `model` asset (VRM/GLB/glTF), `animations` (action → clip asset),
    `expressionMap` (expression → shape-key weights), `lipSyncKeys`, `camera`.
  - `live2d`: `entry` (`*.model3.json` / `*.model.json`), `files` (everything it
    references), `expressionMap`, `motionMap`, `lipSyncParam`, `scale`, `offset`.
  - `portraits`: `images` (expression or action key → one or more image assets),
    `fallback`, `transitionMs`, `talkingSuffix`.
  Every avatar may carry `framing: { zoom, x, y }` — its zoom and shift inside the call window.
- `activeAvatarId` — which avatar shows by default.
- `preferredPersonaId` — the persona the user prefers to play with this companion (ids are local to the user's app; unknown ids fall back to the default persona).
- `voice`, `presentation`, `behaviour` (incl. `fourthWallAware`, `fourthWallFrequency`,
  `autonomousChat`, `idleChatterSeconds`, `spontaneousGreeting`).
- `lorebookIds` — links into the shared library; the books are bundled under
  `lorebooks/` and merged into the library on import.
- `embeddedLorebook` — a card's own book, kept private to this companion.

Asset references are `{ "path": "assets/…", "mime": "…" }`, relative to the archive
root. API keys and LLM connection details are never written to a `.cypal` file.

## Safety rules for readers

- Every path must be relative, use `/`, contain no `..` segments, no drive letters and
  no leading `/`; anything else is rejected.
- Assets live only under `assets/`.
- Implementations should cap entry count and uncompressed size (CyPals: 20 000 entries,
  512 MB per entry, 2 GB total).

Fields added in 0.2 (`framing`, `preferredPersonaId`, `spontaneousGreeting`) are optional, so 0.1 files load unchanged.

## Expression vocabulary

`neutral, happy, joy, sad, angry, surprised, fear, disgust, embarrassed, thinking, smug,
love, sleepy, confused` — and actions `wave, nod, shake_head, laugh, shrug, bow, think,
clap, point` (free-form action names are allowed too). Readers should resolve synonyms
and word forms (*sadness* → sad, *surprise* → surprised, *embarrassment* → embarrassed); CyPals'
matcher is in [`src/core/synonyms.ts`](../src/core/synonyms.ts).
