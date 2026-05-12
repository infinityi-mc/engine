<script lang="ts">
	import { useServerMetadata, useStartServer, useStopServer } from '$lib/api/queries';
	import type { ServerInstance } from '$lib/api/types';
	import ServerCard from './ServerCard.svelte';

	interface Props {
		serverId: string;
		serverName: string;
		instance?: ServerInstance;
	}

	let { serverId, serverName, instance }: Props = $props();

	const metadata = useServerMetadata(() => serverId);
	const startMutation = useStartServer();
	const stopMutation = useStopServer();
</script>

<ServerCard
	server={{
		id: serverId,
		name: serverName,
		status: instance?.status ?? 'stopped',
		worldName: metadata.data?.levelInfo?.worldName ?? '',
		port: metadata.data?.serverPort ?? 0,
		minecraftVersion: metadata.data?.levelInfo?.minecraftVersion ?? '',
		serverBrand: metadata.data?.levelInfo?.serverBrands?.[0] ?? ''
	}}
	starting={startMutation.isPending}
	stopping={stopMutation.isPending}
	onstart={(id) => startMutation.mutate(id)}
	onstop={(id) => stopMutation.mutate(id)}
/>
