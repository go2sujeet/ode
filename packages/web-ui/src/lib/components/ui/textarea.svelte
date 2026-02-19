<script lang="ts">
  import { cn } from "$lib/utils";

  export let className = "";
</script>

<textarea
  class={cn(
    "flex min-h-[96px] w-full rounded-md border bg-[hsl(var(--background))] px-3 py-2 text-sm ring-offset-[hsl(var(--background))] placeholder:text-[hsl(var(--muted-foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
    className
  )}
  {...$$restProps}
></textarea>
