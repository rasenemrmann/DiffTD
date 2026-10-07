#!/bin/sh
# Rebuild viewer/vendor/isomorphic-git/isomorphic-git.bundle.js (single ESM file, Buffer polyfill included).
set -e
cd "$(dirname "$0")/../.."
npx esbuild viewer/vendor/entry.js --bundle --format=esm --platform=browser --minify \
  --outfile=viewer/vendor/isomorphic-git/isomorphic-git.bundle.js
