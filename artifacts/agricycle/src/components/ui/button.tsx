import * as React from "react"
import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "secondary" | "outline" | "ghost" | "link" | "accent"
  size?: "default" | "sm" | "lg" | "icon"
  isLoading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", isLoading, children, disabled, ...props }, ref) => {
    const variants = {
      default: "bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/90 hover:shadow-lg hover:-translate-y-0.5",
      secondary: "bg-secondary text-secondary-foreground shadow-md shadow-secondary/20 hover:bg-secondary/90 hover:shadow-lg hover:-translate-y-0.5",
      accent: "bg-accent text-accent-foreground shadow-md shadow-accent/20 hover:bg-accent/90 hover:shadow-lg hover:-translate-y-0.5",
      outline: "border-2 border-primary/20 bg-transparent text-primary hover:bg-primary/5 hover:border-primary/40",
      ghost: "hover:bg-primary/10 text-primary hover:text-primary",
      link: "text-primary underline-offset-4 hover:underline",
    }
    
    const sizes = {
      default: "h-11 px-6 py-2",
      sm: "h-9 rounded-md px-4 text-xs",
      lg: "h-14 rounded-xl px-10 text-lg",
      icon: "h-11 w-11",
    }

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(
          "inline-flex items-center justify-center rounded-lg font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {children}
      </button>
    )
  }
)
Button.displayName = "Button"

export { Button }
