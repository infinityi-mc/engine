/// <reference types="@sveltejs/kit" />

declare namespace App {}

interface ImportMetaEnv {
	readonly PUBLIC_ENGINE_URL?: string;
	readonly PUBLIC_JWT_TOKEN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
