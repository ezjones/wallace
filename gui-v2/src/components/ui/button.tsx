import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-white text-black shadow hover:bg-white/85 active:scale-[.98]",
        secondary: "border border-white/12 bg-white/[.05] text-zinc-100 hover:bg-white/10 active:scale-[.98]",
        ghost: "text-zinc-300 hover:bg-white/[.06] hover:text-white",
        outline: "border border-white/12 bg-transparent hover:bg-white/[.05]",
        destructive: "border border-red-400/30 bg-red-500/10 text-red-200 hover:bg-red-500/20",
        // hero CTA — plain blue button in the middle
        hero: "bg-[#1f6feb] text-white font-semibold hover:bg-[#1a63d6] active:scale-[.99]",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3 text-[13px] rounded-lg",
        lg: "h-11 px-6",
        hero: "h-auto px-14 py-[18px] text-[15px] rounded-full",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
Button.displayName = "Button";

export { Button, buttonVariants };
