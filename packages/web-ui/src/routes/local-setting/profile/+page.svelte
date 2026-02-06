<script lang="ts">
	import LocalSettingPage from "../+page.svelte";
	import type { DashboardConfig } from "$lib/localConfig";

	export let data: { config: DashboardConfig } | undefined = undefined;
</script>

<LocalSettingPage {data} />
