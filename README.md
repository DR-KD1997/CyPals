# CyPals

AI companions that show up like a video call — or stand on your desktop.

CyPals takes the character-card ecosystem of SillyTavern, Chub and Tavo and gives each
character a body: a rigged 3D model, a Live2D avatar, or a set of portrait images that
change with their expression. Characters talk in speech bubbles, or out loud through a
TTS engine, and up to three can share the screen and talk to each other.

Runs on **Windows**, **Linux** and **Android** (Tauri 2 + React + three.js).

## Features

| Area | What's there |
| --- | --- |
| Characters | Create from scratch, or import **Character Card V1, V2, V3** (PNG `chara`/`ccv3` chunks, JSON, **CHARX**). Import fills every field, keeps unknown fields for round-tripping, and exports back to V2+V3 PNG. |
| Avatars | **3D** (VRM 0.x/1.0, GLB, glTF) with shape-key expressions, lip sync, blinking, idle motion, eye contact and gestures (clips or procedural). **Live2D** (Cubism 2–5) with expression/motion mapping and mouth sync. **Portrait sets** keyed by expression with crossfades and optional talking frames. A companion can have several of each and switch mid-call. |
| Lorebooks | Shared library — one lorebook can link to many companions. Imports SillyTavern World Info, Chub and card-embedded books. Keywords/regex, secondary-key logic, constant entries, recursion, token budgets, probability, sticky/cooldown, insert positions incl. at-depth, per-companion filters. |
| Models | Local (Ollama, LM Studio, KoboldCpp, llama.cpp, text-generation-webui) or cloud (**Gemini**, **Grok**, **OpenRouter**, OpenAI, Anthropic, DeepSeek, Mistral, any OpenAI-compatible URL). Per-companion model override. Streaming everywhere. |
| Voice | Text bubbles by default. Connect Kokoro, AllTalk, XTTS, GPT-SoVITS, OpenAI TTS, ElevenLabs, any HTTP TTS, or the system voice — then optionally hide the text. Mouth movement follows the audio. |
| Presentation | Call window (circle, rounded or rectangle) on a colour or image background. On Windows/Linux, a companion can step out of the call and stand **full-body over your desktop** in a click-through overlay. |
| Group calls | Up to **3** companions on screen. They answer when named, reply to each other autonomously (with a chain limit), and can chatter when you're idle. Your message interrupts them. |
| Vision | **Off by default.** Screen sharing is limited to allowed programs/windows (or everything except a block-list), always excludes password managers, banking/sign-in pages, private windows and CyPals itself, and is re-checked natively before capture. Webcam is a separate opt-in. A notice shows each time an image is shared. |
| Fourth Wall Awareness | Per-companion toggle: the character knows it's an AI voicing a character inside CyPals on your device, keeps its personality, and occasionally remarks on the parasocial nature of the conversation (adjustable frequency, never more than once per four replies). |
| `.cypal` files | Each companion saves to a single file with its avatars, assets and linked lorebooks. See [`docs/FORMAT.md`](docs/FORMAT.md). |

## Downloads

Builds for Android (APK), Windows (installer `.exe` / `.msi`) and Linux (`.deb`, `.rpm`, AppImage) are made by
GitHub Actions ([`.github/workflows/build.yml`](.github/workflows/build.yml)). Every push to `main` keeps them as
workflow artifacts; pushing a tag such as `v0.1.0` publishes them on the Releases page.

The Android APK is signed with the key in the `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD` and
`ANDROID_KEY_ALIAS` repository secrets. Without them, CI signs with a temporary key, so that APK can't be updated in place.

## Getting started

```bash
npm install
npm test               # 68 core tests (cards, lore, prompt, providers, orchestration…)
npm run dev            # browser preview at http://localhost:1420 (no overlay / screen capture)
npm run desktop:dev    # the real app on Windows or Linux
npm run desktop:build  # installers: NSIS/MSI on Windows, .deb/.rpm/AppImage on Linux
```

Then: **Settings → Models** to connect a model, **Companions → Import** and pick
[`examples/Pip.charx`](examples/Pip.charx) (an original demo character with an expression
portrait set and a small lorebook), and press **Call**.

### Prerequisites

- Node 20+ and Rust 1.80+
- **Linux:** `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev libdbus-1-dev libpipewire-0.3-dev libgbm-dev libxcb1-dev libxrandr-dev libclang-dev`
- **Windows:** WebView2 (preinstalled on Windows 10/11) and the MSVC build tools
- **Android:** Android Studio with SDK + NDK, `JAVA_HOME`, `ANDROID_HOME`, `NDK_HOME`; then
  ```bash
  rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
  npm run android:init   # generates src-tauri/gen/android
  npm run android:dev    # run on a device/emulator
  npm run android:build  # APK / AAB
  ```

### Live2D

Live2D's Cubism Core runtime is proprietary and can't be bundled. The first time a
Live2D avatar loads, CyPals asks for `live2dcubismcore.min.js` (from the free
*Cubism SDK for Web* at live2d.com) and stores it in the app's data folder. For the
browser dev server you can drop it in `public/vendor/` instead. Cubism 2 models also
need `live2d.min.js`.

## How the avatar is driven

The model is asked to prefix speech with performance tags, which the user never sees:

```
<expr:happy> Oh, you're back! <act:wave> I missed you. <expr:sad> ...kind of.
```

Replies are split into segments; each segment sets the expression (shape keys on 3D,
expressions on Live2D, the matching image for portraits), triggers gestures, and is
spoken or "lip-flapped" in order. If a model ignores the tags, expressions are inferred
from `*narration*` and the tone of the reply. Small models that echo tags can turn them
off in **Settings → Conversation**.

## Platform notes

| | Windows | Linux | Android |
| --- | --- | --- | --- |
| Call window | ✓ | ✓ | ✓ |
| Desktop overlay | ✓ | ✓ (X11; on Wayland run with `GDK_BACKEND=x11`) | — |
| Screen vision | ✓ | ✓ X11 (Wayland window capture is not exposed by compositors) | — |
| Webcam vision | ✓ | ✓ | ✓ |
| API keys | Credential Manager | Secret Service (file fallback, mode 600) | app-private storage |

## Project layout

```
src/core/          platform-independent engine (fully unit-tested)
  cards/           PNG chunk I/O, CCv1–v3 + CHARX import/export
  lorebook/        activation engine, ST/Chub/card conversion
  format/          .cypal pack/unpack
  llm/             providers (OpenAI-compatible, Gemini, Anthropic), prompt builder
  conversation/    multi-companion orchestrator
  tts/  vision/    voice engines, privacy policy
  expressions.ts   performance tags  ·  fourthWall.ts
src/avatars/       3D (three-vrm), Live2D (pixi-live2d-display), portrait renderers
src/state/         store, runtime (orchestrator ↔ voice ↔ avatars), audio, webcam
src/ui/            call stage, editors, settings, overlay window
src-tauri/         Rust: storage, keychain, policy-checked window capture, overlay window
```

## Licence

AGPL-3.0-or-later. Live2D Cubism Core is subject to Live2D Inc.'s own licence.
