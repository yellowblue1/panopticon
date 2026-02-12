import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva("inline-block text-xl leading-none cursor-default", {
  variants: {
    variant: {
      busy: "status-badge status-badge--busy",
      waiting: "status-badge status-badge--waiting",
    },
  },
  defaultVariants: {
    variant: "busy",
  },
});

interface StatusBadgeProps extends VariantProps<typeof badgeVariants> {
  className?: string;
}

export function StatusBadge({ variant = "busy", className }: StatusBadgeProps) {
  const label = variant === "busy" ? "Busy" : "Waiting";
  const icon = variant === "busy" ? "\u{1F4A6}" : "\u2615";

  return (
    <span className={cn(badgeVariants({ variant }), className)} title={label}>
      {icon}
    </span>
  );
}
