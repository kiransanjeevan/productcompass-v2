import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

const pmButtonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 rounded-sm",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary:
          "bg-background border border-border text-secondary-foreground hover:bg-secondary-bg hover:border-border-hover",
        ghost:
          "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
        danger:
          "bg-error text-error-foreground hover:opacity-90",
        google:
          "bg-background border border-border text-foreground hover:bg-secondary-bg font-medium",
        hero:
          "bg-primary text-primary-foreground hover:bg-primary-hover shadow-lg hover:shadow-xl hover:-translate-y-0.5",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface PMButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof pmButtonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const PMButton = React.forwardRef<HTMLButtonElement, PMButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(pmButtonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </Comp>
    );
  }
);
PMButton.displayName = "PMButton";

export { PMButton, pmButtonVariants };
