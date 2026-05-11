const ENGINE_URL_KEY = 'engine_url';
const TOKEN_KEY = 'engine_token';

const ENV_ENGINE_URL = import.meta.env.PUBLIC_ENGINE_URL as string | undefined;
const ENV_TOKEN = import.meta.env.PUBLIC_JWT_TOKEN as string | undefined;

const DEFAULT_ENGINE_URL = '/api';

export function getEngineUrl(): string {
	if (typeof window === 'undefined') return ENV_ENGINE_URL ?? DEFAULT_ENGINE_URL;
	return localStorage.getItem(ENGINE_URL_KEY) ?? ENV_ENGINE_URL ?? DEFAULT_ENGINE_URL;
}

export function setEngineUrl(url: string): void {
	const normalized = url.replace(/\/+$/, '');
	localStorage.setItem(ENGINE_URL_KEY, normalized);
}

export function clearEngineUrl(): void {
	localStorage.removeItem(ENGINE_URL_KEY);
}

export function getToken(): string | null {
	if (typeof window === 'undefined') return null;
	return localStorage.getItem(TOKEN_KEY) ?? ENV_TOKEN ?? null;
}

export function setToken(token: string): void {
	localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
	localStorage.removeItem(TOKEN_KEY);
}
