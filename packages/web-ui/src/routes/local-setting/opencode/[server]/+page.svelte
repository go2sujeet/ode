<script lang="ts">
	import { page } from "$app/stores";
	import LocalSettingPage from "../../+page.svelte";
	import type { DashboardConfig } from "$lib/localConfig";

	export let data: { config: DashboardConfig } | undefined = undefined;

	$: serverSlug = $page.params.server ?? null;
</script>

<LocalSettingPage {data} initialSection="dev" initialSlug={serverSlug} />
