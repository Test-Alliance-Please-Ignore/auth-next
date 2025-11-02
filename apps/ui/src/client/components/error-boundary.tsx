import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
	children: ReactNode
}

interface State {
	hasError: boolean
	error?: Error
}

/**
 * Error boundary that catches chunk loading errors and automatically reloads the page.
 * This handles cases where users have cached old HTML but JavaScript chunks have been updated.
 */
export class ErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props)
		this.state = { hasError: false }
	}

	static getDerivedStateFromError(error: Error): State {
		// Update state so the next render will show the fallback UI
		return { hasError: true, error }
	}

	override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		// Check if this is a chunk loading error
		const isChunkLoadError =
			error.message?.includes('Failed to fetch dynamically imported module') ||
			error.message?.includes('Importing a module script failed') ||
			error.message?.includes('error loading dynamically imported module') ||
			error.message?.includes('Loading chunk') ||
			error.name === 'ChunkLoadError'

		if (isChunkLoadError) {
			console.warn('ErrorBoundary caught chunk load error, reloading page...', error)
			// Reload the page to get fresh assets
			window.location.reload()
			return
		}

		// Log other errors for debugging
		console.error('ErrorBoundary caught error:', error, errorInfo)
	}

	override render() {
		if (this.state.hasError) {
			// Don't show fallback UI for chunk errors since we're reloading
			const isChunkLoadError =
				this.state.error?.message?.includes('Failed to fetch dynamically imported module') ||
				this.state.error?.message?.includes('Importing a module script failed') ||
				this.state.error?.message?.includes('error loading dynamically imported module') ||
				this.state.error?.message?.includes('Loading chunk')

			if (isChunkLoadError) {
				return (
					<div className="flex items-center justify-center min-h-screen">
						<div className="text-center">
							<p className="text-lg">Loading updated version...</p>
						</div>
					</div>
				)
			}

			// Fallback UI for other errors
			return (
				<div className="flex items-center justify-center min-h-screen p-4">
					<div className="text-center max-w-md">
						<h1 className="text-2xl font-bold mb-4">Something went wrong</h1>
						<p className="text-muted-foreground mb-4">
							An unexpected error occurred. Please try refreshing the page.
						</p>
						<button
							onClick={() => window.location.reload()}
							className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
						>
							Refresh Page
						</button>
					</div>
				</div>
			)
		}

		return this.props.children
	}
}
