<script lang="ts">
  import { cva, type VariantProps } from "class-variance-authority";
  import { cn } from "$lib/utils";

  const buttonVariants = cva(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[hsl(var(--ring))] disabled:pointer-events-none disabled:opacity-50 ring-offset-[hsl(var(--background))]",
    {
      variants: {
        variant: {
          default: "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90",
          secondary: "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] hover:bg-[hsl(var(--secondary)/0.8)]",
          outline: "border bg-transparent text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]",
          ghost: "hover:bg-[hsl(var(--muted))]",
          destructive: "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] hover:opacity-90"
        },
        size: {
          default: "h-10 px-4 py-2",
          sm: "h-8 rounded-md px-3 text-xs",
          lg: "h-11 rounded-md px-8",
          icon: "h-10 w-10"
        }
      },
      defaultVariants: {
        variant: "default",
        size: "default"
      }
    }
  );

  type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
  type ButtonSize = VariantProps<typeof buttonVariants>["size"];

  export let variant: ButtonVariant = "default";
  export let size: ButtonSize = "default";
  export let className = "";
</script>

<button class={cn(buttonVariants({ variant, size }), className)} {...$$restProps}>
  <slot />
</button>
