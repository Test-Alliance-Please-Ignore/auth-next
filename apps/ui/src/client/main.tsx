import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'

import App from './App'
import { ErrorBoundary } from './components/error-boundary'

import './styles/globals.css'

// Handle chunk loading errors (e.g., when assets change after deployment)
// This prevents the blank page issue when users have cached old HTML
window.addEventListener('error', (event) => {
	// Check if this is a chunk loading error
	const isChunkLoadError =
		event.message?.includes('Failed to fetch dynamically imported module') ||
		event.message?.includes('Importing a module script failed') ||
		event.message?.includes('error loading dynamically imported module')

	if (isChunkLoadError) {
		console.warn('Detected chunk load error, reloading page...')
		// Reload the page to get fresh assets
		window.location.reload()
	}
})

// Also handle unhandled promise rejections (for dynamic imports)
window.addEventListener('unhandledrejection', (event) => {
	const error = event.reason
	const isChunkLoadError =
		error?.message?.includes('Failed to fetch dynamically imported module') ||
		error?.message?.includes('Importing a module script failed') ||
		error?.message?.includes('error loading dynamically imported module')

	if (isChunkLoadError) {
		console.warn('Detected chunk load error in promise, reloading page...')
		event.preventDefault()
		window.location.reload()
	}
})

const rootElement = document.getElementById('root')

if (!rootElement) {
	throw new Error('Failed to find the root element')
}

createRoot(rootElement).render(
	<StrictMode>
		<ErrorBoundary>
			<App />
			<Toaster
				position="bottom-right"
				theme="dark"
				closeButton
				richColors
				toastOptions={{
					style: {
						background: 'hsl(var(--card))',
						border: '1px solid hsl(var(--border))',
						color: 'hsl(var(--foreground))',
					},
					className: 'backdrop-blur-sm',
				}}
			/>
		</ErrorBoundary>
	</StrictMode>
)
