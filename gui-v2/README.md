# Wallace (resolve-aacfix fancy GUI — Tauri v2 + React + shadcn + transitions.dev)

Prototype replacing `gui/aacfix_gui.py` (Tk) with a Tauri desktop app.
The Rust backend is a thin wrapper — all patching stays in `aac-patch-tree`.

## Layout

- `src/` — Vite + React + Tailwind v4 frontend
  - `components/ui/` — shadcn-style components (`button` with `rainbow` variant,
    `card`, `badge`, `alert`, `dialog`)
  - `lib/backend.ts` — `invoke()` bridge with browser mock fallback
  - `globals.css` — Tailwind + transitions.dev snippets
    (`t-swap`, `t-toast-in`, `t-modal-in`, `t-shake`, `t-shimmer`, check draw)
- `src-tauri/` — `find_roots` / `inspect` / `engine_run` commands (shell out
  to `../../aac-patch-tree`, `check_sites` via `aacpatch.locate`)
- `legacy-concept.html` — previous vanilla-HTML concept

## Run

```sh
cd gui-v2
npm install
npm run dev          # web preview (mock backend)
npx tauri dev        # real app (needs system webkit2gtk on Linux)
npx tauri build
```

Linux webview deps (Fedora): `sudo dnf install webkit2gtk4.1-devel gtk3-devel`.
Debian/Ubuntu: `libwebkit2gtk-4.1-dev libgtk-3-dev`.

Elevation: writing `/opt/resolve` needs root — launch the app elevated
or via pkexec; the engine never escalates itself (same policy as `aac-fix`).
