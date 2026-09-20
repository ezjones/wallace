// Backend bridge — Tauri invoke with browser fallback (mock).
// Mirrors gui/aacfix_gui.py inspect() shape, split fast/slow so the UI
// paints instantly and the signature scan streams in after.
import { invoke } from "@tauri-apps/api/core";

export type Inspect = {
  root: string;
  version: string;
  compatible: boolean | null; // null = signature scan still running
  compat_detail: string;
  aac_support: string;
  aac_detail: string;
  backup: boolean;
  writable: boolean;
  running: number[];
};

export type Compat = { compatible: boolean; compat_detail: string };

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const mock = {
  roots: ["/opt/resolve", `${"~"}/.local/opt/DaVinciResolve`],
  async inspectFast(root: string): Promise<Inspect> {
    await new Promise((r) => setTimeout(r, 250));
    const patched = root.includes(".local");
    return {
      root,
      version: "21.0.4.0004",
      compatible: null,
      compat_detail: "Scanning patch sites…",
      aac_support: patched ? "PATCHED" : "ORIGINAL",
      aac_detail: patched ? "aac enabled for .mp4/.mov/.m4a/.mkv" : "aac disabled in .mp4/.mov/.m4a/.mkv",
      backup: patched,
      writable: root.startsWith("/home") || root.startsWith("~"),
      running: [],
    };
  },
  async inspectCompat(): Promise<Compat> {
    await new Promise((r) => setTimeout(r, 1600));
    return { compatible: true, compat_detail: "12 / 12 sites located" };
  },
  async *runEngine(action: "apply" | "revert", root: string): AsyncGenerator<string> {
    const seq =
      action === "apply"
        ? [
            `Applying fix to ${root}…`,
            "locating 12 patch sites … OK",
            "installing trampolines (bin/resolve) … OK",
            "installing libav* replacements (4 sonames) … OK",
            "verifying backup bin/resolve.aac-orig … OK",
            "done — restart Resolve, AAC audio should decode.",
          ]
        : [
            `Restoring originals in ${root}…`,
            "restoring bin/resolve … OK",
            "restoring libs … OK",
            "done — originals restored byte-for-byte.",
          ];
    for (const l of seq) {
      await new Promise((r) => setTimeout(r, 260));
      yield l;
    }
  },
};

export const Backend = {
  inTauri,
  async findRoots(): Promise<string[]> {
    if (inTauri) return invoke<string[]>("find_roots");
    return mock.roots;
  },
  async inspectFast(root: string): Promise<Inspect> {
    if (inTauri) {
      const fast = await invoke<Omit<Inspect, "compatible" | "compat_detail">>("inspect_fast", { root });
      return { ...fast, compatible: null, compat_detail: "Scanning patch sites…" };
    }
    return mock.inspectFast(root);
  },
  async inspectCompat(root: string): Promise<Compat> {
    if (inTauri) return invoke<Compat>("inspect_compat", { root });
    return mock.inspectCompat();
  },
  async *runEngine(action: "apply" | "revert", root: string): AsyncGenerator<string> {
    if (!inTauri) {
      yield* mock.runEngine(action, root);
      return;
    }
    // MVP streaming: backend runs synchronously, returns full log.
    // Next step: Tauri Channel / events for line-by-line streaming.
    const out = await invoke<string>("engine_run", { action, root });
    for (const line of out.split("\n")) yield line;
  },
};
