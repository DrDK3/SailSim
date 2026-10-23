#!/usr/bin/env bash
# Publish a built site (dist/) to the gh-pages branch, which GitHub Pages serves.
#
# The scheduled jobs write live data into live/ on that branch (latest.json, tide.json, tide-predicted.json,
# tide-harmonics.json). A deploy must not lose them, so they are carried over, and live/index.json is rebuilt
# from the files present. Run from the repository root by .github/workflows/deploy.yml.
#   tools/ci/publish-pages.sh dist
set -euo pipefail
DIST="${1:?usage: publish-pages.sh DIST_DIR}"
JOB_FILES="latest.json tide.json tide-predicted.json tide-harmonics.json"
WORK="$(mktemp -d)"
KEEP="$(mktemp -d)"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

if git fetch --depth 1 origin gh-pages 2>/dev/null; then
  git worktree add "$WORK" FETCH_HEAD
  (cd "$WORK" && git checkout -B gh-pages)
else
  git worktree add --detach "$WORK"
  (cd "$WORK" && git checkout --orphan gh-pages && git rm -rfq .)
fi

for f in $JOB_FILES; do
  if [ -f "$WORK/live/$f" ]; then cp "$WORK/live/$f" "$KEEP/"; fi
done
# Replace the site with the build (everything but .git), then put the job files back.
find "$WORK" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -a "$DIST"/. "$WORK"/
mkdir -p "$WORK/live"
for f in $JOB_FILES; do
  if [ -f "$KEEP/$f" ]; then cp "$KEEP/$f" "$WORK/live/"; fi
done
python3 tools/ingest/index.py "$WORK/live"
touch "$WORK/.nojekyll"   # serve files as they are (no Jekyll processing)

cd "$WORK"
git add -A
if git diff --cached --quiet; then
  echo "Nothing changed; not deploying."
  exit 0
fi
git commit -qm "Deploy ${GITHUB_SHA:-local build}"
git push origin gh-pages
echo "Deployed to gh-pages."
