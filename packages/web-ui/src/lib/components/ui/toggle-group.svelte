<script lang="ts">
  import { cn } from "$lib/utils";

  type ToggleItem = {
    value: string;
    label: string;
  };

  export let items: ToggleItem[] = [];
  export let value = "";
  export let disabled = false;
  export let className = "";
  export let onValueChange: ((nextValue: string) => void) | undefined = undefined;

  function select(nextValue: string): void {
    if (disabled || nextValue === value) return;
    value = nextValue;
    onValueChange?.(nextValue);
  }
</script>

<div class={cn("inline-flex items-center rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.35)] p-1", className)} role="group" aria-disabled={disabled}>
  {#each items as item}
    <button
      type="button"
      class={cn(
        "inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors",
        value === item.value
          ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
          : "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
      )}
      aria-pressed={value === item.value}
      disabled={disabled}
      onclick={() => select(item.value)}
    >
      {item.label}
    </button>
  {/each}
</div>
