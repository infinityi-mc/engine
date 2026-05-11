const ENGINE_URL_KEY = 'engine_url';
const DEFAULT_ENGINE_URL = '/api';

export function getEngineUrl(): string {
	if (typeof window === 'undefined') return DEFAULT_ENGINE_URL;
	return localStorage.getItem(ENGINE_URL_KEY) ?? DEFAULT_ENGINE_URL;
}

export function setEngineUrl(url: string): void {
	const normalized = url.replace(/\/+$/, '');
	localStorage.setItem(ENGINE_URL_KEY, normalized);
}

export function clearEngineUrl(): void {
	localStorage.removeItem(ENGINE_URL_KEY);
}
