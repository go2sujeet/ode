<script lang="ts">
	import { page } from "$app/stores";
	import LocalSettingPage from "../../+page.svelte";
	import type { DashboardConfig } from "$lib/localConfig";

	export let data: { config: DashboardConfig } | undefined = undefined;

	$: workspaceSlug = $page.params.workspace ?? null;
</script>

<LocalSettingPage {data} initialSection="slack" initialSlug={workspaceSlug} />
