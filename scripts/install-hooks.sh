#!/bin/sh
# Point this clone at the versioned hooks in .githooks/.
#
# Git does not carry hooks in the repository, so every clone has to opt in
# once. Run this after cloning:
#
#     ./scripts/install-hooks.sh
set -e
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"
git config core.hooksPath .githooks
echo "core.hooksPath -> .githooks"
echo "Active hooks:"
ls -1 .githooks | sed 's/^/  /'
