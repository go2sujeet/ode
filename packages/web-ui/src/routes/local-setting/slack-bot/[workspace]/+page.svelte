<script lang="ts">
	import LocalSettingPage from "../../+page.svelte";
	import { page } from "$app/stores";
	import type { DashboardConfig } from "$lib/localConfig";

	export let data: { config: DashboardConfig } | undefined = undefined;
</script>

<LocalSettingPage {data} initialSection="slack" initialSlug={$page.params.workspace ?? null} />
