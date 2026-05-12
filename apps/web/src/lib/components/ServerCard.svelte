<script lang="ts">
	import { Play, Square, Pencil, Globe, Hash, Box, Tag } from 'lucide-svelte';
	import type { ServerCardData } from '$lib/api/types';

	interface Props {
		server: ServerCardData;
		onstart: (id: string) => void;
		onstop: (id: string) => void;
		starting?: boolean;
		stopping?: boolean;
	}

	let { server, onstart, onstop, starting = false, stopping = false }: Props = $props();

	const statusColor = $derived(
		server.status === 'running'
			? 'var(--color-semantic-success)'
			: server.status === 'crashed'
				? 'var(--color-semantic-error)'
				: 'var(--color-text-muted)'
	);

	const statusLabel = $derived(
		server.status === 'running'
			? 'Running'
			: server.status === 'crashed'
				? 'Crashed'
				: 'Stopped'
	);

	const isRunning = $derived(server.status === 'running');
	const isBusy = $derived(starting || stopping);
</script>

<div
	class="dl-card dl-hover-card theme-bg-card flex flex-col border-2 p-5"
	style="border-color: var(--color-surface-border);"
>
	<div class="mb-4 flex items-start justify-between">
		<h3
			class="theme-heading text-base leading-tight"
			style="color: var(--color-text-primary);"
		>
			{server.name}
		</h3>
		<div class="flex items-center gap-1.5">
			<span
				class="inline-block h-2 w-2 rounded-full"
				style="background-color: {statusColor};"
			></span>
			<span
				class="theme-mono text-xs"
				style="color: {statusColor};"
			>
				{statusLabel}
			</span>
		</div>
	</div>

	<div class="mb-4 space-y-2">
		<div class="flex items-center gap-2">
			<Globe size={14} style="color: var(--color-text-muted);" />
			<span class="theme-body text-sm" style="color: var(--color-text-secondary);">
				{server.worldName || '--'}
			</span>
		</div>
		<div class="flex items-center gap-2">
			<Hash size={14} style="color: var(--color-text-muted);" />
			<span class="theme-mono text-sm" style="color: var(--color-text-secondary);">
				{server.port || '--'}
			</span>
		</div>
		<div class="flex items-center gap-2">
			<Box size={14} style="color: var(--color-text-muted);" />
			<span class="theme-body text-sm" style="color: var(--color-text-secondary);">
				{server.minecraftVersion || '--'}
			</span>
		</div>
		<div class="flex items-center gap-2">
			<Tag size={14} style="color: var(--color-text-muted);" />
			<span class="theme-body text-sm" style="color: var(--color-text-secondary);">
				{server.serverBrand || '--'}
			</span>
		</div>
	</div>

	<div class="mt-auto flex items-center gap-2">
		<button
			class="dl-btn dl-hover-btn flex items-center gap-1.5 px-3 py-1.5 text-sm"
			style="
				background-color: {isRunning ? 'var(--color-semantic-error)' : 'var(--color-semantic-success)'};
				color: var(--color-text-inverse);
			"
			disabled={isBusy}
			onclick={() => isRunning ? onstop(server.id) : onstart(server.id)}
		>
			{#if isRunning}
				<Square size={14} />
			{:else}
				<Play size={14} />
			{/if}
		</button>
		<button
			class="dl-btn dl-hover-btn flex items-center gap-1.5 px-3 py-1.5 text-sm"
			style="
				background-color: var(--color-surface-background-alt);
				color: var(--color-text-secondary);
				border: 1px solid var(--color-surface-border);
			"
		>
			<Pencil size={14} />
		</button>
	</div>
</div>
