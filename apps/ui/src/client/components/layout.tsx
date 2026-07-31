import { Menu } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router'

import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'

import { SidebarNav } from './sidebar-nav'
import { Button } from './ui/button'
import { LoadingSpinner } from './ui/loading'

const SIDEBAR_OPEN_STORAGE_KEY = 'ui.sidebar.open'
const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)'

export default function Layout() {
	const { isAuthenticated, isLoading } = useAuth()
	const sidebarStateBeforeMobileRef = useRef<boolean | null>(null)
	const [sidebarOpen, setSidebarOpen] = useState(() => {
		if (typeof window === 'undefined') {
			return true
		}
		const isDesktopViewport = window.matchMedia(DESKTOP_MEDIA_QUERY).matches
		if (!isDesktopViewport) {
			return false
		}
		const stored = window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)
		if (stored === null) {
			return true
		}
		return stored === '1'
	})
	const sidebarOpenRef = useRef(sidebarOpen)
	const location = useLocation()
	const isStructuresPage = location.pathname === '/structures'

	useEffect(() => {
		window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, sidebarOpen ? '1' : '0')
	}, [sidebarOpen])

	useEffect(() => {
		sidebarOpenRef.current = sidebarOpen
	}, [sidebarOpen])

	useEffect(() => {
		if (typeof window === 'undefined') {
			return
		}
		const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY)
		const onMediaChange = (event: MediaQueryListEvent) => {
			if (!event.matches) {
				if (sidebarStateBeforeMobileRef.current === null) {
					sidebarStateBeforeMobileRef.current = sidebarOpenRef.current
				}
				setSidebarOpen(false)
				return
			}

			if (sidebarStateBeforeMobileRef.current !== null) {
				setSidebarOpen(sidebarStateBeforeMobileRef.current)
				sidebarStateBeforeMobileRef.current = null
			}
		}
		if (!mediaQuery.matches) {
			if (sidebarStateBeforeMobileRef.current === null) {
				sidebarStateBeforeMobileRef.current = sidebarOpenRef.current
			}
			setSidebarOpen(false)
		}
		mediaQuery.addEventListener('change', onMediaChange)
		return () => mediaQuery.removeEventListener('change', onMediaChange)
	}, [])

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
		<div className={cn('relative min-h-screen flex overflow-x-hidden', isStructuresPage && 'h-dvh overflow-hidden')}>
			{/* Starfield Background */}
			<Starfield />

			{/* Mobile Overlay */}
			{sidebarOpen && (
				<div
					className="fixed inset-0 z-40 lg:hidden"
					onClick={() => setSidebarOpen(false)}
				/>
			)}

			{/* Sidebar */}
			<aside
				className={`
					fixed top-0 left-0 h-dvh w-64 z-50
					border-r border-border/50
					bg-background/52 backdrop-blur-sm
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
					'relative z-10 flex-1 flex flex-col min-w-0 overflow-x-hidden overflow-y-auto transition-[padding-left] duration-300 ease-in-out',
					isStructuresPage && 'min-h-0 overflow-y-hidden',
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
				<main className={cn('flex flex-1 flex-col relative z-10 p-4 md:p-6 lg:p-8', isStructuresPage && 'min-h-0 overflow-hidden')}>
					<div className={cn('w-full mx-auto max-w-[120rem]', isStructuresPage && 'h-full')}>
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
