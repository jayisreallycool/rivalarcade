<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/fffe7a56-2c08-46d2-bfaf-8a246ca0eeb1

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Testing

```bash
npm run typecheck
npm run lint
npm run test:unit          # seeded RNG, quests, tournament payouts, rival scaling
npm run build && npm start # then, in another terminal:
npm run test:e2e           # 23 browser flows (needs: npx playwright install chromium)
```

See `ENGINE.md` for the 3D engine and `CHANGELOG.md` for recent changes.
