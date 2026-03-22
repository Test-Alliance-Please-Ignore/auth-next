import { createTheme, MantineProvider } from '@mantine/core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'

import App from './App'
import { ErrorBoundary } from './components/error-boundary'

import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import 'mantine-react-table/styles.css'
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

const mantineTheme = createTheme({
	fontFamily: 'inherit',
	primaryColor: 'brand',
	defaultRadius: 'md',
	colors: {
		brand: [
			'#d7edff',
			'#b9dcff',
			'#94c9ff',
			'#6ab4fb',
			'#4aa4f7',
			'#3da7f5',
			'#2b94e0',
			'#1c7fca',
			'#136db4',
			'#0b5b96',
		],
		dark: [
			'#f0f1f3',
			'#cfd4dc',
			'#afb3bb',
			'#7f8794',
			'#626a7c',
			'#3d4250',
			'#31353f',
			'#252935',
			'#191c24',
			'#0d0f14',
		],
	},
})

createRoot(rootElement).render(
	<StrictMode>
		<ErrorBoundary>
			<MantineProvider forceColorScheme="dark" theme={mantineTheme}>
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
			</MantineProvider>
		</ErrorBoundary>
	</StrictMode>
)
