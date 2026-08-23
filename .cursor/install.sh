#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for the Connex Lerna monorepo.
# Installs root tooling, per-package dependencies, links local packages,
# and builds every package so cross-package imports resolve.
set -euo pipefail

cd "$(dirname "$0")/.."

# Root dev tooling (typescript, eslint, lerna, ts-node) from the committed lockfile.
npm ci

# Install each package's own dependencies and symlink the local @vechain/* packages.
npx lerna bootstrap

# Build all packages in dependency order (produces dist/ and esm/ consumed via symlinks).
npx lerna run build

# `lerna bootstrap` rewrites the committed per-package package-lock.json files because
# they are stale (they predate the current 2.1.0 package versions). Restore them so
# repeated installs stay idempotent and leave the working tree clean. Only the tracked
# lockfiles are touched; node_modules and build output are left in place.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git checkout -- packages/connex/package-lock.json \
        packages/driver/package-lock.json \
        packages/framework/package-lock.json \
        packages/repl/package-lock.json 2>/dev/null || true
fi
