import {
	BookOpen,
	Briefcase,
	Building2,
	ChevronLeft,
	ChevronDown,
	ChevronRight,
	CircleDollarSign,
	ExternalLink,
	FileText,
	FolderHeart,
	Globe,
	LayoutDashboard,
	LogOut,
	Mail,
	Mic,
	Moon,
	Package,
	Radar,
	Radio,
	Receipt,
	Scale,
	Shield,
	Swords,
	Truck,
	Users,
} from 'lucide-react'
import { DynamicIcon } from 'lucide-react/dynamic.mjs'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'
import { useCorporationAccess } from '@/features/corporations'
import { useHrAccessibleCorporations } from '@/features/hr'
import { useHasCorporationAccess } from '@/features/corporations'
import { useSrpPaymentMismatchAlerts } from '@/features/srp/hooks'
import { useReviewQueueStatusCount } from '@/features/srp/state/review-queue-snapshot-store'
import { canAccessMumble } from '@/features/mumble/access'
import { useMumbleFeatureEnabled } from '@/features/mumble/feature'
import { useMoonScanPermissions } from '@/features/moon-scan/permissions'
import { useTaxAlerts } from '@/hooks/corporation-tax'
import { useAuth, useLogout } from '@/hooks/useAuth'
import { usePendingInvitations } from '@/hooks/useGroups'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { api } from '@/lib/api'
import { characterPortraitUrl } from '@/lib/eve-images'
import { extractCorporationIdFromTaxViewerScopedUrn } from '@/lib/tax-permissions'
import { cn } from '@/lib/utils'
import { resolveSidebarExternalLinkIconName } from '@/lib/sidebar-external-links'
import {
	hasAnyStructurePermission,
	hasAllStructureManagerPermission,
} from '@repo/groups'

import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { resolveSrpNavState } from './sidebar-nav.srp'

interface SidebarNavProps {
	onNavigate?: () => void
	isSidebarOpen?: boolean
	onToggleSidebar?: () => void
}

interface SidebarNavItem {
	label: string
	href: string
	icon?: any
	badge?: number
	external?: boolean
	isActive?: boolean
	children?: SidebarNavItem[]
}

