import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
import { apiFetch } from './client';
import type { MinecraftServer, ServerInstance, ServerMetadata } from './types';

export function useServers() {
	return createQuery(() => ({
		queryKey: ['minecraft', 'servers'],
		queryFn: () => apiFetch<{ servers: MinecraftServer[] }>('/minecraft/servers'),
		select: (data) => data.servers
	}));
}

export function useServerInstances() {
	return createQuery(() => ({
		queryKey: ['server', 'instances'],
		queryFn: () => apiFetch<{ instances: ServerInstance[] }>('/server/instances'),
		select: (data) => data.instances
	}));
}

export function useServerMetadata(getServerId: () => string) {
	return createQuery(() => {
		const serverId = getServerId();
		return {
			queryKey: ['minecraft', 'servers', serverId, 'metadata'],
			queryFn: () => apiFetch<ServerMetadata>(`/minecraft/servers/${serverId}/metadata`),
			enabled: !!serverId
		};
	});
}

export function useStartServer() {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (serverId: string) =>
			apiFetch(`/minecraft/servers/${serverId}/start`, { method: 'POST' }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['server', 'instances'] });
			queryClient.invalidateQueries({ queryKey: ['minecraft', 'servers'] });
		}
	}));
}

export function useStopServer() {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (serverId: string) =>
			apiFetch(`/minecraft/servers/${serverId}/stop`, { method: 'POST' }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['server', 'instances'] });
			queryClient.invalidateQueries({ queryKey: ['minecraft', 'servers'] });
		}
	}));
}
