#!/usr/bin/env bash
# Commit the live-data files in a gh-pages checkout and push them.
#
# Live data changes every 30 minutes; to keep the branch small, consecutive data commits are squashed into
# one ("Live data", amended and force-pushed with a lease). A site deploy in between starts a new one.
#   tools/ci/push-live-data.sh SITE_DIR
set -euo pipefail
cd "${1:?usage: push-live-data.sh SITE_DIR}"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add live
if git diff --cached --quiet; then
  echo "No new live data."
  exit 0
fi
if [ "$(git log -1 --format=%s)" = "Live data" ]; then
  git commit -q --amend -m "Live data"
  git push --force-with-lease origin HEAD:gh-pages
else
  git commit -qm "Live data"
  git push origin HEAD:gh-pages
fi
echo "Pushed live data."
