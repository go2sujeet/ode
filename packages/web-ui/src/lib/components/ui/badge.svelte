<script lang="ts">
  import { cva, type VariantProps } from "class-variance-authority";
  import { cn } from "$lib/utils";

  const badgeVariants = cva(
    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
    {
      variants: {
        variant: {
          default: "border-transparent bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]",
          secondary: "border-transparent bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]",
          success: "border-transparent bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))]",
          outline: "text-[hsl(var(--foreground))]",
          destructive: "border-transparent bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]"
        }
      },
      defaultVariants: {
        variant: "default"
      }
    }
  );

  type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

  export let variant: BadgeVariant = "default";
  export let className = "";
</script>

<span class={cn(badgeVariants({ variant }), className)} {...$$restProps}>
  <slot />
</span>
