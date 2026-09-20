#!/usr/bin/env python3
"""AAC Fix for DaVinci Resolve (Linux) -- a one-window front end.

Finds your Resolve install, checks the fix will fit it (read-only), and applies
or restores it with one click.  It is only a front end: every write is done by
the same `aac-patch-tree` engine the command line uses, so the backups, the
"never patch twice" rule and the byte-for-byte restore all live in one place.

    aacfix_gui.py                 open the window
    aacfix_gui.py --detect        print what was found as JSON (no window)
"""
import glob
import io
import json
import mmap
import os
import queue
import re
import subprocess
import sys
import tarfile
import threading

# The package root holds aac-patch-tree, aacpatch/, vendor/, prebuilt/.  In a
# PyInstaller bundle that is the unpack dir; in a checkout it is the repo root.
PKG = getattr(sys, "_MEIPASS", None) or os.path.dirname(
    os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.join(PKG, "aac-patch-tree")
sys.path[:0] = [PKG, os.path.join(PKG, "vendor", "pylibs")]

ANSI = re.compile(r"\x1b\[[0-9;]*m")
SITE_OK = {"ORIGINAL", "PATCHED", "LOCATED"}
VERSION_RE = re.compile(rb"\b(\d{2}\.\d{1,2}\.\d{1,2}\.\d{4})\b")

# Root-owned scratch dir + payload streamed on stdin, so what runs as root is
# never read from a location the user (or another process) can rewrite.
ELEVATED = ('set -e; d=$(mktemp -d /tmp/aac-fix.XXXXXX); trap \'rm -rf "$d"\' EXIT; '
            'tar -xf - -C "$d"; "$d/aac-patch-tree" "$@"')


# ----------------------------------------------------------------- detection
def is_root(p):
    return (os.path.isfile(os.path.join(p, "bin", "resolve"))
            and os.path.isdir(os.path.join(p, "libs")))


def find_roots():
    cands = ["/opt/resolve", "/opt/DaVinciResolve", "/usr/lib/resolve",
             "~/.local/opt/DaVinciResolve", "~/.local/opt/resolve"]
    cands = [os.path.expanduser(c) for c in cands]
    for pid in filter(str.isdigit, os.listdir("/proc")):          # running Resolve
        try:
            exe = os.readlink(f"/proc/{pid}/exe").replace(" (deleted)", "")
        except OSError:
            continue
        if exe.endswith("/bin/resolve"):
            cands.append(exe[: -len("/bin/resolve")])
    for d in ("~/.local/share/applications", "/usr/share/applications"):
        for f in glob.glob(os.path.join(os.path.expanduser(d), "*[Rr]esolve*.desktop")):
            try:                                                   # menu entry -> launcher -> root
                exe = next(l[5:].split()[0] for l in open(f, errors="ignore")
                           if l.startswith("Exec="))
                for path in (exe, ):
                    txt = open(path, errors="ignore").read(4096) if os.path.getsize(path) < 4096 else path
                    cands += re.findall(r"(/[^\s\"']+)/bin/resolve", txt)
            except (OSError, StopIteration):
                pass
    seen, out = set(), []
    for c in cands:
        rp = os.path.realpath(c)
        if rp not in seen and is_root(rp):
            seen.add(rp)
            out.append(rp)
    return out


def resolve_version(root):
    try:
        with open(os.path.join(root, "bin", "resolve"), "rb") as f, \
                mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as m:
            hit = VERSION_RE.search(m)
            return hit.group(1).decode() if hit else "unknown"
    except OSError:
        return "unknown"


def running_pids(root):
    target = os.path.realpath(os.path.join(root, "bin", "resolve"))
    pids = []
    for pid in filter(str.isdigit, os.listdir("/proc")):
        try:
            exe = os.path.realpath(os.readlink(f"/proc/{pid}/exe").replace(" (deleted)", ""))
        except OSError:
            continue
        if exe == target or exe == target + ".aac-orig":
            pids.append(int(pid))
    return pids


def check_sites(root):
    """Read-only: can every patch site be found in this build?  (ok, detail)"""
    try:
        from aacpatch.locate import locate_all
        _, results = locate_all(os.path.join(root, "bin", "resolve"))
    except Exception as e:                                        # noqa: BLE001
        return False, f"could not analyse the binary ({e})"
    bad = [r["sig"].name for r in results if r["state"] not in SITE_OK]
    if bad:
        return False, f"{len(bad)} of {len(results)} patch sites not recognised"
    return True, f"all {len(results)} patch sites found"


def engine_status(root):
    p = subprocess.run([ENGINE, "status", root], capture_output=True, text=True)
    text = ANSI.sub("", p.stdout + p.stderr)
    m = re.search(r"AAC support:\s*(.+)", text)
    return (m.group(1).strip() if m else "unknown"), text


def inspect(root):
    ok, detail = check_sites(root)
    state, _ = engine_status(root)
    return {"root": root, "version": resolve_version(root), "compatible": ok,
            "compat_detail": detail, "aac_support": state,
            "backup": os.path.exists(os.path.join(root, "bin", "resolve.aac-orig")),
            "writable": os.access(os.path.join(root, "bin", "resolve"), os.W_OK)
            and os.access(os.path.join(root, "libs"), os.W_OK),
            "running": running_pids(root)}


# ----------------------------------------------------------------- engine
def payload_tar():
    """The engine + payload as a tar (owned by root) for the elevated run."""
    buf = io.BytesIO()

    def own(ti):
        ti.uid = ti.gid = 0
        ti.uname = ti.gname = "root"
        return None if "__pycache__" in ti.name or ti.name.endswith(".pyc") else ti

    with tarfile.open(fileobj=buf, mode="w") as t:
        for name in ("aac-patch-tree", "aacpatch", "vendor", "prebuilt", "SHA256SUMS"):
            if os.path.exists(os.path.join(PKG, name)):
                t.add(os.path.join(PKG, name), arcname=name, filter=own)
    return buf.getvalue()


def run_engine(action, root, elevate, emit):
    args = [action] + (["--originals", "keep"] if action == "apply" else []) + [root]
    if elevate:
        cmd = ["pkexec", "/bin/sh", "-c", ELEVATED, "sh"] + args
        emit("Administrator permission is needed to modify " + root + "\n")
    else:
        cmd = [ENGINE] + args
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=False)
    if elevate:
        try:
            p.stdin.write(payload_tar())
        except BrokenPipeError:
            pass                                    # auth cancelled / pkexec refused
    p.stdin.close()
    for line in p.stdout:
        emit(ANSI.sub("", line.decode(errors="replace")))
    return p.wait()


