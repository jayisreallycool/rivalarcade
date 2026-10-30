# Changelog

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
