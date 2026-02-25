<script lang="ts">
  import { cn } from "$lib/utils";

  export let className = "";
</script>

<section
  class={cn(
    "rounded-xl bg-[rgba(229,229,229,0.07)] text-[hsl(var(--card-foreground))] shadow-[0_4px_30px_rgba(0,0,0,0.1)] [backdrop-filter:blur(6.8px)] [-webkit-backdrop-filter:blur(6.8px)]",
    className
  )}
  {...$$restProps}
>
  <slot />
</section>