# ----------------------------------------------------------------- window
def main_window():
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    win = tk.Tk()
    win.title("AAC Fix for DaVinci Resolve")
    win.geometry("640x520")
    ui = queue.Queue()
    st = {"info": None, "busy": False}
    v = {k: tk.StringVar(value="-") for k in ("root", "version", "compat", "status", "warn")}

    f = ttk.Frame(win, padding=12)
    f.pack(fill="both", expand=True)
    ttk.Label(f, text="AAC audio for DaVinci Resolve on Linux",
              font=("TkDefaultFont", 13, "bold")).grid(row=0, column=0, columnspan=3, sticky="w")
    ttk.Label(f, text="Resolve install").grid(row=1, column=0, sticky="w", pady=(10, 0))
    combo = ttk.Combobox(f, textvariable=v["root"], state="readonly")
    combo.grid(row=1, column=1, sticky="ew", pady=(10, 0), padx=6)
    ttk.Button(f, text="Browse…", command=lambda: browse()).grid(row=1, column=2, pady=(10, 0))
    for i, (label, key) in enumerate((("Version", "version"), ("Fix fits this build", "compat"),
                                      ("AAC status", "status")), start=2):
        ttk.Label(f, text=label).grid(row=i, column=0, sticky="w")
        ttk.Label(f, textvariable=v[key]).grid(row=i, column=1, columnspan=2, sticky="w", padx=6)
    ttk.Label(f, textvariable=v["warn"], foreground="#b06000").grid(
        row=5, column=0, columnspan=3, sticky="w", pady=(4, 0))
    bar = ttk.Frame(f)
    bar.grid(row=6, column=0, columnspan=3, sticky="w", pady=8)
    b_apply = ttk.Button(bar, text="Apply fix", command=lambda: act("apply"))
    b_undo = ttk.Button(bar, text="Restore original", command=lambda: act("revert"))
    b_scan = ttk.Button(bar, text="Re-check", command=lambda: refresh())
    for b in (b_apply, b_undo, b_scan):
        b.pack(side="left", padx=(0, 6))
    log = tk.Text(f, height=14, state="disabled", wrap="word")
    log.grid(row=7, column=0, columnspan=3, sticky="nsew")
    f.columnconfigure(1, weight=1)
    f.rowconfigure(7, weight=1)
    ttk.Label(f, foreground="gray", wraplength=600, text=(
        "Studio edition, Linux x86-64. Blackmagic removed AAC for licensing reasons; whether "
        "re-enabling it suits your use (especially for distributed output) is your call. "
        "A backup is kept and \"Restore original\" undoes everything."
    )).grid(row=8, column=0, columnspan=3, sticky="w", pady=(8, 0))

    def write(text):
        log.configure(state="normal")
        log.insert("end", text)
        log.see("end")
        log.configure(state="disabled")

    def emit(text):
        ui.put(("log", text))

    def buttons():
        i = st["info"]
        idle = not st["busy"] and i is not None and not i["running"]
        b_apply.state(["!disabled"] if idle and i["compatible"] else ["disabled"])
        b_undo.state(["!disabled"] if idle and i["backup"] else ["disabled"])
        b_scan.state(["disabled"] if st["busy"] else ["!disabled"])

    def show(info):
        st["info"] = info
        v["version"].set(info["version"])
        v["compat"].set(("Yes — " if info["compatible"] else "No — ") + info["compat_detail"])
        v["status"].set(info["aac_support"])
        v["warn"].set("Close DaVinci Resolve first — it is running." if info["running"] else "")
        buttons()

    def work(fn, done=None):
        st["busy"] = True
        buttons()

        def go():
            try:
                res = fn()
            except Exception as e:                                # noqa: BLE001
                emit(f"\nError: {e}\n")
                res = None
            ui.put(("done", (done, res)))
        threading.Thread(target=go, daemon=True).start()

    def refresh():
        root = v["root"].get()
        if not is_root(root):
            return
        v["compat"].set("checking…")
        v["status"].set("checking…")
        work(lambda: inspect(root), show)

    def act(action):
        i = st["info"]
        msg = ("Apply the AAC fix to this Resolve install?\n\n" + i["root"] +
               "\n\nThe original files are kept so you can restore them." if action == "apply"
               else "Restore the original Resolve files?\n\n" + i["root"])
        if not messagebox.askokcancel("Confirm", msg):
            return
        write(f"\n--- {'Applying' if action == 'apply' else 'Restoring'} ---\n")
        work(lambda: run_engine(action, i["root"], not i["writable"], emit),
             lambda rc: (write("\nDone. Start Resolve normally.\n" if rc == 0
                               else f"\nFailed (exit {rc}). Nothing was left half-applied; "
                                    "see the messages above.\n"), refresh()))

    def browse():
        d = filedialog.askdirectory(title="Choose your DaVinci Resolve folder (contains bin/ and libs/)")
        if d and is_root(d):
            combo["values"] = sorted(set(combo["values"]) | {d})
            v["root"].set(d)
            refresh()
        elif d:
            messagebox.showerror("Not Resolve", "That folder has no bin/resolve and libs/.")

    def pump():
        try:
            while True:
                kind, data = ui.get_nowait()
                if kind == "log":
                    write(data)
                else:
                    st["busy"] = False
                    done, res = data
                    if done and res is not None:
                        done(res)
                    else:
                        buttons()
        except queue.Empty:
            pass
        win.after(100, pump)

    combo.bind("<<ComboboxSelected>>", lambda e: refresh())
    roots = find_roots()
    combo["values"] = roots
    if roots:
        v["root"].set(roots[0])
        refresh()
    else:
        write("No DaVinci Resolve found automatically. Use Browse… to pick its folder.\n")
    pump()
    return win


def main(argv):
    if "--detect" in argv:
        print(json.dumps([inspect(r) for r in find_roots()], indent=2))
        return 0
    main_window().mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
