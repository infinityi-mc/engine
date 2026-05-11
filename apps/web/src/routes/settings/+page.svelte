<script lang="ts">
	import { getEngineUrl, setEngineUrl, clearEngineUrl } from '$lib/config/engine-url';
	import { setToken, clearToken } from '$lib/api/client';

	let engineUrl = $state(getEngineUrl());
	let token = $state('');
	let saved = $state(false);

	function handleSave() {
		if (engineUrl.trim()) {
			setEngineUrl(engineUrl.trim());
		} else {
			clearEngineUrl();
		}

		if (token.trim()) {
			setToken(token.trim());
		} else {
			clearToken();
		}

		saved = true;
		setTimeout(() => (saved = false), 2000);
	}
</script>

<div class="mx-auto max-w-2xl">
	<h1
		class="mb-2 text-2xl font-bold"
		style="
			font-family: var(--font-heading-family);
			color: var(--color-text-primary);
		"
	>
		Settings
	</h1>
	<p
		class="mb-8 text-sm"
		style="
			font-family: var(--font-body-family);
			color: var(--color-text-secondary);
		"
	>
		Configure the engine server connection.
	</p>

	<div
		class="rounded-md border-2 p-6"
		style="
			background-color: var(--color-surface-card);
			border-color: var(--color-surface-border);
			box-shadow: var(--layout-shadows-md);
		"
	>
		<div class="mb-6">
			<label
				for="engine-url"
				class="mb-2 block text-sm font-semibold"
				style="color: var(--color-text-primary); font-family: var(--font-body-family);"
			>
				Engine Server URL
			</label>
			<input
				id="engine-url"
				type="text"
				bind:value={engineUrl}
				placeholder="/api (uses Vite proxy) or http://localhost:3000"
				class="w-full rounded-md border-2 px-3 py-2 text-sm outline-none"
				style="
					background-color: var(--color-surface-background-alt);
					border-color: var(--color-surface-border);
					color: var(--color-text-primary);
					font-family: var(--font-mono-family);
				"
			/>
			<p class="mt-1 text-xs" style="color: var(--color-text-muted);">
				Default: <code style="font-family: var(--font-mono-family);">/api</code> (proxied to localhost:3000 in dev).
				Set to <code style="font-family: var(--font-mono-family);">http://localhost:3000</code> for direct access.
			</p>
		</div>

		<div class="mb-6">
			<label
				for="jwt-token"
				class="mb-2 block text-sm font-semibold"
				style="color: var(--color-text-primary); font-family: var(--font-body-family);"
			>
				JWT Token
			</label>
			<input
				id="jwt-token"
				type="password"
				bind:value={token}
				placeholder="Enter your JWT token"
				class="w-full rounded-md border-2 px-3 py-2 text-sm outline-none"
				style="
					background-color: var(--color-surface-background-alt);
					border-color: var(--color-surface-border);
					color: var(--color-text-primary);
					font-family: var(--font-mono-family);
				"
			/>
		</div>

		<div class="flex items-center gap-3">
			<button
				onclick={handleSave}
				class="rounded-md border-2 px-4 py-2 text-sm font-semibold transition-colors"
				style="
					background-color: var(--color-primary);
					border-color: var(--color-primary-dark);
					color: var(--color-text-inverse);
					font-family: var(--font-body-family);
				"
			>
				Save
			</button>
			{#if saved}
				<span class="text-sm" style="color: var(--color-semantic-success); font-family: var(--font-body-family);">
					Saved
				</span>
			{/if}
		</div>
	</div>
</div>
