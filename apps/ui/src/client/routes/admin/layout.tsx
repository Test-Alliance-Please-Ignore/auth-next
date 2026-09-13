import { ChevronRight, Menu, X } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, matchPath, Navigate, Outlet, useLocation } from 'react-router'

import { AdminNav } from '@/components/admin-nav'
import { LayoutScrollProvider, useLayoutScrollMode } from '@/components/layout-scroll-context'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/ui/loading'
import { useAuth } from '@/hooks/useAuth'
import { BreadcrumbProvider, useBreadcrumb } from '@/hooks/useBreadcrumb'
import { useAppTranslation } from '@/i18n'
import { cn } from '@/lib/utils'

import type { AppTranslationKey } from '@/i18n'

// Match complete route patterns; entity IDs and custom breadcrumb labels remain verbatim.
const breadcrumbKeys: Record<string, AppTranslationKey> = {
	'/admin/eve-character-sync': 'admin.breadcrumbs.eveCharacterSync',
	'/admin/discord-servers/:serverId/roles': 'admin.breadcrumbs.roles',
	'/admin/users/:userId/discord-access': 'admin.breadcrumbs.discordAccess',
	'/admin/users/:userId/oauth-inspection': 'admin.breadcrumbs.oauthInspection',
	'/admin/users/:userId/activity': 'admin.breadcrumbs.userActivity',
	'/admin/ip-history': 'admin.breadcrumbs.ipHistory',
	'/admin/users/:userId/hr-notes': 'admin.breadcrumbs.hrNotes',
	'/admin/dev': 'admin.breadcrumbs.development',
	'/admin/dev/components': 'admin.breadcrumbs.components',
	'/admin/bills/new': 'admin.breadcrumbs.new',
	'/admin/bills/dashboard': 'admin.breadcrumbs.dashboard',
	'/admin/bills/schedules': 'admin.breadcrumbs.schedules',
	'/admin/bills/schedules/new': 'admin.breadcrumbs.new',
	'/admin/bills/templates/new': 'admin.breadcrumbs.new',
	'/admin/bills/group': 'admin.breadcrumbs.group',
	'/admin/bills/group/:groupBillId/edit': 'admin.breadcrumbs.edit',
	'/admin/bills/:billId/edit': 'admin.breadcrumbs.edit',
	'/admin/dkp/awards': 'admin.breadcrumbs.awards',
	'/admin/dkp/leaderboards': 'admin.breadcrumbs.leaderboards',
	'/admin/industry-providers/new': 'admin.breadcrumbs.new',
	'/admin/industry-providers/:providerId/edit': 'admin.breadcrumbs.edit',
	'/admin/discord-servers/:serverId/commands': 'admin.nav.commands',
	'/admin/discord-commands/categories': 'admin.nav.categories',
	'/admin/users/:userId/groups': 'admin.nav.groups',
	'/admin/bills/templates': 'admin.nav.templates',
	'/admin/dkp/history': 'admin.nav.history',

	'/admin': 'admin.shell.admin',
	'/admin/permissions': 'admin.nav.permissions',
	'/admin/permissions/categories': 'admin.nav.categories',
	'/admin/permissions/global': 'admin.permissions.global',
	'/admin/users': 'admin.nav.users',
	'/admin/groups': 'admin.nav.groups',
	'/admin/categories': 'admin.nav.categories',
	'/admin/corporations': 'admin.nav.corporations',
	'/admin/structures': 'admin.nav.structures',
	'/admin/discord': 'admin.nav.discord',
	'/admin/discord-servers': 'admin.nav.servers',
	'/admin/discord-commands': 'admin.nav.commands',
	'/admin/discord-audit': 'admin.nav.memberAudit',
	'/admin/broadcasts': 'admin.nav.broadcasts',
	'/admin/broadcasts-targets': 'admin.nav.targets',
	'/admin/broadcasts-templates': 'admin.nav.templates',
	'/admin/bills': 'admin.nav.bills',
	'/admin/dkp': 'admin.nav.dkp',
	'/admin/prediction-markets': 'admin.nav.predictionMarkets',
	'/admin/prediction-markets/markets': 'admin.nav.markets',
	'/admin/prediction-markets/wallets': 'admin.nav.wallets',
	'/admin/prediction-markets/audit': 'admin.nav.auditLog',
	'/admin/prediction-markets/config': 'admin.nav.config',
	'/admin/industry-providers': 'admin.nav.industryProviders',
	'/admin/pastes': 'admin.nav.pastes',
	'/admin/legacy-migrations': 'admin.nav.legacyMigrations',
	'/admin/third-party-apps': 'admin.nav.thirdPartyApps',
	'/admin/external-links': 'admin.nav.externalLinks',
	'/admin/services-audit': 'admin.nav.servicesAudit',
	'/admin/blacklist': 'admin.nav.blocklist',
	'/admin/activity-log': 'admin.nav.activityLog',
}

