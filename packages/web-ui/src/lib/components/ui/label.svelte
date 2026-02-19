<script lang="ts">
  import { cn } from "$lib/utils";

  export let className = "";
</script>

<label class={cn("text-sm font-medium leading-none", className)} {...$$restProps}>
  <slot />
</label>
