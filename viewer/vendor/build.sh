#!/bin/sh
# Rebuild viewer/vendor/isomorphic-git/isomorphic-git.bundle.js (single ESM file, Buffer polyfill included).
set -e
cd "$(dirname "$0")/../.."
npx esbuild viewer/vendor/entry.js --bundle --format=esm --platform=browser --minify \
  --metafile=/tmp/difftd-vendor-meta.json --outfile=viewer/vendor/isomorphic-git/isomorphic-git.bundle.js
python3 viewer/vendor/make-notices.py /tmp/difftd-vendor-meta.json
