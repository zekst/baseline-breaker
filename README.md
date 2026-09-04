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

## Files

- `index.html` shell, screens and HUD
- `style.css` single dark night-court theme
- `game.js` engine: physics, bonuses, scoring, level flow, input
- `render3d.js` three.js renderer: court, instanced bricks, paddle, balls, boosts, particles, camera fit
- `levels.js` 30 layouts as 11×13 grids. Each token lists stacked cube kinds bottom to top: `0` empty, `1` unbreakable, `2`–`5` breakable kinds worth 1–4 points. Stack height is the brick's hit points.

## Scoring

Brick kinds score 1 to 4 points per cube. Unbreakable cubes score 5 when destroyed by smash or power shot. Clearing a level adds `10 + 7 × (difficulty − 1) + 4 × levels already cleared`.

Best score is kept in `localStorage` under `bb-best`.

## Debug

`window.__bb` exposes the game state. `__bb.simulate(ms)` steps the simulation synchronously; `__bb.autoplay = true` hands the paddle to the built-in AI during a real game.
