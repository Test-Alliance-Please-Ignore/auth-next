import { Component } from 'react'

import { PrimaryButton } from '@/components/ui/primary-button'

import type { ErrorInfo, ReactNode } from 'react'

const RELOAD_COUNT_KEY = 'errorBoundary_reloadCount'
const MAX_RELOADS = 3

interface Props {
	children: ReactNode
}

interface State {
	hasError: boolean
	error?: Error
	reloadLimitReached: boolean
}

/**
 * Error boundary that catches chunk loading errors and automatically reloads the page.
 * This handles cases where users have cached old HTML but JavaScript chunks have been updated.
 */
export class ErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props)
		this.state = { hasError: false, reloadLimitReached: false }
	}

	override componentDidMount() {
		// Clear reload count on successful mount (app loaded without errors)
		sessionStorage.removeItem(RELOAD_COUNT_KEY)
	}

	static getDerivedStateFromError(error: Error): State {
		// Update state so the next render will show the fallback UI
		const reloadCount = parseInt(sessionStorage.getItem(RELOAD_COUNT_KEY) || '0', 10)
		return { hasError: true, error, reloadLimitReached: reloadCount >= MAX_RELOADS }
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
			const reloadCount = parseInt(sessionStorage.getItem(RELOAD_COUNT_KEY) || '0', 10)

			if (reloadCount >= MAX_RELOADS) {
				console.error(
					`ErrorBoundary: Max reload attempts (${MAX_RELOADS}) reached for chunk load error`,
					error
				)
				return
			}

			console.warn(
				`ErrorBoundary caught chunk load error, reloading page (attempt ${reloadCount + 1}/${MAX_RELOADS})...`,
				error
			)
			sessionStorage.setItem(RELOAD_COUNT_KEY, String(reloadCount + 1))
			window.location.reload()
			return
		}

		// Log other errors for debugging
		console.error('ErrorBoundary caught error:', error, errorInfo)
	}

	private handleManualReload = () => {
		sessionStorage.removeItem(RELOAD_COUNT_KEY)
		window.location.reload()
	}

	override render() {
		if (this.state.hasError) {
			// Check if this is a chunk loading error
			const isChunkLoadError =
				this.state.error?.message?.includes('Failed to fetch dynamically imported module') ||
				this.state.error?.message?.includes('Importing a module script failed') ||
				this.state.error?.message?.includes('error loading dynamically imported module') ||
				this.state.error?.message?.includes('Loading chunk')

			// Show error UI if reload limit reached
			if (isChunkLoadError && this.state.reloadLimitReached) {
				return (
					<div className="flex items-center justify-center min-h-screen p-4">
						<div className="text-center max-w-md">
							<h1 className="text-2xl font-bold mb-4">Unable to load application</h1>
							<p className="text-muted-foreground mb-4">
								We tried to reload the page automatically but the problem persists. This may be a
								temporary network issue.
							</p>
							<PrimaryButton onClick={this.handleManualReload}>Try Again</PrimaryButton>
						</div>
					</div>
				)
			}

			// Show loading message while auto-reloading for chunk errors
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
						<PrimaryButton onClick={() => window.location.reload()}>Refresh Page</PrimaryButton>
					</div>
				</div>
			)
		}

		return this.props.children
	}
}