export function SidebarNav({ onNavigate, isSidebarOpen = true, onToggleSidebar }: SidebarNavProps) {
	const location = useLocation()
	const { user } = useAuth()
	const logout = useLogout()
	const { data: corporationAccess } = useHasCorporationAccess()
	const { data: leadershipCorporationAccess } = useCorporationAccess()
	const { data: hrCorporations } = useHrAccessibleCorporations()
	const { permissions, hasAnyPermission } = useUserPermissions()
	const moonScanPermissions = useMoonScanPermissions()
	const isSiteAdmin = user?.is_admin === true
	const isAllianceMember = user?.roles?.includes(ROLE_CORE_ALLIANCE_MEMBER) ?? false
	const canSeeAllianceMemberNav = isSiteAdmin || isAllianceMember
	const { data: invitations } = usePendingInvitations({ enabled: canSeeAllianceMemberNav })
	const { isEnabled: isMumbleFeatureEnabled } = useMumbleFeatureEnabled()
	const canViewStructures = isSiteAdmin || hasAnyStructurePermission(permissions)
	const hasSrpManagerPermission = hasAnyPermission('urn:srp:manager')
	const hasSrpPayerPermission = hasAnyPermission('urn:srp:payer')
	const hasSrpReviewerPermission = hasAnyPermission('urn:srp:reviewer')
	const { data: sidebarExternalLinks } = useQuery({
		queryKey: ['sidebar', 'external-links'],
		queryFn: () => api.getSidebarExternalLinks(),
		enabled: canSeeAllianceMemberNav,
		staleTime: 1000 * 60 * 5,
		gcTime: 1000 * 60 * 5,
	})
	const resolvedSidebarExternalLinks = canSeeAllianceMemberNav ? (sidebarExternalLinks ?? []) : []
	const previewSrpState = resolveSrpNavState({
		isSiteAdmin,
		hasSrpReviewerPermission,
		hasSrpPayerPermission,
		hasSrpManagerPermission,
		reviewQueueCount: 0,
		paymentQueueCount: 0,
		srpAlertCount: 0,
	})
	const shouldFetchSrpReviewCount = previewSrpState.shouldFetchSrpReviewCount
	const shouldFetchSrpPaymentCount = previewSrpState.shouldFetchSrpPaymentCount
	const shouldFetchSrpAlertCount = previewSrpState.shouldFetchSrpAlertCount
	const derivedReviewQueueCount = useReviewQueueStatusCount('pending')
	const derivedPaymentQueueCount = useReviewQueueStatusCount('approved')
	const { data: reviewQueueData } = useQuery({
		queryKey: ['srp', 'sidebar-review-count'],
		queryFn: () => api.get<{ total: number }>('/srp/requests/by-status?status=pending&limit=1&offset=0'),
		placeholderData: (previousData) => previousData,
		staleTime: 1000 * 60 * 5,
		gcTime: 1000 * 60 * 5,
		enabled: shouldFetchSrpReviewCount && derivedReviewQueueCount === undefined,
	})
	const { data: paymentQueueData } = useQuery({
		queryKey: ['srp', 'sidebar-payment-count'],
		queryFn: () => api.get<{ total: number }>('/srp/requests/by-status?status=approved&limit=1&offset=0'),
		placeholderData: (previousData) => previousData,
		staleTime: 1000 * 60 * 5,
		gcTime: 1000 * 60 * 5,
		enabled: shouldFetchSrpPaymentCount && derivedPaymentQueueCount === undefined,
	})
	const { data: srpAlertData } = useSrpPaymentMismatchAlerts({
		includeAcknowledged: false,
		limit: 1,
		offset: 0,
	}, { enabled: shouldFetchSrpAlertCount })
	const reviewQueueCount = shouldFetchSrpReviewCount ? (derivedReviewQueueCount ?? reviewQueueData?.total ?? 0) : 0
	const paymentQueueCount = shouldFetchSrpPaymentCount ? (derivedPaymentQueueCount ?? paymentQueueData?.total ?? 0) : 0
	const srpAlertCount = shouldFetchSrpAlertCount ? (srpAlertData?.total ?? 0) : 0
	const srpNavState = resolveSrpNavState({
		isSiteAdmin,
		hasSrpReviewerPermission,
		hasSrpPayerPermission,
		hasSrpManagerPermission,
		reviewQueueCount,
		paymentQueueCount,
		srpAlertCount,
	})

	const pendingCount = invitations?.length || 0
	const mainCharacter = user?.characters.find((c) => c.characterId === user.mainCharacterId)
	const canSeeMumble = isMumbleFeatureEnabled && canAccessMumble(user)
	const hasMemberCorporationAccess = hrCorporations?.some((corp) => corp.isMemberCorporation) ?? false
	const hasFleetStatsAccess =
		leadershipCorporationAccess?.corporations.some(
			(corp) =>
				corp.isMemberCorporation &&
				(corp.userRole === 'CEO' || corp.userRole === 'Director' || corp.userRole === 'admin')
		) ?? false
	const canSeeFleetTrackingList =
		isSiteAdmin ||
		hasAnyPermission('urn:fleet-tracking:create') ||
		hasAnyPermission('urn:fleet-tracking:view-fleets') ||
		hasAnyPermission('urn:fleet-tracking:view-all')
	const canSeeFleetTrackingStats =
		isSiteAdmin || hasAnyPermission('urn:fleet-tracking:view-all') || hasFleetStatsAccess
	const isTaxRoute = location.pathname === '/tax' || location.pathname.startsWith('/tax/')
	const isFreightRoute =
		location.pathname === '/freight' || location.pathname.startsWith('/freight/')
	const isSrpRoute = location.pathname === '/srp' || location.pathname.startsWith('/srp/')
	const isHrRoute =
		location.pathname === '/my-applications' ||
		location.pathname.startsWith('/my-applications/') ||
		location.pathname === '/join' ||
		location.pathname.startsWith('/join/') ||
		location.pathname === '/corporations' ||
		/^\/corporations\/[^/]+\/members/.test(location.pathname) ||
		/^\/corporations\/[^/]+\/settings/.test(location.pathname) ||
		location.pathname.startsWith('/hr/') ||
		location.pathname === '/recommendations' ||
		location.pathname.startsWith('/recommendations/') ||
		/^\/corporations\/\d+\/hr/.test(location.pathname)
	const isStructuresRoute =
		location.pathname === '/structures' || location.pathname.startsWith('/structures/')
	const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({
		'/tax': isTaxRoute,
		'/freight': isFreightRoute,
		'/srp': isSrpRoute,
		'#hr': isHrRoute || !canSeeAllianceMemberNav,
		'#external': canSeeAllianceMemberNav,
	})

	const toggleMenu = (href: string) => {
		setOpenMenus((prev) => ({ ...prev, [href]: !prev[href] }))
	}

	useEffect(() => {
		if (isTaxRoute) {
			setOpenMenus((prev) => ({ ...prev, '/tax': true }))
		}
	}, [isTaxRoute])

	useEffect(() => {
		if (isFreightRoute) {
			setOpenMenus((prev) => ({ ...prev, '/freight': true }))
		}
	}, [isFreightRoute])

	useEffect(() => {
		if (isSrpRoute) {
			setOpenMenus((prev) => ({ ...prev, '/srp': true }))
		}
	}, [isSrpRoute])

	useEffect(() => {
		if (isHrRoute || !canSeeAllianceMemberNav) {
			setOpenMenus((prev) => ({ ...prev, '#hr': true }))
		}
	}, [isHrRoute, canSeeAllianceMemberNav])

	useEffect(() => {
		if (canSeeAllianceMemberNav) {
			setOpenMenus((prev) => ({ ...prev, '#external': true }))
		}
	}, [canSeeAllianceMemberNav])

	useEffect(() => {
		if (location.pathname.startsWith('/fleet-tracking')) {
			setOpenMenus((prev) => ({ ...prev, '/fleet-tracking': true }))
		}
	}, [location.pathname])

	const navItems: SidebarNavItem[] = [
		{
			label: 'Dashboard',
			href: '/dashboard',
			icon: LayoutDashboard,
		},
	]

	// HR section - always visible with at least My Applications and Join
	{
		const hrItems: SidebarNavItem[] = [
			{
				label: 'My Applications',
				href: '/my-applications',
			},
			{
				label: 'Join Corporations',
				href: '/join',
			},
		]
		if (canSeeAllianceMemberNav) {
			hrItems.push({
				label: 'Recommendations',
				href: '/recommendations',
			})
		}

		const isAuditor = hasAnyPermission('urn:hr:auditor')
		const hasCorporationModuleAccess =
			(corporationAccess?.hasAccess ?? false) || (hrCorporations?.length ?? 0) > 0 || isAuditor
		const canSeeLegacyApplications =
			isSiteAdmin || isAuditor || (hrCorporations?.some((corp) => corp.isMemberCorporation) ?? false)
		const isHrOnlyUser =
			!(corporationAccess?.hasAccess ?? false) && ((hrCorporations?.length ?? 0) > 0 || isAuditor)
		const isOnCorpHrRoute = /^\/corporations\/[^/]+\/hr/.test(location.pathname)

		if (hasCorporationModuleAccess) {
			hrItems.push({
				label: 'Corporations',
				href: '/corporations',
				isActive:
					location.pathname === '/corporations' ||
					(isOnCorpHrRoute && isHrOnlyUser) ||
					/^\/corporations\/[^/]+\/members/.test(location.pathname) ||
					/^\/corporations\/[^/]+\/settings/.test(location.pathname),
			})
		}

		if (isAuditor || isSiteAdmin) {
			hrItems.push({
				label: 'User Search',
				href: '/hr/users',
			})
		}

		if (canSeeLegacyApplications) {
			hrItems.push({
				label: 'Legacy Applications',
				href: '/hr/legacy-history',
			})
		}

		navItems.push({
			label: 'HR',
			href: '#hr',
			icon: Briefcase,
			children: hrItems,
		})
	}

	if (canSeeFleetTrackingList || canSeeFleetTrackingStats) {
		const fleetTrackingItems: SidebarNavItem[] = []
		if (canSeeFleetTrackingList) {
			fleetTrackingItems.push({ label: 'Fleets', href: '/fleet-tracking' })
		}
		if (canSeeFleetTrackingStats) {
			fleetTrackingItems.push({ label: 'Statistics', href: '/fleet-tracking/stats' })
		}

		navItems.push({
			label: 'Fleet Tracking',
			href: canSeeFleetTrackingList ? '/fleet-tracking' : '/fleet-tracking/stats',
			icon: Radar,
			children: fleetTrackingItems.length > 0 ? fleetTrackingItems : undefined,
		})
	}

	if (canSeeAllianceMemberNav) {
		navItems.push(
			{
				label: 'Invitations',
				href: '/invitations',
				icon: Mail,
				badge: pendingCount > 0 ? pendingCount : undefined,
			},
			{
				label: 'My Groups',
				href: '/my-groups',
				icon: FolderHeart,
			},
			{
				label: 'Groups',
				href: '/groups',
				icon: Users,
			},
			...(canViewStructures
				? [
						{
							label: 'Structures',
							href: '/structures',
							icon: Building2,
							isActive: isStructuresRoute,
						},
					]
				: []),
			{
				label: 'Skill Plans',
				href: '/skill-plans',
				icon: BookOpen,
			},
			{
				label: 'Doctrines',
				href: '/doctrines',
				icon: Swords,
			},
		)

		navItems.push(
			{
				...srpNavState.navItem,
				icon: CircleDollarSign,
			},
			{
				label: 'My Bills',
				href: '/my-bills',
				icon: Receipt,
			},
			...(canSeeMumble
				? [
						{
							label: 'Mumble',
							href: '/mumble',
							icon: Mic,
						},
					]
				: []),
			{
				label: 'Freight',
				href: '/freight',
				icon: Truck,
				children: [
					{ label: 'Calculator', href: '/freight' },
					{ label: 'Open Contracts', href: '/freight/contracts' },
					{ label: 'Leaderboard', href: '/freight/leaderboard' },
					...(isSiteAdmin || hasAnyPermission('urn:freight:manager')
						? [{ label: 'Manage Routes', href: '/freight/manage' }]
						: []),
				],
			},
		)

		const canSeeMoonScanNav = moonScanPermissions.canAccessMoonScan

		if (canSeeMoonScanNav) {
			navItems.push({
				label: 'Moon Scanning',
				href: '/moon-scan',
				icon: Moon,
				children: [
					...(moonScanPermissions.canView
						? [
								{ label: 'Regions', href: '/moon-scan' },
								{ label: 'Scanned Moons', href: '/moon-scan/scanned' },
							]
						: []),
					...(moonScanPermissions.canSubmit
						? [
								{ label: 'Submit Scan', href: '/moon-scan/submit' },
								{ label: 'My Scans', href: '/moon-scan/my-scans' },
							]
						: []),
					...(moonScanPermissions.canLeaderboard
						? [{ label: 'Leaderboard', href: '/moon-scan/leaderboard' }]
						: []),
					...(moonScanPermissions.canValidate
						? [{ label: 'Validation Queue', href: '/moon-scan/queue' }]
						: []),
					...(moonScanPermissions.canAdmin
						? [{ label: 'Configuration', href: '/moon-scan/settings' }]
						: []),
				],
			})
		}

		navItems.push({
			label: 'Broadcasts',
			href: '/broadcasts',
			icon: Radio,
		})

		navItems.push({
			label: 'Inventory Parser',
			href: '/inventory-parser',
			icon: Package,
		})

		navItems.push({
			label: 'Pastes',
			href: '/pastes',
			icon: FileText,
		})

		// Prediction markets: visible to anyone who can create one (managers + admins also pass).
		if (hasAnyPermission('urn:markets:creator', 'urn:markets:manager')) {
			navItems.push({
				label: 'Prediction Markets',
				href: '/prediction-markets',
				icon: CircleDollarSign,
			})
		}

		const externalLinkChildren = resolvedSidebarExternalLinks.map((link) => ({
			label: link.displayName,
			href: link.url,
			icon: (props: { className?: string }) => (
				<DynamicIcon name={resolveSidebarExternalLinkIconName(link.iconName)} {...props} />
			),
			external: true,
		}))

		if (externalLinkChildren.length > 0) {
			navItems.push({
				label: 'External',
				href: '#external',
				icon: ExternalLink,
				children: externalLinkChildren,
			})
		}

		const canReadTaxFeature =
			isSiteAdmin ||
			permissions.some(
				(permission) => extractCorporationIdFromTaxViewerScopedUrn(permission.urn) !== null
			) ||
			hasAnyPermission('urn:tax:auditor', 'urn:tax:admin') ||
			!!corporationAccess?.hasAccess
		const canAuditTaxFeature = isSiteAdmin || hasAnyPermission('urn:tax:auditor', 'urn:tax:admin')
		const canManageTaxFeature = isSiteAdmin || hasAnyPermission('urn:tax:admin')
		const { data: openTaxAlerts = [] } = useTaxAlerts({
			status: 'open',
			limit: 200,
			enabled: canManageTaxFeature,
		})
		const openTaxAlertCount = openTaxAlerts.length

		if (canReadTaxFeature) {
			const taxItems: SidebarNavItem[] = []
			taxItems.push({
				label: 'Member Summary',
				href: '/tax/member-summary',
			})

			if (canAuditTaxFeature) {
				taxItems.push({
					label: 'Reports',
					href: '/tax/reports',
				})
				taxItems.push({
					label: 'Billing',
					href: '/tax/bills',
				})
			}

			if (canManageTaxFeature) {
				taxItems.push({
					label: 'Alerts',
					href: '/tax/alerts',
					badge: openTaxAlertCount > 0 ? openTaxAlertCount : undefined,
				})
				taxItems.push({
					label: 'Ledger',
					href: '/tax/ledger',
				})
				taxItems.push({
					label: 'Rules',
					href: '/tax/rules',
				})
				taxItems.push({
					label: 'Exclusions',
					href: '/tax/exclusions',
				})
				taxItems.push({
					label: 'Audit Log',
					href: '/tax/audit-log',
				})
			}

			navItems.push({
				label: 'Tax',
				href: '/tax',
				icon: Scale,
				children: taxItems,
			})
		}
	}

	// Add admin nav item if user is admin (bottom)
	if (user?.is_admin) {
		navItems.push({
			label: 'Admin',
			href: '/admin',
			icon: Shield,
		})
	}

	return (
		<div className="flex flex-col h-full">
			{/* Logo/Brand */}
			<div className="p-6 border-b border-border/50">
				<div className="flex items-center justify-between gap-2">
					<Link
						to="/dashboard"
						onClick={onNavigate}
						className="text-xl font-bold gradient-text block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
					>
						TANG
					</Link>
					{isSidebarOpen ? (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							onClick={onToggleSidebar}
							aria-label="Collapse navigation"
							className="h-8 w-8"
						>
							<ChevronLeft className="h-4 w-4" />
						</Button>
					) : null}
				</div>
				<p className="text-xs text-muted-foreground mt-1">Test Auth Next Gen</p>
			</div>

			{/* Navigation Items */}
			<nav className="flex-1 p-4 space-y-1 overflow-y-auto">
				{navItems.map((item) => {
					const childActive = (item.children ?? []).some(
						(child) =>
							!child.external &&
							(location.pathname === child.href || location.pathname.startsWith(child.href + '/'))
					)
					const isActive =
						childActive ||
						location.pathname === item.href ||
						location.pathname.startsWith(item.href + '/')
					const Icon = item.icon

					if (item.children && item.children.length > 0) {
						return (
							<div key={item.href} className="space-y-1">
								<button
									type="button"
									onClick={() => toggleMenu(item.href)}
									aria-expanded={!!openMenus[item.href]}
									className={cn(
										'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
										'hover:bg-accent/50 hover:text-accent-foreground',
										'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
										isActive
											? 'border-l-4 border-primary bg-[hsl(var(--accent-muted))] text-foreground shadow-sm'
											: 'text-muted-foreground border-l-4 border-transparent'
									)}
								>
									{Icon ? (
										<Icon className={cn('h-5 w-5 flex-shrink-0', isActive && 'text-primary')} />
									) : null}
									<span className="flex-1 text-left">{item.label}</span>
									{openMenus[item.href] ? (
										<ChevronDown className="h-4 w-4 opacity-70" />
									) : (
										<ChevronRight className="h-4 w-4 opacity-70" />
									)}
								</button>

								{openMenus[item.href] ? (
									<div className="ml-6 space-y-1 border-l border-border/60 pl-2">
										{item.children.map((child) => {
											const childIsActive =
												child.isActive ??
												(!child.external &&
													(child.href === item.href
														? location.pathname === child.href
														: location.pathname === child.href ||
														location.pathname.startsWith(child.href + '/')))

											if (child.external) {
												const ChildIcon = child.icon
												return (
													<a
														key={child.href}
														href={child.href}
														target="_blank"
														rel="noopener noreferrer"
														onClick={onNavigate}
														className={cn(
															'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all',
															'hover:bg-accent/50 hover:text-accent-foreground',
															'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
															'text-muted-foreground'
														)}
													>
														{ChildIcon ? <ChildIcon className="h-5 w-5 flex-shrink-0" /> : null}
														<span className="flex-1">{child.label}</span>
														<ExternalLink className="h-3 w-3 text-muted-foreground" />
													</a>
												)
											}

											return (
												<Link
													key={child.href}
													to={child.href}
													onClick={onNavigate}
													className={cn(
														'flex items-center rounded-lg px-3 py-2 text-sm transition-all',
														'hover:bg-accent/50 hover:text-accent-foreground',
														'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
														childIsActive
															? 'bg-[hsl(var(--accent-muted))] text-foreground font-medium'
															: 'text-muted-foreground'
													)}
												>
													<span className="inline-flex items-center gap-2 leading-none">
														<span>{child.label}</span>
														{child.badge ? (
															<span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold leading-none text-destructive-foreground ring-1 ring-destructive/80">
																{child.badge > 99 ? '99+' : child.badge}
															</span>
														) : null}
													</span>
												</Link>
											)
										})}
									</div>
								) : null}
							</div>
						)
					}

					if (item.external) {
						return (
							<a
								key={item.href}
								href={item.href}
								target="_blank"
								rel="noopener noreferrer"
								onClick={onNavigate}
								className={cn(
									'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
									'hover:bg-accent/50 hover:text-accent-foreground relative group',
									'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
									'text-muted-foreground border-l-4 border-transparent'
								)}
							>
								{Icon ? <Icon className="h-5 w-5 flex-shrink-0" /> : null}
								<span className="flex-1">{item.label}</span>
								<ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
							</a>
						)
					}

					return (
						<Link
							key={item.href}
							to={item.href}
							onClick={onNavigate}
							className={cn(
								'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
								'hover:bg-accent/50 hover:text-accent-foreground relative group',
								'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
								isActive
									? 'border-l-4 border-primary bg-[hsl(var(--accent-muted))] text-foreground shadow-sm'
									: 'text-muted-foreground border-l-4 border-transparent'
							)}
						>
							{Icon ? (
								<Icon className={cn('h-5 w-5 flex-shrink-0', isActive && 'text-primary')} />
							) : null}
							<span className="flex-1">{item.label}</span>
							{item.badge && (
								<Badge
									variant="destructive"
									className="h-5 min-w-[20px] px-1 text-[10px] flex items-center justify-center"
								>
									{item.badge}
								</Badge>
							)}
						</Link>
					)
				})}
			</nav>

			{/* User Section */}
			<div className="p-4 border-t border-border/50 space-y-3">
				{mainCharacter && (
					<div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-accent/30">
						<img
							src={characterPortraitUrl(mainCharacter.characterId, 64)}
							alt={`${mainCharacter.characterName}'s portrait`}
							loading="lazy"
							onError={(e) => {
								; (e.currentTarget as HTMLImageElement).src =
									'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"%3E%3Crect fill="%23404040" width="64" height="64"/%3E%3Ctext x="50%25" y="50%25" font-family="Arial" font-size="24" fill="%23bfbfbf" text-anchor="middle" dominant-baseline="middle"%3E?%3C/text%3E%3C/svg%3E'
							}}
							className="w-10 h-10 rounded-full border-2 border-primary/50"
						/>
						<div className="flex-1 min-w-0">
							<p className="text-sm font-medium truncate">{mainCharacter.characterName}</p>
							<p className="text-xs text-muted-foreground">Online</p>
						</div>
					</div>
				)}

				<Button
					variant="ghost"
					size="sm"
					onClick={() => logout.mutate()}
					disabled={logout.isPending}
					className="w-full justify-start gap-2"
				>
					<LogOut className="h-4 w-4" />
					{logout.isPending ? 'Logging out...' : 'Logout'}
				</Button>
			</div>
		</div>
	)
}
