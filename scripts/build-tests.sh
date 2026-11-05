#!/bin/sh
set -e
rm -rf .test-build
npx tsc lib/server/engine.ts lib/server/store.ts lib/rng.ts lib/quests.ts lib/game-types.ts lib/cosmetics-catalog.ts lib/item-looks.ts lib/swing-physics.ts lib/scoring.ts lib/season.ts --outDir .test-build --rootDir lib --module commonjs --target es2020 --skipLibCheck --esModuleInterop --moduleResolution node
