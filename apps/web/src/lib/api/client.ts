const API_BASE = '/api';

function getToken(): string | null {
	if (typeof window === 'undefined') return null;
	return localStorage.getItem('engine_token');
}

export function setToken(token: string) {
	localStorage.setItem('engine_token', token);
}

export function clearToken() {
	localStorage.removeItem('engine_token');
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
	const token = getToken();
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...((options.headers as Record<string, string>) ?? {})
	};

	if (token) {
		headers['Authorization'] = `Bearer ${token}`;
	}

	const res = await fetch(`${API_BASE}${path}`, {
		...options,
		headers
	});

	if (!res.ok) {
		const body = await res.json().catch(() => ({ error: res.statusText }));
		throw new ApiError(res.status, body.error ?? 'Unknown error', body);
	}

	if (res.status === 204 || res.headers.get('content-length') === '0') {
		return undefined as T;
	}

	return res.json() as Promise<T>;
}

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
		public body?: unknown
	) {
		super(message);
		this.name = 'ApiError';
	}
}

export function isUnauthorized(err: unknown): boolean {
	return err instanceof ApiError && err.status === 401;
}
