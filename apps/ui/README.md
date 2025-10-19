# UI Worker - React SPA

A modern React single-page application (SPA) served via Cloudflare Workers with Static Assets.

## Tech Stack

- **React 19** - Modern UI library
- **Vite** - Lightning-fast bundler with HMR
- **React Router v7** - Client-side routing
- **TanStack Query** - Data fetching and state management
- **Tailwind CSS v4** - Utility-first CSS framework
- **shadcn/ui** - Customizable component library built on Radix UI
- **Cloudflare Workers** - Edge deployment with static assets

## Project Structure

```
apps/ui/
├── src/
│   ├── index.ts              # Hono worker (serves static assets)
│   ├── client/               # React application
│   │   ├── main.tsx         # React entry point
│   │   ├── App.tsx          # Root component with providers
│   │   ├── routes/          # Page components
│   │   ├── components/      # React components
│   │   │   ├── layout.tsx   # App layout
│   │   │   └── ui/          # shadcn/ui components
│   │   ├── lib/             # Utilities
│   │   │   ├── api.ts       # API client
│   │   │   └── utils.ts     # Helper functions
│   │   └── styles/          # CSS files
│   │       └── globals.css  # Tailwind & theme variables
│   └── public/              # Static assets
├── index.html               # HTML entry point
├── tailwind.config.ts       # Tailwind configuration
├── postcss.config.js        # PostCSS configuration
├── components.json          # shadcn/ui configuration
└── wrangler.jsonc           # Cloudflare Workers config
```

## Development

### Start the dev server

```bash
pnpm dev
# or from the root:
just dev
```

This starts the Vite dev server with hot module replacement (HMR) and proxies API requests to the core worker at `http://localhost:8787`.

### Test with Wrangler

To test the full Cloudflare Workers environment locally:

```bash
pnpm dev:wrangler
```

This builds the React app and starts Wrangler dev server with static assets serving.

## Building

```bash
pnpm build
# or from the root:
just build
```

This creates an optimized production build in `dist/client/`.

## Deployment

```bash
pnpm deploy
# or from the root:
just deploy
```

This builds the app and deploys it to Cloudflare Workers with static assets.

## Adding shadcn/ui Components

This project is configured for shadcn/ui. To add new components:

```bash
npx shadcn@latest add button
npx shadcn@latest add card
npx shadcn@latest add input
# etc.
```

Components will be added to `src/client/components/ui/`.

## API Integration

The API client in `src/client/lib/api.ts` is pre-configured to work with the core worker:

- **Development**: Proxies to `http://localhost:8787/api`
- **Production**: Uses `/api` (same origin)

### Example Usage with TanStack Query

```tsx
import { useQuery } from '@tanstack/react-query'

import { apiClient } from '@/lib/api'

function MyComponent() {
  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient.get('/users'),
  })

  // ...
}
```

## Routing

React Router is configured for client-side routing. Add new routes in `src/client/App.tsx`:

```tsx
<Route path="/new-page" element={<NewPage />} />
```

The Cloudflare Workers Static Assets configuration automatically handles SPA routing with the `not_found_handling: "single-page-application"` setting.

## Styling

### Tailwind CSS v4

This project uses Tailwind CSS v4 with CSS variables for theming. Customize the theme in `src/client/styles/globals.css`.

### Theme Variables

The app supports light and dark themes via CSS variables. Toggle dark mode by adding the `dark` class to the root element.

## Environment Variables

Add environment variables to `wrangler.jsonc`:

```jsonc
{
  "vars": {
    "ENVIRONMENT": "development",
    "CUSTOM_VAR": "value",
  },
}
```

## Type Safety

- TypeScript is configured for React with JSX support
- Path alias `@/*` resolves to `src/client/*`
- Worker types are auto-generated via `pnpm fix:workers-types`

## Testing

```bash
pnpm test
```

Uses Vitest with Cloudflare Workers pool for integration testing.

## Key Features

- ✅ Modern React with hooks and functional components
- ✅ Type-safe routing with React Router
- ✅ Server state management with TanStack Query
- ✅ Beautiful, customizable UI components
- ✅ Responsive design with Tailwind CSS
- ✅ Dark mode support
- ✅ Fast builds with Vite
- ✅ Edge deployment with Cloudflare Workers
- ✅ Zero-latency static asset serving

## Notes

- The worker at `src/index.ts` is minimal - Cloudflare Workers Static Assets automatically serves files from `dist/client/`
- In development, use the Vite dev server for the best DX with HMR
- For production testing, use `pnpm dev:wrangler` to test the full Workers environment
- API requests are automatically proxied to the core worker during development
