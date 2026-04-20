import { Menu } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'

import { SidebarNav } from './sidebar-nav'
import { Button } from './ui/button'
import { LoadingSpinner } from './ui/loading'

const SIDEBAR_OPEN_STORAGE_KEY = 'ui.sidebar.open'

export default function Layout() {
	const { isAuthenticated, isLoading } = useAuth()
	const [sidebarOpen, setSidebarOpen] = useState(() => {
		if (typeof window === 'undefined') {
			return true
		}
		const stored = window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)
		if (stored === null) {
			return true
		}
		return stored === '1'
	})
	const location = useLocation()

	useEffect(() => {
		window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, sidebarOpen ? '1' : '0')
	}, [sidebarOpen])

	// Redirect to login if not authenticated, preserving the intended destination
	useEffect(() => {
		if (!isLoading && !isAuthenticated) {
			const currentPath = location.pathname + location.search
			// Use window.location to do a full page redirect to the server-side login page
			window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`
		}
	}, [isAuthenticated, isLoading, location.pathname, location.search])

	// Show loading state while checking auth or redirecting
	if (isLoading || !isAuthenticated) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<LoadingSpinner label="Loading..." />
			</div>
		)
	}

	return (
		<div className="relative min-h-screen flex">
			{/* Starfield Background */}
			<Starfield />

			{/* Mobile Overlay */}
			{sidebarOpen && (
				<div
					className="fixed inset-0 bg-background/70 backdrop-blur-sm z-40 lg:hidden"
					onClick={() => setSidebarOpen(false)}
				/>
			)}

			{/* Sidebar */}
			<aside
				className={`
					fixed top-0 left-0 h-screen w-64 z-50
					border-r border-border/50
					bg-background/52
					transition-transform duration-300 ease-in-out
					${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
				`}
			>
				<SidebarNav
					isSidebarOpen={sidebarOpen}
					onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
					onNavigate={() => {
						if (window.matchMedia('(max-width: 1023px)').matches) {
							setSidebarOpen(false)
						}
					}}
				/>
			</aside>

			{/* Main Content Area */}
			<div
				className={cn(
					'relative z-10 flex-1 flex flex-col min-w-0 overflow-auto transition-[padding-left] duration-300 ease-in-out',
					sidebarOpen ? 'lg:pl-64' : 'lg:pl-0'
				)}
			>
				{!sidebarOpen ? (
					<div className="fixed top-6 left-2 z-30">
						<Button
							type="button"
							variant="ghost"
							size="icon"
							onClick={() => setSidebarOpen(true)}
							aria-label="Open navigation"
							className="h-9 w-9 bg-background/90 backdrop-blur-sm border border-border/50 shadow-sm"
						>
							<Menu className="h-4 w-4" />
						</Button>
					</div>
				) : null}

				{/* Page Content */}
				<main className="flex-1 relative z-10 p-4 md:p-6 lg:p-8">
					<div className={cn('w-full mx-auto max-w-[120rem]')}>
						<Outlet />
					</div>
				</main>

				{/* Footer */}
				<footer className="border-t border-border/50 py-4 relative z-10 bg-background/75 backdrop-blur-sm">
					<div className="px-4 md:px-6 lg:px-8 text-center text-xs text-muted-foreground">
						<p>Powered by EVE Online SSO • Built on Cloudflare Workers</p>
					</div>
				</footer>
			</div>
		</div>
	)
}

function Starfield() {
	// Memoize star generation to prevent drift on re-renders
	const stars = useMemo(
		() =>
			Array.from({ length: 50 }, (_, i) => ({
				id: i,
				top: `${Math.random() * 100}%`,
				left: `${Math.random() * 100}%`,
				animationDelay: `${Math.random() * 3}s`,
				opacity: Math.random() * 0.5 + 0.2,
			})),
		[] // Empty dependency array ensures stars are only generated once
	)

	return (
		<div className="starfield">
			{stars.map((star) => (
				<div
					key={star.id}
					className="star"
					style={{
						top: star.top,
						left: star.left,
						animationDelay: star.animationDelay,
						opacity: star.opacity,
					}}
				/>
			))}
		</div>
	)
}
