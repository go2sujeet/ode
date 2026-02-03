<script lang="ts">
	import { page } from "$app/stores";
	import LocalSettingPage from "../../+page.svelte";

	export let data;

	$: workspaceSlug = $page.params.workspace ?? null;
</script>

<LocalSettingPage {data} initialSection="slack" initialSlug={workspaceSlug} />
