#!/bin/sh
# Builds the static web app and pushes it to the gh-pages branch, served at
# https://benjaminkomen.github.io/exact-solar-array-trial/.
# Needs an Exact checkout at ../exact (or EXACT2) with `bun scripts/exact.mjs setup` done.
set -eu
cd "$(dirname "$0")/.."
BASE="/exact-solar-array-trial/"
REMOTE="$(git remote get-url origin)"

rm -rf dist
bun exact.mjs web-build --out dist

# Exact writes <base href="/">; its assets are relative, so pointing the base at the
# Pages subpath is all a static host needs. The `notfound` route in app.contract draws
# the screen at that path, since Exact's router has no base path.
for page in index.html shell.html; do
  sed -i.bak "s|<base href=\"/\">|<base href=\"$BASE\">|" "dist/$page" && rm "dist/$page.bak"
done
cp dist/index.html dist/404.html
touch dist/.nojekyll

cd dist
git init -q -b gh-pages
git add -A
git commit -qm "Deploy $(git -C .. rev-parse --short HEAD)"
git push -f "$REMOTE" gh-pages
echo "Pushed. Live at https://benjaminkomen.github.io$BASE"
