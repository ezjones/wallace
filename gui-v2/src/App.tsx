import { useCallback, useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  RotateCcw,
  RefreshCw,
  Zap,
  Check,
  Loader2,
  TriangleAlert,
  Radar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Dialog } from "@/components/ui/dialog";
import logo from "./assets/logo.png";
import { Backend, type Inspect } from "@/lib/backend";
import { cn } from "@/lib/utils";

type LogLine = { text: string; tone: "dim" | "std" | "ok" | "warn" | "err" | "cmd" };

function useBurst(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  return useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const x = c.getContext("2d");
    if (!x) return;
    c.width = innerWidth;
    c.height = innerHeight;
    const colors = ["#1f6feb", "#5aa9ff", "#9ecbff", "#cfe6ff", "#0d419d", "#79b8ff", "#ffffff"];
    const el = document.getElementById("cta-ring")?.getBoundingClientRect();
    const ox = el ? el.left + el.width / 2 : c.width / 2;
    const oy = el ? el.top + el.height / 2 : c.height / 2;
    const ps = Array.from({ length: 110 }, () => ({
      x: ox, y: oy,
      vx: (Math.random() - 0.5) * 11, vy: (Math.random() - 0.9) * 11,
      g: 0.28, s: 2 + Math.random() * 4,
      col: colors[(Math.random() * colors.length) | 0], l: 1,
    }));
    let f = 0;
    const t = () => {
      x.clearRect(0, 0, c.width, c.height);
      let alive = false;
      for (const p of ps) {
        if (p.l <= 0) continue;
        alive = true;
        p.x += p.vx; p.y += p.vy; p.vy += p.g; p.l -= 0.012;
        x.globalAlpha = Math.max(p.l, 0);
        x.fillStyle = p.col;
        x.fillRect(p.x, p.y, p.s, p.s);
      }
      if (alive && f++ < 160) requestAnimationFrame(t);
      else x.clearRect(0, 0, c.width, c.height);
    };
    t();
  }, []);
}

