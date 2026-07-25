#!/usr/bin/env bash
# testui — one-time setup
set -euo pipefail
cd "$(dirname "$0")"

echo ""
echo "== 1/3  npm install =="
npm install

echo ""
echo "== 2/3  pulling @bklit registry components =="
node scripts/add-charts.mjs

echo ""
echo "== 3/3  done =="
echo "Start the gallery with: npm run dev   (http://localhost:5199)"
