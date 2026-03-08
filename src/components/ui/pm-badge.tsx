import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const pmBadgeVariants = cva(
  "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-muted text-muted-foreground",
        success: "bg-success/10 text-success",
        warning: "bg-warning/10 text-warning",
        info: "bg-info/10 text-info",
        purple: "bg-purple/10 text-purple",
        high: "bg-success/10 text-success",
        medium: "bg-info/10 text-info",
        low: "bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface PMBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pmBadgeVariants> {}

function PMBadge({ className, variant, ...props }: PMBadgeProps) {
  return (
    <span className={cn(pmBadgeVariants({ variant }), className)} {...props} />
  );
}

export { PMBadge, pmBadgeVariants };
