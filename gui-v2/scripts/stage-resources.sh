#!/usr/bin/env bash
# stage-resources.sh — pack the engine payload into gui-v2/bundle-staging/
# payload.tar.gz, which the AppImage unpacks into the user cache on first run.
#
# Why a tarball and not loose resources: linuxdeploy processes EVERY elf in the
# AppDir — it adds RUNPATHs and strips — which changed vendor/e9patch/*,
# vendor/aacadd and libcapstone.so.  Their hashes then no longer match
# SHA256SUMS, and the engine (rightly) refuses to patch with a modified
# payload.  linuxdeploy does not look inside a tarball.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUI="$HERE/.."
REPO="$GUI/.."
STAGE="$GUI/bundle-staging"

rm -rf "$STAGE"
mkdir -p "$STAGE/payload"
P="$STAGE/payload"
for name in aac-patch-tree aacpatch vendor prebuilt; do
    cp -a "$REPO/$name" "$P/$name"
done
find "$P" \( -name __pycache__ -o -name '*.pyc' \) -prune -exec rm -rf {} +

# Same checks and manifest as scripts/make-release.sh: the manifest describes
# the payload actually shipped (builds are not bit-reproducible, so the
# committed SHA256SUMS will not match a local build).
. "$REPO/scripts/versions.sh"
"$REPO/scripts/check-elf-compat.sh" "$MAX_GLIBC" \
    "$P/vendor/e9patch/e9patch" "$P/vendor/e9patch/e9tool"
MAX_GLIBC="$MAX_GLIBC" "$REPO/scripts/check-ffmpeg-libs.sh" "$P/prebuilt/ffmpeg-aac"
"$REPO/scripts/check-trampoline.sh" "$P/vendor/aacadd"
( cd "$P" && find vendor prebuilt -type f ! -name SHA256SUMS -print0 \
    | sort -z | xargs -0 sha256sum > SHA256SUMS )
( cd "$P" && sha256sum --quiet -c SHA256SUMS )

tar -czf "$STAGE/payload.tar.gz" -C "$P" .
echo "staged $STAGE/payload.tar.gz ($(du -h "$STAGE/payload.tar.gz" | cut -f1))"
