<script lang="ts">
	import { useServers, useServerInstances } from '$lib/api/queries';
	import type { ServerInstance } from '$lib/api/types';
	import ServerListItem from '$lib/components/ServerListItem.svelte';

	const servers = useServers();
	const instances = useServerInstances();

	$effect(() => {
		console.log('[Overview] servers state:', {
			isLoading: servers.isLoading,
			isError: servers.isError,
			error: servers.error,
			data: servers.data
		});
	});

	function getInstanceStatus(instances: ServerInstance[] | undefined, serverId: string) {
		return instances?.find((i) => i.id === serverId);
	}
</script>

<div class="mx-auto max-w-5xl">
	<h1
		class="mb-2 text-2xl font-bold"
		style="
			font-family: var(--font-heading-family);
			color: var(--color-text-primary);
		"
	>
		Overview
	</h1>
	<p
		class="mb-8 text-sm"
		style="
			font-family: var(--font-body-family);
			color: var(--color-text-secondary);
		"
	>
		Server instances at a glance.
	</p>

	{#if servers.isLoading}
		<div
			class="rounded-md border-2 p-6"
			style="
				background-color: var(--color-surface-card);
				border-color: var(--color-surface-border);
				box-shadow: var(--layout-shadows-md);
			"
		>
			<p style="color: var(--color-text-muted); font-family: var(--font-body-family);">
				Loading servers...
			</p>
		</div>
	{:else if servers.isError}
		<div
			class="rounded-md border-2 p-6"
			style="
				background-color: var(--color-semantic-error-light);
				border-color: var(--color-semantic-error);
				box-shadow: var(--layout-shadows-md);
			"
		>
			<p class="mb-2" style="color: var(--color-semantic-error); font-family: var(--font-body-family);">
				Failed to load servers
			</p>
			<p class="theme-mono text-sm" style="color: var(--color-text-muted);">
				{servers.error?.message ?? 'Unknown error'}
			</p>
		</div>
	{:else if !servers.data?.length}
		<div
			class="rounded-md border-2 p-6"
			style="
				background-color: var(--color-surface-card);
				border-color: var(--color-surface-border);
				box-shadow: var(--layout-shadows-md);
			"
		>
			<p style="color: var(--color-text-muted); font-family: var(--font-body-family);">
				No servers added yet.
			</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
			{#each servers.data as server (server.id)}
				{@const instance = getInstanceStatus(instances.data, server.id)}
				<ServerListItem
					serverId={server.id}
					serverName={server.name}
					{instance}
				/>
			{/each}
		</div>
	{/if}
</div>
