# Changelog

## 2026-10-30: Full-screen, swipe-first, Triumph-style competition

### Games are now full screen and built for phones
- Every game fills the whole screen (safe-area aware), with a floating score bar: score, timer, clutch badge, and a live YOU-vs-rival bar. On Android, tapping play also enters true fullscreen.
- Each camera adapts to portrait or landscape while every player keeps the same seeded positions, so the match stays fair on any screen shape.
- New shared gesture system: swipes fire mid-gesture (instant lane changes), slash-to-hit, swipe-to-swap, tap fallbacks, forgiving touch zones for fingers, and vibration feedback on supporting phones.

### Competitive match flow
- VS card before every duel: your rating vs. your rival's, the rival's avatar, the score to beat, and the seed code.
- 3-2-1-GO countdown.
- Clutch time: the last 10 seconds of every round score ×2.
- Floating "+points" popups and banners (SWISH, ON FIRE, CASCADE ×3, CLUTCH TIME).
- A score breakdown on the results screen shows exactly where every point came from.

### Dunk Rush rebuilt as flick-to-shoot basketball
- Flick up from the ball to shoot; lean the flick to aim. A short aim arc helps while dragging.
- Easy to pick up: aim assist pulls good shots toward the rim, and the rim is generous. A clean swish works across about ±20% of swipe length and ±0.3 m of aim.
- Real rim and backboard bounces, bank shots, a perfect-swish window, rapid-fire balls.
- The hoop starts moving at 3 baskets and speeds up through 5 levels. The shot spot shifts on the shared seed, and the camera follows it.
- Scoring: basket 100, swish +50, bank +25, moving hoop +20/level, streaks ×2 (3 in a row) and ×3 (6 in a row), clutch ×2.
- Physics runs at a fixed rate, so shots behave identically on slow and fast phones.

### Other games
- Neon Dash: a fixed 60-second run with a +500 full-run bonus, tap to jump, speed lines, crystal popups.
- Cyber Reflex: slash across nodes, perfect-timing popups, a portrait overhead camera; the node ring is tighter for every player and nodes are bigger.
- Gem Surge: portrait layout with the board at full width, swipe-to-swap, cascade popups.
- Graphics: studio reflections on metals, gems and glass (medium/high quality), an arena crowd and light cones in Dunk Rush.

### Fixes
- The ready screen covered the close button, so a game couldn't be left before starting. Fixed.
- The app crashed when the browser blocks storage (sandboxed previews, some private modes). Fixed.

## 2026-10-27: Make the whole app work end to end

### Fixed
- **Tournament entry fees** were taken from coins without being saved, so they reverted on reload. Entries are now persisted.
- **Tournament runs** never reached the standings, and timers counted down to "Ending Soon" forever. Tournament matches also compared you against a score of 0, so every run was a "win".
- **Daily quests** counted points instead of baskets or combo, so "Sink 5 baskets" and "15x combo" completed on the first game. They never reset each day, and the countdown was hardcoded text.
- **Mute buttons** showed the opposite state (the icon said sound was on while muted) in the header and all eight games. The header and in-game buttons were also out of sync.
- **Wardrobe:** you could preview a locked item, press Save Appearance, and keep it without paying.
- **Rating changes** were random. They now use Elo against the rival's rating.
- **Match history** showed "Just now" for every past match.
- **Season tier** didn't update when XP came from quests.
- **3D avatars** ignored most cosmetics: 4 of 7 hairstyles, 3 of 5 hats, every pair of glasses (all rendered as the same visor), the katana, the skateboard, and the body type.
- **Rematch** left the finished game on screen instead of starting a fresh one.
- **Gem Surge combos** grew forever across moves. They now count cascade steps within a single move.
- **Mobile layout:** the game score bar text collided ("Practice0") and leaderboard names overlapped the tier badges.
- The results screen labelled tournament runs as "1v1 Ranked Duel", and Profile showed Dunk Rush scores as "BUCKETS".

### Added
- **Fair seeded matches.** Every duel and tournament uses one seed for lanes, gem boards and target spawns. The seed code is shown in the match header.
- **Skill-matched rivals.** A rival's rating sits near yours, and their score tracks your recent form in that game.
- **Live rival bar** during duels and tournament runs (ahead / even / behind).
- **Working tournaments.**
  - Registration and live windows, and entry fees.
  - Unlimited attempts while a cup is live; your best counts.
  - A bracket that fills in live.
  - Settlement: 1st 50% of the pool plus the exclusive cosmetic, 2nd 25%, 3rd 12%, top half a refund-plus.
  - Claimable prizes, and a fresh cup scheduled automatically when one ends.
- **Rotating daily quests** from a pool of 10, the same set for everyone each day, with a live reset countdown.
- **Settings** in Profile: graphics quality (auto / low / medium / high), sound, and reset progress.
- **2D fallback** when the device has no WebGL2.
- **Versioned saves.** Progress from the previous version migrates automatically.
- **Tests:** `npm run test:unit` runs 11 logic checks. `npm run test:e2e` runs 23 browser flows on desktop, mobile and no-WebGL.

### Performance
- Menu avatars no longer resize their canvas every frame. They animate at 30 fps and pause off-screen.