export default function AdminLayout() {
	const { t } = useAppTranslation()
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
				<LoadingSpinner label={t('admin.shell.loading')} />
			</div>
		)
	}

	// If not authenticated or no user, show loading (redirect will happen via useEffect)
	if (!isAuthenticated || !user) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<LoadingSpinner label={t('admin.shell.redirecting')} />
			</div>
		)
	}

	// Redirect to dashboard if not admin
	if (!user.is_admin) {
		return <Navigate to="/dashboard" replace />
	}

	return (
		<LayoutScrollProvider>
			<BreadcrumbProvider>
				<AdminLayoutContent />
			</BreadcrumbProvider>
		</LayoutScrollProvider>
	)
}

function AdminLayoutContent() {
	const { t } = useAppTranslation()
	const location = useLocation()
	const { isPageScrollEnabled } = useLayoutScrollMode()
	const { customLabels } = useBreadcrumb()
	const [sidebarOpen, setSidebarOpen] = useState(false)
	const isBillsPage = location.pathname === '/admin/bills'
	const isTableGridClamped = isBillsPage && !isPageScrollEnabled

	// Generate breadcrumbs from current path
	const pathSegments = location.pathname.split('/').filter(Boolean)
	const breadcrumbs = pathSegments.map((segment, index) => {
		const path = `/${pathSegments.slice(0, index + 1).join('/')}`
		const labelKey = Object.entries(breadcrumbKeys).find(([pattern]) =>
			matchPath({ path: pattern, end: true }, path)
		)?.[1]
		const defaultLabel = labelKey ? t(labelKey) : segment
		const label = customLabels.get(path) || defaultLabel
		return { label, path }
	})

	return (
		<div
			className={cn(
				'relative min-h-screen flex',
				isTableGridClamped && 'lg:h-dvh lg:min-h-0 lg:overflow-hidden'
			)}
		>
			{/* Starfield Background */}
			<Starfield />

			{/* Mobile Overlay */}
			{sidebarOpen && (
				<div className="fixed inset-0 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
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
			<div
				className={cn(
					'relative z-10 flex-1 flex flex-col min-w-0',
					isTableGridClamped && 'lg:min-h-0'
				)}
			>
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
							<span className="font-semibold">{t('admin.shell.menu')}</span>
						</Button>
						<span className="text-sm font-bold gradient-text">{t('admin.shell.admin')}</span>
					</div>
				</header>

				{/* Header with Breadcrumbs (kept as requested) */}
				<header className="border-b border-border/30 bg-background/72 z-20 shadow-[0_4px_20px_rgba(0,0,0,0.3)] flex-shrink-0 backdrop-blur-sm">
					<div className="px-4 md:px-6 lg:px-8 py-4">
						<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
							<h1 className="text-2xl font-bold gradient-text">{t('admin.shell.panel')}</h1>

							<nav
								className="flex flex-wrap items-center gap-2 text-sm"
								aria-label={t('common.breadcrumb')}
							>
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

				<main
					className={cn(
						'flex-1 relative z-10 p-4 md:p-6 lg:p-8 overflow-x-hidden',
						isTableGridClamped && 'lg:min-h-0 lg:overflow-hidden'
					)}
				>
					<div className={cn('w-full mx-auto max-w-[120rem]', isTableGridClamped && 'lg:h-full')}>
						<Outlet />
					</div>
				</main>

				{/* Footer */}
				<footer className="border-t border-border/50 py-4 relative z-10 bg-background/75 backdrop-blur-sm">
					<div className="px-4 md:px-6 lg:px-8 text-center text-xs text-muted-foreground">
						<p>{t('admin.shell.footer')}</p>
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
