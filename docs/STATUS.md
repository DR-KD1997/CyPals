# Development status — v0.1.0

## Verified

Automated (`npm test`, `cargo test`):
- 68 TypeScript tests: CCv1/V2/V3 JSON, PNG (`chara`/`ccv3`, UTF-8), CHARX import; V2+V3 PNG export round-trip;
  lorebook matching (whole-word, regex, selective logic, non-Latin), recursion, budgets, probability,
  sticky/cooldown, character filters, ST World Info import; `.cypal` pack/unpack, traversal and version guards;
  performance-tag parsing and fallback inference; prompt assembly order, depth injection, context trimming,
  group framing, Fourth Wall block and scheduling; streaming for OpenAI-compatible (OpenRouter, Grok),
  Gemini and Anthropic; vision allow/block-list policy; orchestrator routing, autonomous chains,
  interruption, idle chatter, regeneration.
- 6 Rust tests: storage path-traversal guard, header decoding, native vision policy.

Manually, in the Linux release build (Xvfb + compositor, fake streaming OpenAI-compatible server):
- Opening `examples/Pip.charx` from the command line imports it with its portrait set and lorebook.
- Call window: greeting, streaming bubble with tags hidden, per-segment expression changes, talking
  frames, voice-reactive ring, keyword lore reaching the prompt.
- Fourth Wall toggle reaches the model with real device context (OS, presentation, model name).
- Desktop overlay: transparent full-screen window, character at the screen edge, click-through to apps
  underneath, bubbles and expressions mirrored from the main window, "bring back to the call".
- 3D: VRM 1.0 sample (pixiv three-vrm) loads; neutral/sad/surprised expressions, A-pose rest, wave gesture.

## Not yet verified

- Windows and Android builds (code paths compile-gated with `cfg(desktop)` / `cfg(mobile)`; not built here).
- Live2D rendering with a real model (needs the user-supplied Cubism Core).
- Real cloud providers and TTS engines against live endpoints (wire formats are unit-tested).
- Screen capture on a real desktop session; webcam capture.
- Three-companion autonomous conversation in the UI (orchestrator logic is unit-tested).

## Fixed during testing

- Card icon was mixed into the neutral portrait set → icon only stands in when no neutral image exists.
- Failed asset reads were cached forever → misses aren't cached; native reads retry.
- Overlay crashed on Linux (click-through set before the window was realized) → show first.
- 3D framing aimed at the neck; arms raised in rest pose; WebKitGTK showed white behind 3D in call mode.

## Next steps

1. `npm run android:init` and an Android build; mobile layout pass on a real device.
2. Windows build + installer test (NSIS/MSI, `.cypal` file association).
3. Live2D test with a sample model; motion-group auto-mapping.
4. Chub browser/importer (search and download cards and lorebooks in-app).
5. Swipes UI (alternates are already stored), message editing, chat branches.
6. Per-companion long-term memory summaries.
