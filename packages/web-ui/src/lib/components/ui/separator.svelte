<script lang="ts">
  import { cn } from "$lib/utils";

  export let orientation: "horizontal" | "vertical" = "horizontal";
  export let className = "";
</script>

<div
  class={cn(
    "shrink-0 bg-[hsl(var(--border))]",
    orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
    className
  )}
  role="separator"
  aria-orientation={orientation}
></div>
