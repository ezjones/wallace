#!/usr/bin/env bash
# stage-resources.sh — copy the engine payload into gui-v2/bundle-staging/
# with SONAME symlinks added, so linuxdeploy can resolve bundled .so deps.
#
# Background: prebuilt/ffmpeg-aac ships versioned files only
# (libavutil.so.58.2.100, no libavutil.so.58 symlink). The release tarball is
# fine with that, but linuxdeploy deploys dependencies of EVERY elf in the
# AppDir — including our payload — and fails on the missing SONAME name.
# We must not touch the repo's prebuilt/ (SHA256SUMS covers it), so we stage
# a copy with the symlinks added.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUI="$HERE/.."
REPO="$GUI/.."
STAGE="$GUI/bundle-staging"

rm -rf "$STAGE"
mkdir -p "$STAGE"
for name in aac-patch-tree aacpatch vendor prebuilt SHA256SUMS; do
    cp -a "$REPO/$name" "$STAGE/$name"
done

# libfoo.so.60.3.100 -> real copy as libfoo.so.60 (SONAME).
# NOTE: real copies, not symlinks — Tauri drops symlinks when copying
# resources into the bundle, which broke linuxdeploy dependency resolution.
find "$STAGE" -type f -name '*.so.*.*' | while read -r f; do
    base="$(basename "$f")"
    soname="$(printf '%s' "$base" | grep -o '.*\.so\.[0-9][0-9]*')"
    cp "$f" "$(dirname "$f")/$soname"
done

echo "staged resources in $STAGE"
