<script lang="ts">
	import { page } from "$app/stores";
	import LocalSettingPage from "../../+page.svelte";

	export let data;

	$: serverSlug = $page.params.server ?? null;
</script>

<LocalSettingPage {data} initialSection="dev" initialSlug={serverSlug} />