export default function App() {
  const [roots, setRoots] = useState<string[]>([]);
  const [root, setRoot] = useState("");
  const [info, setInfo] = useState<Inspect | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [confirm, setConfirm] = useState<"apply" | "revert" | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const burstCanvas = useRef<HTMLCanvasElement>(null);
  const burst = useBurst(burstCanvas);

  const push = (text: string, tone: LogLine["tone"] = "std") =>
    setLog((l) => [...l.slice(-400), { text, tone }]);

  const refresh = useCallback(
    async (r?: string) => {
      const target = r ?? root;
      if (!target) return;
      setBusy(true);
      try {
        // Fast facts paint instantly; the slow signature scan fills in after.
        setInfo(await Backend.inspectFast(target));
        try {
          const c = await Backend.inspectCompat(target);
          setInfo((i) => (i && i.root === target ? { ...i, ...c } : i));
        } catch (e) {
          setInfo((i) => (i && i.root === target
            ? { ...i, compatible: false, compat_detail: `compat check failed (${String(e)})` }
            : i));
        }
      } catch (e) {
        push(`Error: ${String(e)}`, "err");
      }
      setBusy(false);
    },
    [root]
  );

  useEffect(() => {
    (async () => {
      const rs = await Backend.findRoots().catch(() => [] as string[]);
      setRoots(rs);
      if (rs.length) {
        setRoot(rs[0]);
        push(`${rs.length} Resolve install(s) found.`, "dim");
      } else {
        push("No Resolve install found — use Browse.", "warn");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NOTE: no auto-detect — inspection only runs when the user presses Detect.

  useEffect(() => {
    logRef.current?.scrollTo({ top: 1e9 });
  }, [log]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const idle = !busy && info && info.running.length === 0;
  const canApply = !!(idle && info?.compatible);
  const canRevert = !!(idle && info?.backup);
  const patched = info?.aac_support === "PATCHED";

  async function act(action: "apply" | "revert") {
    if (!info) return;
    setConfirm(null);
    setBusy(true);
    push("");
    push(action === "apply" ? `--- Applying ---` : `--- Restoring ---`, "cmd");
    if (!info.writable) push(`elevating via polkit (pkexec) to write ${info.root}`, "warn");
    try {
      for await (const line of Backend.runEngine(action, info.root)) {
        const tone: LogLine["tone"] = /done|OK|ready/i.test(line)
          ? "ok"
          : line.startsWith("$")
            ? "cmd"
            : "std";
        push(line, tone);
      }
      if (action === "apply") burst();
      setToast(action === "apply" ? "AAC enabled — restart Resolve" : "Originals restored");
    } catch (e) {
      push(`Failed: ${String(e)}`, "err");
      setShakeKey((k) => k + 1);
    }
    setBusy(false);
    await refresh();
  }

  function ask(action: "apply" | "revert") {
    if ((action === "apply" && !canApply) || (action === "revert" && !canRevert)) {
      setShakeKey((k) => k + 1);
      return;
    }
    setConfirm(action);
  }

  return (
    <div className="relative mx-auto w-full max-w-[780px] px-5 py-12">
      <canvas ref={burstCanvas} id="burst" className="pointer-events-none fixed inset-0 z-50" />
      {/* bg — elegant black -> grey */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-black">
        <div className="absolute inset-0 bg-[radial-gradient(900px_480px_at_50%_-8%,rgba(255,255,255,.09),transparent_65%),radial-gradient(700px_500px_at_50%_115%,rgba(255,255,255,.05),transparent_60%),linear-gradient(180deg,#000_0%,#0b0c10_45%,#171a21_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.028)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.028)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(700px_500px_at_50%_30%,black_25%,transparent_75%)]" />
      </div>

      {/* header */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Wallace logo" className="size-10 rounded-xl border border-white/10 object-cover shadow-lg" />
          <div>
            <h1 className="text-[15px] font-bold tracking-tight">Wallace</h1>
            <p className="text-xs text-zinc-400">Add native AAC audio support in DaVinci Resolve</p>
            <p className="text-xs italic text-zinc-300">“They may take our lives, but they’ll never take our AAC!”</p>
          </div>
        </div>
      </div>

      <Card key={shakeKey} className={cn("shadow-[0_40px_120px_rgba(0,0,0,.7)]", shakeKey > 0 && "t-shake")}>
        <CardContent className="space-y-4 p-5 sm:p-6">
          {busy && (
            <div className="h-1 overflow-hidden rounded-full bg-white/[.06]" aria-hidden>
              <div className="h-full w-1/3 animate-[scanload_1.1s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-[#1f6feb] to-[#9ecbff]" />
            </div>
          )}
          {/* install picker */}
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[.12em] text-zinc-500">Resolve install</p>
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1">
                <select
                  value={root}
                  onChange={(e) => setRoot(e.target.value)}
                  disabled={busy}
                  className="w-full appearance-none rounded-xl border border-white/10 bg-[#080a11] px-3.5 py-2.5 text-[13.5px] font-medium outline-none transition focus:border-cyan-400/60 focus:ring-4 focus:ring-cyan-400/10 disabled:opacity-50"
                >
                  {roots.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                  {!roots.length && <option value="">—</option>}
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">▾</span>
              </div>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  const v = prompt("Resolve root (contains bin/ and libs/):", "/opt/resolve");
                  if (!v) return;
                  setRoots((p) => (p.includes(v) ? p : [...p, v]));
                  setRoot(v);
                }}
              >
                <FolderOpen /> Browse
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => refresh()} title="Detect and check this install">
                {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} {busy ? "Detecting…" : "Detect"}
              </Button>
            </div>
          </div>

          {/* diagnostics — fast facts paint first, compat scan sweeps in */}
          <div className="relative grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-white/[.08] bg-white/[.06] sm:grid-cols-3">
            {busy && info && <div className="scanline" />}
            {[
              { label: "Version", body: <span key={info?.version ?? "none"} className="t-swap font-mono text-[13px]">{info?.version ?? "—"}</span> },
              {
                label: "Patch compatibility",
                body: info?.compatible != null ? (
                  <span key={String(info.compatible)} className="t-swap">
                    <Badge variant={info.compatible ? "success" : "destructive"}>
                      {info.compatible ? <Check /> : <TriangleAlert />} {info.compatible ? "Fits this build" : "Not recognised"}
                    </Badge>
                    <span className="mt-1 block break-all font-mono text-[11.5px] text-zinc-500">{info.compat_detail}</span>
                  </span>
                ) : info ? (
                  <span className="flex items-center gap-2 text-[13px] font-semibold text-zinc-300">
                    <Radar className="size-4 animate-pulse text-sky-400" />
                    <span className="t-shimmer">scanning…</span>
                  </span>
                ) : busy ? <span className="t-shimmer text-[13px] font-semibold">checking…</span>
                  : <span className="text-[13px] text-zinc-600">Press Detect</span>,
              },
              {
                label: "AAC decoder",
                body: info ? (
                  <span key={info.aac_support} className="t-swap">
                    <Badge variant={patched ? "success" : "destructive"}>
                      {patched ? <Check /> : <Zap />} {patched ? "AAC enabled" : "AAC disabled"}
                    </Badge>
                    <span className="mt-1 block break-all font-mono text-[11.5px] text-zinc-500">{info.aac_detail}</span>
                  </span>
                ) : busy ? <span className="t-shimmer text-[13px] font-semibold">checking…</span>
                  : <span className="text-[13px] text-zinc-600">Press Detect</span>,
              },
            ].map((c) => (
              <div key={c.label} className="min-w-0 bg-[#0e1016] p-3.5">
                <h4 className="mb-2 text-[11px] font-bold uppercase tracking-[.1em] text-zinc-500">{c.label}</h4>
                {c.body}
              </div>
            ))}
          </div>

          {info && info.running.length > 0 && (
            <Alert tone="warning">Resolve is running (pid {info.running.join(", ")}) — close it before applying or restoring.</Alert>
          )}

          {/* hero CTA */}
          <div className="relative px-2 pb-1 pt-4 text-center">
            <Button variant="hero" size="hero" disabled={!canApply} onClick={() => ask("apply")}>
              {busy ? <Loader2 className="animate-spin" /> : <Zap />}
              {busy ? "Working" : patched ? "AAC enabled" : "Enable AAC"}
            </Button>
            <p className="mt-3.5 text-xs text-zinc-500">
              Native AAC support in Resolve — <span className="font-semibold text-zinc-200">no conversion needed</span>
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            {canRevert && (
              <Button variant="secondary" onClick={() => ask("revert")} className="border-emerald-400/25">
                <RotateCcw /> Restore original
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* confirm dialog — transitions.dev modal */}
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === "apply" ? "Enable AAC?" : "Restore originals?"}
        description={
          confirm === "apply"
            ? `Patch ${info?.root} with trampolines + replacement libs. A verified backup is kept.`
            : `Restore byte-for-byte originals in ${info?.root}.`
        }
      >
        <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
        <Button variant={confirm === "apply" ? "default" : "destructive"} onClick={() => confirm && act(confirm)}>
          {confirm === "apply" ? "Enable AAC" : "Restore"}
        </Button>
      </Dialog>

      {/* toast — transitions.dev toast */}
      {toast && (
        <div className="t-toast-in fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-emerald-400/25 bg-[#0c1512]/95 py-2.5 pl-3 pr-5 shadow-2xl backdrop-blur">
          <span className="grid size-6 place-items-center rounded-full bg-emerald-400/15">
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="#34d399" strokeWidth="3">
              <path d="M4 12.5l5 5L20 6.5" className="check-draw" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-[13px] font-semibold text-emerald-100">{toast}</span>
        </div>
      )}
    </div>
  );
}
