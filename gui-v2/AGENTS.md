# Wallace (gui-v2) — AGENTS.md

Fancy Tauri v2 + React + shadcn-style desktop GUI for resolve-aacfix,
replacing `gui/aacfix_gui.py` (Tk). Codename **Wallace** (Braveheart freedom
play). All patching stays in the `aac-patch-tree` engine; the Rust backend
only finds installs, reports state, and shells out to it.

## What was built

- `src/App.tsx` — single-window flow: install `Select` + Browse + **Detect**
  (manual only, no auto-detect on load) → Version / Patch-compatibility /
  AAC-decoder diagnostics → plain blue **Enable AAC** hero button → Restore
  (rendered only when a backup is detected) → confirm dialog → toast.
  Copy is user-facing throughout: "AAC disabled/enabled", no engine jargon,
  no terminal, no licensing footer.
- `src/components/ui/` — shadcn-style `button` (`hero` variant), `card`,
  `badge`, `alert`, `dialog`.
- `src/lib/backend.ts` — `invoke()` bridge with mock fallback for `npm run dev`.
  Split into `inspect_fast` (instant facts) + `inspect_compat` (slow scan) so
  the UI paints progressively.
- `src-tauri/src/main.rs` — commands `find_roots`, `inspect_fast`,
  `inspect_compat`, `engine_run`. Details that matter:
  - Engine resolved from bundled resources (`AppHandle.resource_dir()`),
    executed via `bash` (resources lose +x when bundled).
  - `check_sites` drops `PYTHONHOME` (AppImage runtime poisons system python3
    → `No module named 'encodings'`), sets `PYTHONPATH` to vendored pylibs,
    runs `ionice -c3 nice -n 10`, caches per binary fingerprint (dev+ino+size+mtime).
  - `resolve_version` streams 8MB chunks with early exit (was: whole 653MB read).
- `scripts/stage-resources.sh` — stages payload into `bundle-staging/` with
  **real SONAME file copies** (`libavutil.so.58`, …). Symlinks do NOT survive
  Tauri's resource copy, and linuxdeploy fatals on the missing SONAME otherwise.
- Icons + in-app logo: `assets/logo-source.jpeg` (hooded-knight "AAC" art) →
  `src-tauri/icons/*`, `src/assets/logo.png`.
- `tauri.conf.json`: `targets: ["appimage"]`, `beforeBundleCommand` runs the
  staging script, object-form `resources` map.

## Reproducible AppImage build

```sh
cd gui-v2
export NO_STRIP=1 \
  LD_LIBRARY_PATH="$PWD/bundle-staging/prebuilt/ffmpeg-aac:$LD_LIBRARY_PATH"
npx tauri build
# → src-tauri/target/release/bundle/appimage/Wallace_0.1.0_amd64.AppImage
```

Why the env vars (both are load-bearing, build fails without them):
- `LD_LIBRARY_PATH=…/bundle-staging/prebuilt/ffmpeg-aac` — linuxdeploy
  honors it when resolving the payload's own `libavutil.so.58` dependency.
- `NO_STRIP=1` — linuxdeploy's bundled `strip` predates `.relr.dyn` and
  fatals on modern Fedora system libs.
- Runtime needs: system `libwebkit2gtk-4.1`, `python3`; root/pkexec to write
  `/opt/resolve` (engine never self-escalates, same policy as `aac-fix`).

## OPEN PROBLEM: Detect busy UI invisible in AppImage

Browser (`npm run dev`, mock backend): spinner, "Detecting…", loading bar,
radar + scanline all animate. AppImage: press Detect → nothing visible →
result appears abruptly (incl. "Resolve is running" warning). Data path works;
only transient feedback is missed. User also reported the window "freezing".

Ranked hypotheses:
1. **I/O starvation stalls WebKitGTK frame production.** `locate_all`
   (`aacpatch/locate.py:37`) does `f.read()` of the full 653MB binary; on a
   cold cache this saturates I/O so no frames composite until it subsides
   (DOM updates are committed, just never painted). Supported by the
   freeze report. Mitigations landed (nice/ionice, in-proc cache) don't help
   a first cold scan and don't survive restarts.
2. **Stale binary under test.** Same `Wallace_0.1.0_amd64.AppImage` filename
   across ~8 builds; UI has no build stamp. Always confirm timestamp first.
3. **No paint flush.** `refresh()` awaits `invoke()` immediately after
   `setBusy(true)` without yielding to the renderer.

Next steps:
1. Stamp build time/git hash into the UI.
2. Instrument: timestamp each `refresh()` stage + count rAF frames during busy.
3. Double-rAF flush after `setBusy(true)`, before first `invoke`.
4. Cut I/O: `mmap` instead of `f.read()` in `locate.py`; persist compat cache
   across launches; verify nice/ionice apply in-AppImage.
5. Confirm test binary version + disk contention (Resolve running during scan).

## Reference measurements (dev machine)

`aac-patch-tree status` ≈ 0.3s · `locate_all` ≈ 2s warm · version = early exit.
