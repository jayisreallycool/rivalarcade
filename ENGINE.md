# RivalArcade 3D Engine

All four 3D games (Neon Dash, Dunk Rush, Cyber Reflex, Gem Surge) run on one shared engine in `lib/engine/`.
Games describe their world and their rules. The engine owns the GPU, the frame loop and cleanup.

## What was wrong before

| Problem | Effect |
|---|---|
| Each game built its own renderer inside a `useEffect` that depended on `isPlaying` and `onFinish` | Pressing START or reaching game over **tore down and rebuilt the whole scene and WebGL context**. Shaders recompiled, there was a hitch on start, and contexts piled up |
| Contexts were never force-released | After a few matches Chrome logged *"Too many active WebGL contexts. Oldest context will be lost"*, which kills a live 3D view |
| `setScore` / `setDistance` on every frame (Neon Dash) | React re-rendered the HUD 60×/s, with 16 layouts/s |
| New geometry/material per spawn (arches, reflex nodes, every gem, every particle), never disposed | GPU memory grew for as long as you played |
| A throwaway WebGL context created on every mount just to detect the GPU | An extra context per game open |
| Round timers on `setInterval` | Kept counting while the tab was hidden. The render loop also ran off-screen |
| `container.innerHTML = ''` on a React-managed div | Crashed the app on START (fixed first) |
| three.js bundled into the home page | 283 kB first-load JS before any game was opened |

## Architecture

```
lib/engine/
  quality.ts      Device tier detection (once per page load) → pixel ratio, shadows, bloom, particle caps
  GameEngine.ts   Renderer + scene + camera + bloom composer + loop + adaptive resolution + disposal
  effects.ts      ParticleBursts: every spark on screen in ONE instanced draw call
  environment.ts  Procedural set pieces: neon grid floor, instanced skyline, starfield, blob shadow, light rig
  pool.ts         Object pool for obstacles/targets
  react.ts        useGameEngine, useThrottledHud, useLatest, useStructuralMemo
  index.ts        Public exports
```

### Frame loop
- One `requestAnimationFrame` loop per engine using `THREE.Timer`. The simulation step is clamped to 1/20 s, so a hitch never teleports objects.
- Games register logic with `engine.addUpdate((dt, elapsed) => …)`.
- The loop **pauses** when the tab is hidden, the canvas is scrolled off-screen (IntersectionObserver), or the WebGL context is lost, and resumes without a time spike.
- Round clocks now live in the loop, so they pause with it.

### Rendering
- ACES filmic tone mapping and sRGB output.
- **Neon bloom** (medium and high tiers): `RenderPass → UnrealBloomPass → OutputPass`. Bloom mips render at 50–75 % resolution. High tier uses 4× MSAA HDR targets.
- Anything meant to glow uses `neonMaterial()` (HDR colour, not tone-mapped), so it crosses the bloom threshold. `engine.flash()` gives a brief bloom kick on scores and impacts.
- Shadows are set per tier via `engine.configureShadows(light)`. Low tier uses soft blob shadows instead of shadow maps.
- **Adaptive resolution**: the engine watches the real frame time. It drops the pixel ratio by 0.15 when frames run 30 % over budget, and recovers slowly (a few times at most) so it never oscillates.

### Quality tiers

| | low | medium | high |
|---|---|---|---|
| Pixel ratio | 0.6–1.0 | 0.75–1.5 | 1.0–2.0 |
| Bloom | off | on (½-res) | on (¾-res, MSAA) |
| Shadows | blob only | 1024 | 2048 |
| Large surfaces | unlit | PBR | PBR |
| Particles | 120 | 300 | 600 |

Detection uses the GPU renderer string, `deviceMemory`, core count and mobile UA. Software renderers and weak mobile GPUs go to low.
Override for testing: `localStorage.setItem('ra.quality', 'high')` then reopen a game.
Live stats overlay: add `?fps` to the URL (tier, fps, frame ms, pixel ratio, draw calls, triangles).

### React integration
- `useGameEngine(options, setup, [avatar])`: the scene is built **once per avatar**, never on gameplay state changes. Gameplay state lives in a `useRef` that the loop reads.
- `useThrottledHud`: the loop can push HUD values every frame, and React re-renders at most ~10×/s. Pass `immediate` for game over and scoring moments.
- `useLatest(onFinish)`: the parent can pass a new callback every render without rebuilding the scene.
- `useStructuralMemo(avatar)`: an equal avatar object from a store update doesn't rebuild the scene.
- The 3D games are loaded with `next/dynamic`, so three.js downloads only when a match opens.

### Cleanup
`engine.dispose()` traverses the scene and disposes every geometry, material and texture exactly once. It also disposes everything registered with `engine.own()` (pooled resources that may be out of the scene), then calls `forceContextLoss()` and removes the canvas.

## Per-game changes
- **Neon Dash 3D**: scrolling neon grid road, endless two-segment instanced skyline, synthwave horizon sun, starfield. Pooled spikes, arches and crystals with shared geometry. Pickup and crash particles, camera follow and shake, a FOV kick that scales with speed. Slide now fast-falls out of a jump. The final score now matches the HUD (distance bonus included).
- **Dunk Rush 3D**: painted court texture, textured ball with an ember trail, a dotted aim guide that uses the same launch math as the real shot (the old guide used different numbers, and its dashed line never rendered). Net swish wobble, rim flare, celebrate animation. Camera reframed so the player and ball are visible. Game over shows the best streak.
- **Cyber Reflex 3D**: shared materials per node type (previously 2 new materials per spawn), pooled nodes with pop-in, grid arena, orbiting halo rings, a laser beam from the avatar to each hit, hit sparks, the avatar turns to face its target, shake on hazards.
- **Gem Surge 3D**: 1 geometry and 5 materials for all gems (previously a new pair per gem). Cascades chain until the board is stable (previously only 2 levels). Boards start without pre-made matches. Invalid swaps animate back. Input is locked during resolution. Tap-to-select now works as well as drag.
- **Avatar**: poses blend smoothly at any frame rate. `trigger('shoot' | 'celebrate', seconds)` plays one-shot actions that previously flashed for a single frame.

## Measured (headless Chromium, software GL, low tier)

| | Before | After |
|---|---|---|
| Home page first-load JS | 283 kB | 134 kB |
| WebGL contexts per match (open + START) | 4 | 2 (1 after the first game; detection is cached) |
| 18 open/close cycles | "Too many active WebGL contexts" (oldest context lost) | none |
| Neon Dash JS time per frame | 3.7 ms | 2.4 ms |
| Neon Dash layouts per second | 16 | 5.8 |
| Other games JS time per frame | 0.9–1.6 ms | 1.4–1.6 ms (with particles, beams, animated sets) |

Frame rates under a software renderer vary ±15 % between identical runs and don't reflect GPU performance, so they aren't listed. Use `?fps` on a real phone to check tiers.

## Roadmap
Done since the engine landed:
- ~~Seeded RNG shared by duel players~~: `lib/rng.ts`. All gameplay randomness uses the match seed, which is shown in the match header.
- ~~Quality setting in Profile~~: Profile → Settings → Graphics quality.
- ~~2D fallback when WebGL2 is unavailable~~: the match screen switches to the canvas 2D games automatically.

Still open:
1. **Physics-based rim and backboard bounces** for Dunk Rush. Scoring is still a proximity test.
2. **GLTF avatar pipeline**: skinned models with an animation mixer behind the existing `Avatar3DInstance` interface.
3. **Real multiplayer backend**: rivals and tournament fields are skill-matched bots, and progress lives in localStorage on one device.
4. **Single shared renderer** if more than one 3D view is ever on screen at once.
