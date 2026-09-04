# Baseline Breaker

A top-down tennis brick-breaker in plain HTML, CSS and JavaScript. No build step.

## Run

```bash
python3 -m http.server 8765 --directory .
```

Then open http://localhost:8765. Any static server works; opening `index.html` directly also works.

## Play

- Click or touch and hold to move the paddle. Arrow keys or A/D also work; ArrowUp or K pulls the paddle forward.
- Escape or P pauses.
- Three lives. Clear every breakable brick to advance. Ball speed rises with each cleared level.

## Boosts

| Boost | Effect | Duration |
|---|---|---|
| Defensive wall | Baseline becomes solid | 10 s |
| Multiball | One extra ball (up to four) | instant |
| Smash | Shots fire from the paddle every 0.5 s and break any brick, including unbreakable ones | 10 s |
| Heavy ball | Ball doubles in size, brick points double | 10 s |
| Racket XL | Paddle 1.7× wider | 10 s |
| Power shot | Ball passes through and destroys bricks | 10 s |

The first six drops always come in the order above; after that they are dealt from a shuffled deck.

## Hosting

The game is static, so any static host works. A single-file build lives at `dist/baseline-breaker.html` (rebuild it with `python3 build.py`); it inlines the CSS, level data and scripts and loads three.js from cdnjs.

For GitHub Pages, from this directory:

```bash
gh repo create <owner>/baseline-breaker --public --source . --push
gh api -X POST repos/<owner>/baseline-breaker/pages -f build_type=legacy -f 'source[branch]=main' -f 'source[path]=/'
```

The site then serves from `https://<owner>.github.io/baseline-breaker/`.

## Mobile apps (Capacitor)

The same web build is wrapped as native Android and iOS apps with Capacitor. `stage.py` copies the game into `www/` with a bundled three.js so the apps work offline; `npx cap sync` pushes it into the native projects.

```bash
npm install
npm run sync
```

- App id `com.zekst.baselinebreaker`, portrait only, dark splash and tennis-ball icon (sources in `assets/`, regenerate with `npx @capacitor/assets generate`).
- **Android**: `npm run apk` builds a debug APK at `android/app/build/outputs/apk/debug/app-debug.apk`; `npm run aab` builds the signed release bundle at `android/app/build/outputs/bundle/release/app-release.aab` for Google Play. Signing reads `android/keystore.properties` and `android/upload-keystore.jks` (both git-ignored; keep them safe, Play needs the same key for every update). Needs the Android SDK at the path in `android/local.properties`.
- **iOS**: `npm run ios` opens the Xcode project (`ios/App/App.xcodeproj`, Swift Package Manager, no CocoaPods). Select your team under Signing & Capabilities, then Product → Archive and upload with the Organizer. The Capacitor runtime comes from a local package at `ios/App/LocalPackages/capacitor-swift-pm`; its frameworks are not committed, so run `ios/fetch-frameworks.sh` once after cloning. (Note: `npx cap sync ios` rewrites `ios/App/CapApp-SPM/Package.swift` back to the GitHub dependency; either accept that or re-point it at the local package.)

Publishing checklist:
1. Google Play Console (one-time developer fee): create the app, upload the `.aab`, fill the store listing with screenshots from a phone, complete the content rating and data-safety forms, then roll out to a testing track before production.
2. App Store Connect (Apple Developer Program membership): create the app record with the bundle id, upload the archive from Xcode, add screenshots for 6.7" and 6.5" iPhones and 12.9" iPad, then submit for review.

## Files

- `index.html` shell, screens and HUD
- `style.css` single dark night-court theme
- `game.js` engine: physics, bonuses, scoring, level flow, input
- `render3d.js` three.js renderer: court, instanced bricks, paddle, balls, boosts, particles, camera fit
- `capacitor.config.json`, `android/`, `ios/` native wrappers; `stage.py` prepares `www/`
- `levels.js` 30 layouts as 11×13 grids. Each token lists stacked cube kinds bottom to top: `0` empty, `1` unbreakable, `2`–`5` breakable kinds worth 1–4 points. Stack height is the brick's hit points.

## Scoring

Brick kinds score 1 to 4 points per cube. Unbreakable cubes score 5 when destroyed by smash or power shot. Clearing a level adds `10 + 7 × (difficulty − 1) + 4 × levels already cleared`.

Best score is kept in `localStorage` under `bb-best`.

## Debug

`window.__bb` exposes the game state. `__bb.simulate(ms)` steps the simulation synchronously; `__bb.autoplay = true` hands the paddle to the built-in AI during a real game.
