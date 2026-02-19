<script lang="ts">
  import { cn } from "$lib/utils";

  export let className = "";
</script>

<select
  class={cn(
    "flex h-10 w-full rounded-md border bg-[hsl(var(--background))] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
    className
  )}
  {...$$restProps}
>
  <slot />
</select>
