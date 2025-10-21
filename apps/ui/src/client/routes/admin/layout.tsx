import { Fragment } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

import { AdminNav } from '@/components/admin-nav'
import { LoadingSpinner } from '@/components/ui/loading'
import { useAuth } from '@/hooks/useAuth'

export default function AdminLayout() {
	const { user, isAuthenticated, isLoading } = useAuth()
	const location = useLocation()

	// Show loading state while checking auth
	if (isLoading) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<LoadingSpinner label="Loading admin panel..." />
			</div>
		)
	}

	// Redirect to dashboard if not authenticated
	if (!isAuthenticated || !user) {
		return <Navigate to="/dashboard" replace />
	}

	// Redirect to dashboard if not admin
	if (!user.is_admin) {
		return <Navigate to="/dashboard" replace />
	}

	// Generate breadcrumbs from current path
	const pathSegments = location.pathname.split('/').filter(Boolean)
	const breadcrumbs = pathSegments.map((segment, index) => {
		const path = `/${pathSegments.slice(0, index + 1).join('/')}`
		const label = segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ')
		return { label, path }
	})

	return (
		<div className="min-h-screen flex flex-col">
			{/* Starfield Background */}
			<Starfield />

			{/* Header with Breadcrumbs */}
			<header className="border-b border-border/30 backdrop-blur-md bg-gradient-to-r from-background/90 via-background/80 to-background/90 sticky top-0 z-50 shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
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
			<div className="flex-1 container mx-auto px-4 py-8 relative z-10">
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
			<footer className="border-t border-border/50 py-6 relative z-10 backdrop-blur-sm bg-background/80">
				<div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
					<p>Admin Panel • Manage Categories and Groups</p>
				</div>
			</footer>
		</div>
	)
}

function Starfield() {
	// Generate random stars
	const stars = Array.from({ length: 50 }, (_, i) => ({
		id: i,
		top: `${Math.random() * 100}%`,
		left: `${Math.random() * 100}%`,
		animationDelay: `${Math.random() * 3}s`,
		opacity: Math.random() * 0.5 + 0.2,
	}))

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
