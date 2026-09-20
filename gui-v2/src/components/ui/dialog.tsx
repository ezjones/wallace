import * as React from "react";
import { cn } from "@/lib/utils";

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="t-modal-bg absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal
        className="t-modal-in relative w-full max-w-md rounded-2xl border border-white/10 bg-[#12141d] p-6 shadow-2xl"
      >
        <h2 className="text-[15px] font-bold">{title}</h2>
        {description && <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">{description}</p>}
        <div className={cn("mt-5 flex justify-end gap-2")}>{children}</div>
      </div>
    </div>
  );
}
