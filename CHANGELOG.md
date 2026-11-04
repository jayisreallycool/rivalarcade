# Changelog

## 2026-11-04 — Items look like their names, everywhere

- One feature table per item (`lib/item-looks.ts`) read by both the 3D model (which renders the shop images) and the 2D avatar (wardrobe, store try-on, profile, games), so the item you see in the shop is the item you see equipped.
- Tops: hoodies have hoods, drawstrings and a kangaroo pocket (Sub-Zero is sleeveless); tees and jerseys have short sleeves; Rival-01 and Inferno #99 carry their numbers; bombers and windbreakers get collars, zips and ribbed cuffs; Exo-Weave Vest has a glowing reactor and hex nanomesh; Vector Carbon Top is real carbon weave with conduits; Aurora is an actual long coat; Diamond Royale has a varsity collar and diamond crest.
- Bottoms: Court Rush are shorts, Prism Flex are slim leggings, cargos have pockets, joggers and raw denim have cuffs (denim with orange stitching), tech pants have armoured knee plates, Afterburner glows at the ankles.
- Shoes: high-tops have ankle collars, Grav-Boots are tall boots with glowing rings, cleats have studs, Retro Canvas has a cream toe cap, Laser-Trac has a glowing sole and swoosh, Magma Step glows through molten cracks, Void Walkers float on a hover pad.
- Hair & headwear: dreadlocks are beaded locs with gold bands, the ponytail and waves are visible, Twin Nova buns have orbit rings, the undercut has neon circuitry; snapbacks show their backwards brim, button and strap (Lava Flow has a flame print); beanies are cable knit; Obsidian Crown is jagged glass shards; aviators have teardrop lenses; Ruby Laser Shades and Prism Wrap Visor have their own frames.
- Back gear & trails: Plasma Light Wings are angular hard-light panels (Ember Phoenix keeps feathers); the katana has a scabbard; Jade Spirit Blade is a straight jian with tassel; the hoverboard hovers on glowing pads. Each trail has its own effect: lightning, flames, glitter, bubbles, falling code, rainbow ribbon, void rift.
- Equipping a hairstyle also takes its shop colour (change it after if you like); two new hair colours, Riot Magenta and Nova Sky.
- All 74 product images regenerated. A unit test fails if two items look identical or if a name promises a feature (hoodie, shorts, cleats, #99…) the item doesn't have. `/item-lab?view=compare` shows every image beside the avatar wearing it.

## 2026-11-04 — Wardrobe and avatar always in sync

- One slot map (`lib/avatar-slots.ts`) used by the wardrobe, store try-on, saving and loading, so an item always lands on the same slot and "equipped" means the same thing everywhere.
- Owned items equip and save the moment you tap them; body & face options save instantly too (no more Save button drifting out of sync).
- Locked items are preview-only: amber "Previewing" state, never saved, never shown as equipped; Unlock (or Unlock all) buys and equips, Reset clears previews. `equipCosmetic` refuses locked items, and a saved look containing a locked or unknown item is repaired on load.
- Every category visibly changes the avatar: Chill Peace now has its own peace-sign pose, equipped emotes play on the avatar at rest, and banners (new Banners tab) show as the backdrop behind your avatar in the wardrobe and on your profile.
- Store: "On you" try-on view in the item sheet, Equip now for owned items, and buying equips immediately.

## 2026-11-04 — Unique items with generated images

- 33 new uniquely named cosmetics (74 total), each with its own colours, print and finish: e.g. Seraph Halo, Bassline Studio Cans, Obsidian Warlord Crown, Aurora Holo Coat, Inferno Jersey #99, Void Walkers, Rocket Jetpack MK-II, Midnight Champion Cape, Ember Phoenix Wings, Rainbow Rush and Void Rift trails.
- Rarity drives look and price: one table (`RARITY`) for colours, glow, finish (matte → gloss → metal → chrome → holo) and price bands, enforced by a unit test along with unique ids and names.
- New shapes on both the 2D menu avatar and the 3D model: mohawk, twin buns, halo, headphones, round specs, cape, jetpack, feathered wings; fabric prints (camo, flames, circuit, checker, stars, stripes, denim, holo gradient) also show on your first-person sleeves.
- Every item has a generated product image (`public/items/<id>.webp`): its real 3D model, framed on the item, over a background seeded from the item's name and themed by rarity (god rays for legendary, holo foil for mythic). Regenerate with `node scripts/render-items.cjs` against a running build (`/item-lab` shows the contact sheet).
- Rewards tab: full Item Shop with featured strip, rarity filters and a detail sheet; Wardrobe cards, Season Road rewards and cup prizes show the images.
- 3D avatar fixes: hair no longer covers the eyes (visors and aviators were hidden inside it), Solar Puffs is two puffs, face has a mouth.

## 2026-11-02 — Brick Blitz: endless runs, power-ups, more balls, music

- No more 90-second clock: a run lasts until the wall reaches the red line with no shields left. Difficulty ramps more slowly, then tightens past row 45. +50 points per row survived.
- Start with 10 balls (was 5); "+3 balls" pickups; big volleys launch faster.
- Eight power-ups unlock one by one as you go deeper (each guaranteed on its debut row, then random): +3 balls (row 3), row laser (5), bomb (8), column laser (11), fireball (14), split (17), shield (20), freeze (24).
- Original synthwave background track, synthesized live; layers build as you survive deeper and peak when the wall is one row away. Follows the mute button and pauses when the app is in the background.
- Fixed bloom washing out the screen during long volleys (budgeted flashes, dimmer balls in big volleys, capped cuff glow in every first-person game).
- Bot opponents rescaled for the higher endless scores.

## 2026-11-01 — Phones wrongly told 3D was "not compatible"

- Removed the up-front WebGL check that could misfire on real phones and lock the game out; games now always try to start in 3D.
- The renderer retries with plainer graphics settings when a phone's driver refuses the first set.
- In compatibility mode a shader the GPU can't compile no longer ends the game.
- If 3D still fails, the help screen gives device-specific steps (iPhone, Android, in-app browsers), always offers Try again, and shows a short diagnostic code.

## 2026-11-01 — Full 3D, first person, full screen

- Every game is now full 3D with a first-person camera and your own avatar's arms (skin tone, shirt and accent colour) in view:
  - Neon Dash: run the road at eye height; jumps and slides move your view, lane changes lean it, footsteps bob it, hits shake it with a red edge flash.
  - Dunk Rush: hold the ball in your hands at the shot spot and flick it at the rim; hands follow through on each shot.
  - Cyber Reflex: stand on the platform and fire lasers from your hand at nodes that appear in front of you (layouts are seeded as screen fractions, so every phone sees the same drill).
  - Gem Surge: play at a 3D arcade cabinet with marquee, joystick and buttons; your hand taps a button on each swap.
  - Brick Blitz: rebuilt in 3D (it was canvas 2D). Stand behind the launcher, point down the lane to aim, watch volleys bounce through instanced 3D bricks with hit counts. Rules, seeding and scoring are unchanged.
- Removed the 2D "lite edition". GPU trouble now rebuilds the arena in 3D compatibility mode (up to 3 times, stake refunded each time), then offers Try again. Devices without WebGL 2 get a clear explanation instead of a 2D game.
- Full screen: matches enter browser full screen and lock portrait on Android; the app installs to the Home Screen as a full-screen portrait web app (manifest + Apple web-app tags, `viewport-fit=cover`), with a tip on iPhone Safari. New app icon.
- Arms render with cheap standard materials, one merged mesh per hand, drawn last so the world never clips through them.

## 2026-10-31 — 3D compatibility on every phone

- Engine checks what the GPU can really do on the live renderer: half-float render targets (bloom, reflections) and shader limits.
- Physical materials (clear coat, sheen, iridescence) are swapped for standard ones on medium/low tiers and weaker GPUs, so heavy shaders never compile on phones that can't run them. Animated glow and fades stay in sync.
- No float render targets → no post chain and no PMREM; an ambient fill light keeps scenes lit.
- Failure handling: WebGL create errors, scene setup errors, shader compile errors, repeated frame errors and a GPU context lost for more than 2.5s all report a failure. The match retries once in compatibility mode (low tier, no post, no reflections, default power preference), then falls back to the lite 2D edition. Any stake taken for the failed run is refunded.
- An error boundary around games catches crashes and stale code chunks after a deploy, offering Try again / Lite edition / Reload instead of a blank page.
- Audio context creation/resume and Brick Blitz resizing are hardened for iOS and older browsers.
- New `tests/e2e-compat.cjs`: all games on low/medium/high/safe, GPU loss → safe → lite fallback with refund, and no-WebGL devices.

## 2026-10-31 — Skill-app style shell

- New app shell: crown progress + crowns on the left, Rival Coins balance pill with "+" on the right, category chips (All / Live / Action / Puzzle / Sports / New / Popular), and a two-column grid of tall illustrated game cards.
- Original SVG cover art and mascots for every game (Bounce, Zip, Bolt, Pix, Glint) with chunky outlined titles; Lilita One + Nunito fonts self-hosted via @fontsource.
- Bottom bar: Results · Leagues · Play · Rewards · Profile. Results is a new match feed with cover thumbnails and net coins; Leagues holds the league ladder, Cups and Rankings; Profile holds Wardrobe. Red badges for claimable cups, pass tiers and quests.
- Mode sheet uses the cover art as its header and now sits above the tab bar.

## 2026-10-31 — Real-3D rendering upgrade + easy-to-hard difficulty

**Engine**
- Image-based lighting from a procedural neon studio (PMREM, built once) on every quality tier — PBR metals, glossy floors and gems now reflect real light.
- New post chain: GTAO ambient occlusion (high tier, opt-in per game) → bloom → ACES → FXAA (medium) → cinematic grade (contrast, saturation, vignette, soft fringing). Low tier gets a free CSS vignette.
- Soft PCF shadows sized per tier (PCFSoft was removed in three r18x).
- Avatars: rounded capsule limbs, hands, smoother head/torso, physical skin/fabric/hair sheen, clear-coated shoes.
- Dunk Rush: varnished clear-coat court, pebbled ball, metal rim, glass backboard, lit crowd and LED ribbon wall. Gem Surge: a distinct cut per colour with iridescent faceted gems. Reflex/Neon Dash: glossy floors, iridescent orbs and crystals.

**Difficulty — every game now starts easy and ramps up**
- Neon Dash: starts at about 40% of top speed with wide gaps and only spikes/crystals; arches join at ~10s, double-lane walls late. 3 shields instead of one-hit death.
- Dunk Rush: 5-level ladder — strong aim assist and a still hoop at first; the hoop moves and the help eases off as you score.
- Cyber Reflex: 1–2 slow nodes and no hazards at first, ramping to 5 fast nodes with hazards; perfect window tightens.
- Gem Surge: 4 gem types for the first 20s, then 5; idle hint pulses a valid swap; dead boards reshuffle.
- Brick Blitz: 5 starting balls, soft sparse rows early, full-strength walls from row ~14, one shield save.
- Tests: `tests/playtest.cjs` (novice bots incl. a reactive runner via `?debug`), `tests/shots.cjs` (per-tier screenshots).

## 2026-10-30 — Triumph-style modes, leagues and Brick Blitz

- **New game: Brick Blitz** — aim-and-launch brick breaker (drag to aim with bounce preview, release to fire a volley, grab +1 balls, seeded walls). Canvas 2D, so it runs on every phone.
- **Lobby rebuilt** like a skill-gaming app: league card, featured game, big game tiles, and a mode sheet per game with entry tiers (Free / 25 / 50 / 100 / 250 virtual coins).
- **Modes**: 1v1 (winner takes the pot), Live Arena (5 players, live leaderboard, top 3 paid), Streak (beat 3 rising targets for 5×), Blitz (every point pays coins), Practice.
- **Leagues**: crowns from 1v1 wins, arena podiums and completed streaks move you from Bronze to Champion.
- Entry is charged at GO, not on open; results show net coins, crowns, arena table and streak progress. Match history labels every mode.
- Tests: `tests/e2e-modes.cjs` covers stakes, arena/blitz/streak HUDs and payouts; unit checks for payouts and leagues.

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
