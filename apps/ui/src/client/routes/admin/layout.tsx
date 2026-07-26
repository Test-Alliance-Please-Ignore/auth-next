import { ChevronRight, Menu, X } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router'

import { AdminNav } from '@/components/admin-nav'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/ui/loading'
import { useAuth } from '@/hooks/useAuth'
import { BreadcrumbProvider, useBreadcrumb } from '@/hooks/useBreadcrumb'
import { cn } from '@/lib/utils'

export default function AdminLayout() {
	const { user, isAuthenticated, isLoading } = useAuth()
	const location = useLocation()

	// Redirect to login if not authenticated, preserving the intended destination
	useEffect(() => {
		if (!isLoading && (!isAuthenticated || !user)) {
			const currentPath = location.pathname + location.search
			// Use window.location to do a full page redirect to the server-side login page
			window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`
		}
	}, [isAuthenticated, isLoading, user, location.pathname, location.search])

	// Show loading state while checking auth or redirecting
	if (isLoading) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<LoadingSpinner label="Loading admin panel..." />
			</div>
		)
	}

	// If not authenticated or no user, show loading (redirect will happen via useEffect)
	if (!isAuthenticated || !user) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<LoadingSpinner label="Redirecting to login..." />
			</div>
		)
	}

	// Redirect to dashboard if not admin
	if (!user.is_admin) {
		return <Navigate to="/dashboard" replace />
	}

	return (
		<BreadcrumbProvider>
			<AdminLayoutContent />
		</BreadcrumbProvider>
	)
}

function AdminLayoutContent() {
	const location = useLocation()
	const { customLabels } = useBreadcrumb()
	const [sidebarOpen, setSidebarOpen] = useState(false)

	// Generate breadcrumbs from current path
	const pathSegments = location.pathname.split('/').filter(Boolean)
	const breadcrumbs = pathSegments.map((segment, index) => {
		const path = `/${pathSegments.slice(0, index + 1).join('/')}`
		const defaultLabel = segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ')
		const label = customLabels.get(path) || defaultLabel
		return { label, path }
	})

	return (
		<div className="relative min-h-screen flex">
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
				className={cn(
					'fixed lg:sticky top-0 left-0 h-dvh w-64 z-50 border-r border-border/50 bg-background/52 backdrop-blur-sm transition-transform duration-300 ease-in-out',
					sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
				)}
			>
				<AdminNav onNavigate={() => setSidebarOpen(false)} />
			</aside>

			{/* Main Content Area */}
			<div className="relative z-10 flex-1 flex flex-col min-w-0">
				{/* Top Bar (Mobile) */}
				<header className="sticky top-0 z-30 lg:hidden border-b border-border/30 bg-background/95 backdrop-blur-sm shadow-sm">
					<div className="flex items-center justify-between">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setSidebarOpen(!sidebarOpen)}
							className="gap-2"
						>
							{sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
							<span className="font-semibold">Menu</span>
						</Button>
						<span className="text-sm font-bold gradient-text">Admin</span>
					</div>
				</header>

				{/* Header with Breadcrumbs (kept as requested) */}
				<header className="border-b border-border/30 bg-background/72 z-20 shadow-[0_4px_20px_rgba(0,0,0,0.3)] flex-shrink-0 backdrop-blur-sm">
					<div className="px-4 md:px-6 lg:px-8 py-4">
						<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
							<h1 className="text-2xl font-bold gradient-text">Admin Panel</h1>

							<nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Breadcrumb">
								{breadcrumbs.map((crumb, index) => (
									<Fragment key={crumb.path}>
										{index > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
										{index === breadcrumbs.length - 1 ? (
											<span className="text-foreground font-medium" aria-current="page">
												{crumb.label}
											</span>
										) : (
											<Link
												to={crumb.path}
												className="text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
											>
												{crumb.label}
											</Link>
										)}
									</Fragment>
								))}
							</nav>
						</div>
					</div>
				</header>

				<main className="flex-1 relative z-10 p-4 md:p-6 lg:p-8 overflow-x-hidden">
					<div className="w-full mx-auto max-w-[120rem]">
						<Outlet />
					</div>
				</main>

				{/* Footer */}
				<footer className="border-t border-border/50 py-4 relative z-10 bg-background/75 backdrop-blur-sm">
					<div className="px-4 md:px-6 lg:px-8 text-center text-xs text-muted-foreground">
						<p>Admin Panel • Manage Categories and Groups</p>
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
