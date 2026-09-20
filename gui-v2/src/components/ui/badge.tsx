import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-white/10 bg-white/[.06] text-zinc-200",
        success: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
        destructive: "border-red-400/30 bg-red-500/10 text-red-300",
        warning: "border-amber-400/30 bg-amber-400/10 text-amber-200",
        info: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
