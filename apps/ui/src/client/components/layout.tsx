import { Menu, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/hooks/useAuth'

import { SidebarNav } from './sidebar-nav'
import { Button } from './ui/button'
import { LoadingSpinner } from './ui/loading'

export default function Layout() {
	const { isAuthenticated, isLoading } = useAuth()
	const [sidebarOpen, setSidebarOpen] = useState(false)
	const location = useLocation()

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
		<div className="min-h-screen flex">
			{/* Starfield Background */}
			<Starfield />

			{/* Mobile Overlay */}
			{sidebarOpen && (
				<div
					className="fixed inset-0 bg-background backdrop-blur-sm z-40 lg:hidden"
					onClick={() => setSidebarOpen(false)}
				/>
			)}

			{/* Sidebar */}
			<aside
				className={`
					fixed lg:sticky top-0 left-0 h-screen w-64 z-50
					border-r border-border/50
					bg-background
					transition-transform duration-300 ease-in-out
					${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
				`}
			>
				<SidebarNav onNavigate={() => setSidebarOpen(false)} />
			</aside>

			{/* Main Content Area */}
			<div className="flex-1 flex flex-col min-w-0">
				{/* Top Bar (Mobile) */}
				<header className="sticky top-0 z-30 lg:hidden border-b border-border/30 bg-background shadow-sm">
					<div className="flex items-center justify-between px-4 py-3">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setSidebarOpen(!sidebarOpen)}
							className="gap-2"
						>
							{sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
							<span className="font-semibold">Menu</span>
						</Button>
						<span className="text-sm font-bold gradient-text">TANG</span>
					</div>
				</header>

				{/* Page Content */}
				<main className="flex-1 relative z-10 p-4 md:p-6 lg:p-8 overflow-auto bg-background">
					<div className="max-w-7xl mx-auto">
						<Outlet />
					</div>
				</main>

				{/* Footer */}
				<footer className="border-t border-border/50 py-4 relative z-10 bg-background">
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
