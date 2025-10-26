import { ChevronRight } from 'lucide-react'
import { Fragment, useEffect, useMemo } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'

import { AdminNav } from '@/components/admin-nav'
import { LoadingSpinner } from '@/components/ui/loading'
import { useAuth } from '@/hooks/useAuth'
import { BreadcrumbProvider, useBreadcrumb } from '@/hooks/useBreadcrumb'

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

	// Generate breadcrumbs from current path
	const pathSegments = location.pathname.split('/').filter(Boolean)
	const breadcrumbs = pathSegments.map((segment, index) => {
		const path = `/${pathSegments.slice(0, index + 1).join('/')}`
		const defaultLabel = segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ')
		const label = customLabels.get(path) || defaultLabel
		return { label, path }
	})

	return (
		<div className="min-h-screen flex flex-col">
			{/* Starfield Background */}
			<Starfield />

			{/* Solid background overlay to hide stars - with pointer-events: none */}
			<div className="fixed inset-0 bg-background z-0 pointer-events-none" />

			{/* Header with Breadcrumbs */}
			<header className="border-b border-border/30 bg-background sticky top-0 z-50 shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
				<div className="container mx-auto px-4 py-4">
					<div className="flex items-center justify-between">
						<h1 className="text-2xl font-bold gradient-text">Admin Panel</h1>

						{/* Breadcrumb Navigation */}
						<nav className="flex items-center gap-2 text-sm" aria-label="Breadcrumb">
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

			{/* Main Layout with Sidebar */}
			<div className="flex-1 container mx-auto px-4 py-8 relative z-10 bg-background">
				<div className="flex gap-8">
					{/* Sidebar Navigation */}
					<aside className="w-64 flex-shrink-0">
						<AdminNav />
					</aside>

					{/* Main Content */}
					<main className="flex-1 min-w-0">
						<Outlet />
					</main>
				</div>
			</div>

			{/* Footer */}
			<footer className="border-t border-border/50 py-6 relative z-10 bg-background">
				<div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
					<p>Admin Panel • Manage Categories and Groups</p>
				</div>
			</footer>
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
