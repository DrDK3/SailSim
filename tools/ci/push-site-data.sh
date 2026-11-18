#!/usr/bin/env bash
# Commit one data folder in a gh-pages checkout and push it (juniors round: weekly targets, club tables), as
# push-live-data.sh does for live/: consecutive commits with the same message are squashed into one (amended and
# force-pushed with a lease), so the branch stays small. A site deploy in between starts a new one.
#   tools/ci/push-site-data.sh SITE_DIR FOLDER "Commit message"
set -euo pipefail
cd "${1:?usage: push-site-data.sh SITE_DIR FOLDER MESSAGE}"
folder="${2:?folder}"
msg="${3:?message}"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A "$folder"
if git diff --cached --quiet; then
  echo "Nothing new in $folder."
  exit 0
fi
if [ "$(git log -1 --format=%s)" = "$msg" ]; then
  git commit -q --amend -m "$msg"
  git push --force-with-lease origin HEAD:gh-pages
else
  git commit -qm "$msg"
  git push origin HEAD:gh-pages
fi
echo "Pushed $folder."
