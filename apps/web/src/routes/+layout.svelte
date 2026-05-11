<script lang="ts">
	import '../app.css';
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import { page } from '$app/state';

	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30_000,
				retry: 1
			}
		}
	});

	const navItems = [
		{ href: '/', label: 'Overview', icon: 'grid' },
		{ href: '/logs', label: 'Logs', icon: 'terminal' },
		{ href: '/agent', label: 'Agent', icon: 'bot' },
		{ href: '/settings', label: 'Settings', icon: 'sliders' }
	];

	let { children } = $props();
</script>

<QueryClientProvider client={queryClient}>
	<div class="flex h-screen overflow-hidden">
		<aside
			class="flex w-56 flex-col border-r-2"
			style="
				background-color: var(--color-surface-card);
				border-color: var(--color-surface-border);
			"
		>
			<div
				class="flex items-center gap-2 px-4 py-4"
				style="border-bottom: 2px solid var(--color-surface-border);"
			>
				<span
					class="text-lg font-bold"
					style="
						font-family: var(--font-heading-family);
						color: var(--color-primary);
					"
				>
					engine
				</span>
				<span
					class="rounded-sm px-1.5 py-0.5 text-xs font-semibold"
					style="
						background-color: var(--color-surface-background-alt);
						color: var(--color-text-muted);
						border: 1px solid var(--color-surface-border);
					"
				>
					web
				</span>
			</div>

			<nav class="flex-1 px-2 py-3">
				{#each navItems as item}
					{@const active = page.url.pathname === item.href}
					<a
						href={item.href}
						class="mb-1 flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
						style="
							font-family: var(--font-body-family);
							color: {active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'};
							background-color: {active ? 'var(--color-surface-background-alt)' : 'transparent'};
							{active ? 'border: 1px solid var(--color-surface-border);' : 'border: 1px solid transparent;'}
						"
					>
						<span
							class="inline-block h-4 w-4 rounded-sm"
							style="
								background-color: {active ? 'var(--color-primary)' : 'var(--color-text-muted)'};
							"
						></span>
						{item.label}
					</a>
				{/each}
			</nav>

			<div
				class="px-4 py-3"
				style="border-top: 1px solid var(--color-surface-border);"
			>
				<div class="flex items-center gap-2">
					<span
						class="inline-block h-2 w-2 rounded-full"
						style="background-color: var(--color-semantic-success);"
					></span>
					<span class="text-xs" style="color: var(--color-text-muted);">
						localhost:3000
					</span>
				</div>
			</div>
		</aside>

		<main
			class="flex-1 overflow-y-auto p-6"
			style="background-color: var(--color-surface-background);"
		>
			{@render children()}
		</main>
	</div>
</QueryClientProvider>
