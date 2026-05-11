# engine web

Web dashboard for [engine](../../README.md) — a local-first API server for AI agents.

## Stack

- **SvelteKit** (SPA mode, SSR disabled) — file-based routing, `adapter-static`
- **Tailwind CSS v4** — utility-first styling with `@tailwindcss/vite`
- **engine-retro theme** — dark navy surfaces, Bitter slab-serif, hard offset shadows
- **@tanstack/svelte-query** — data fetching, caching, auto-refetch
- **TypeScript** — strict mode

## Getting started

```bash
bun install
bun run dev
```

The dev server starts at `http://localhost:5173`. API calls to `/api/*` are proxied to the engine server on `http://localhost:3000`.

### Authentication

Set a JWT token in the browser console:

```js
localStorage.setItem('engine_token', 'your-token-here')
```

### Build

```bash
bun run build     # production build to build/
bun run preview   # preview the production build
```

## Project structure

```
src/
├── app.css          Tailwind + engine-retro design tokens
├── app.html         Shell template (Bitter font, data-theme)
├── lib/api/
│   └── client.ts    fetch wrapper with JWT injection
└── routes/
    ├── +layout.svelte   Sidebar shell + QueryClientProvider
    ├── +page.svelte     Overview (placeholder)
    ├── logs/            Log viewer (placeholder)
    ├── agent/           Agent sessions (placeholder)
    └── settings/        Configuration (placeholder)
```

## Design system

All colors, typography, and layout values are defined as CSS custom properties under `[data-theme="engine-retro"]` in `app.css`. Use them via Tailwind arbitrary values:

```html
<div style="background-color: var(--color-surface-card); border-color: var(--color-surface-border);">
```

Key tokens:
| Token | Value | Usage |
|-------|-------|-------|
| `surface.background` | `#0F1318` | Page background |
| `surface.card` | `#1C2230` | Cards, panels, sidebar |
| `primary` | `#3AA5FF` | Links, active states |
| `text.primary` | `#E8E0D8` | Body text (warm cream) |
| `text.secondary` | `#A89E94` | Labels, descriptions |
| `font.heading.family` | `Bitter, Georgia, serif` | Headings and body |

## Scripts

```bash
bun run dev        # dev server with HMR
bun run build      # production build
bun run preview    # preview production build
bun run check      # typecheck with svelte-check
```
