import * as React from "react";
import { cn } from "@/lib/utils";
import { AlertTriangle, Info } from "lucide-react";

export function Alert({
  className,
  tone = "info",
  children,
}: {
  className?: string;
  tone?: "info" | "warning";
  children: React.ReactNode;
}) {
  const Icon = tone === "warning" ? AlertTriangle : Info;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-[13px] leading-relaxed",
        tone === "warning"
          ? "border-amber-400/25 bg-amber-400/[.07] text-amber-100"
          : "border-white/10 bg-white/[.03] text-zinc-300",
        className
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0 opacity-80" />
      <div>{children}</div>
    </div>
  );
}
