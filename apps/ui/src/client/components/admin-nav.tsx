import { useQuery } from '@tanstack/react-query'
import {
	ArchiveRestore,
	ArrowLeft,
	Building2,
	ChevronDown,
	ChevronRight,
	Coins,
	Factory,
	FileText,
	FolderKanban,
	Key,
	Link2,
	MessageSquare,
	Radio,
	Receipt,
	ScrollText,
	ShieldAlert,
	ShieldBan,
	UserCircle,
	Users,
	Wallet,
	Waypoints,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router'

import { LocalePicker } from '@/components/locale-picker'
import { formatNumber, useAppTranslation } from '@/i18n'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

import { Badge } from './ui/badge'

interface AdminNavProps {
	onNavigate?: () => void
}

function isRouteActive(pathname: string, href: string): boolean {
	return pathname === href || pathname.startsWith(`${href}/`)
}

export function AdminNav({ onNavigate }: AdminNavProps) {
	const { t } = useAppTranslation()
	const location = useLocation()
	const { data: pendingLegacyMigrationsCount = 0 } = useQuery({
		queryKey: ['admin-nav', 'legacy-migrations', 'pending-count'],
		queryFn: async () => {
			const result = await api.getLegacyMigrationPendingUserCount()
			return result.count
		},
	})
	const isBroadcastRoute =
		location.pathname === '/admin/broadcasts' || location.pathname.startsWith('/admin/broadcasts/')
	const isDiscordRoute =
		location.pathname === '/admin/discord-servers' ||
		location.pathname === '/admin/discord-commands' ||
		location.pathname.startsWith('/admin/discord-')
	const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({
		'/admin/broadcasts': isBroadcastRoute,
		'/admin/discord': isDiscordRoute,
	})

	const toggleMenu = (href: string) => {
		setOpenMenus((prev) => ({ ...prev, [href]: !prev[href] }))
	}

	const navItems = [
		{
			label: t('admin.nav.users'),
			href: '/admin/users',
			icon: UserCircle,
		},
		{
			label: t('admin.nav.groups'),
			href: '/admin/groups',
			icon: Users,
		},
		{
			label: t('admin.nav.categories'),
			href: '/admin/categories',
			icon: FolderKanban,
		},
		{
			label: t('admin.nav.permissions'),
			href: '/admin/permissions/categories',
			icon: Key,
		},
		{
			label: t('admin.nav.corporations'),
			href: '/admin/corporations',
			icon: Building2,
		},
		{
			label: t('admin.nav.structures'),
			href: '/admin/structures',
			icon: Building2,
		},
		{
			label: t('admin.nav.discord'),
			href: '/admin/discord',
			icon: MessageSquare,
			children: [
				{ label: t('admin.nav.servers'), href: '/admin/discord-servers' },
				{ label: t('admin.nav.commands'), href: '/admin/discord-commands' },
				{ label: t('admin.nav.memberAudit'), href: '/admin/discord-audit' },
			],
		},
		{
			label: t('admin.nav.broadcasts'),
			href: '/admin/broadcasts',
			icon: Radio,
			children: [
				{ label: t('admin.nav.history'), href: '/admin/broadcasts' },
				{ label: t('admin.nav.targets'), href: '/admin/broadcasts-targets' },
				{ label: t('admin.nav.templates'), href: '/admin/broadcasts-templates' },
			],
		},
		{
			label: t('admin.nav.bills'),
			href: '/admin/bills',
			icon: Receipt,
		},
		{
			label: t('admin.nav.dkp'),
			href: '/admin/dkp',
			icon: Coins,
		},
		{
			label: t('admin.nav.predictionMarkets'),
			href: '/admin/prediction-markets',
			icon: Wallet,
			children: [
				{ label: t('admin.nav.markets'), href: '/admin/prediction-markets/markets' },
				{ label: t('admin.nav.wallets'), href: '/admin/prediction-markets/wallets' },
				{ label: t('admin.nav.auditLog'), href: '/admin/prediction-markets/audit' },
				{ label: t('admin.nav.config'), href: '/admin/prediction-markets/config' },
			],
		},
		{
			label: t('admin.nav.industryProviders'),
			href: '/admin/industry-providers',
			icon: Factory,
		},
		{
			label: t('admin.nav.pastes'),
			href: '/admin/pastes',
			icon: FileText,
		},
		{
			label: t('admin.nav.legacyMigrations'),
			href: '/admin/legacy-migrations',
			icon: ArchiveRestore,
		},
		{
			label: t('admin.nav.thirdPartyApps'),
			href: '/admin/third-party-apps',
			icon: Waypoints,
		},
		{
			label: t('admin.nav.externalLinks'),
			href: '/admin/external-links',
			icon: Link2,
		},
		{
			// Top-level, NOT nested under Discord: this audit covers Mumble as well,
			// and `isDiscordRoute` only auto-opens that menu for /admin/discord-*.
			// An emergency tool nobody can find at 04:00 is not shipped.
			label: t('admin.nav.servicesAudit'),
			href: '/admin/services-audit',
			icon: ShieldAlert,
		},
		{
			label: t('admin.nav.blocklist'),
			href: '/admin/blacklist',
			icon: ShieldBan,
		},
		{
			label: t('admin.nav.activityLog'),
			href: '/admin/activity-log',
			icon: ScrollText,
		},
	]

	return (
		<nav className="flex flex-col h-full">
			<div className="p-6 border-b border-border/50">
				<Link
					to="/admin"
					onClick={onNavigate}
					className="text-xl font-bold gradient-text block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
				>
					{t('admin.shell.admin')}
				</Link>
				<p className="text-xs text-muted-foreground mt-1">{t('admin.shell.management')}</p>
			</div>

			<div className="flex-1 p-4 space-y-1 overflow-y-auto overscroll-contain">
				{navItems.map((item) => {
					const childActive = (item.children ?? []).some((child) =>
						isRouteActive(location.pathname, child.href)
					)
					const isActive = childActive || isRouteActive(location.pathname, item.href)
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
									<Icon className="h-5 w-5 flex-shrink-0" />
									<span className="flex-1 text-left">{item.label}</span>
									{openMenus[item.href] ? (
										<ChevronDown className="h-4 w-4 opacity-70" />
									) : (
										<ChevronRight className="h-4 w-4 opacity-70" />
									)}
								</button>

								{openMenus[item.href] && (
									<div className="ml-7 mt-1 space-y-1">
										{item.children.map((child) => {
											const isChildActive = isRouteActive(location.pathname, child.href)
											return (
												<Link
													key={child.href}
													to={child.href}
													onClick={onNavigate}
													className={cn(
														'block rounded-lg px-3 py-2 text-sm transition-all',
														'hover:bg-accent/50 hover:text-accent-foreground',
														isChildActive
															? 'border-l-4 border-primary bg-[hsl(var(--accent-muted))] text-foreground shadow-sm'
															: 'text-muted-foreground border-l-4 border-transparent'
													)}
												>
													{child.label}
												</Link>
											)
										})}
									</div>
								)}
							</div>
						)
					}

					return (
						<Link
							key={item.href}
							to={item.href}
							onClick={onNavigate}
							className={cn(
								'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
								'hover:bg-accent/50 hover:text-accent-foreground',
								'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
								isActive
									? 'border-l-4 border-primary bg-[hsl(var(--accent-muted))] text-foreground shadow-sm'
									: 'text-muted-foreground border-l-4 border-transparent'
							)}
						>
							<Icon className="h-5 w-5 flex-shrink-0" />
							<span className="flex items-center gap-2">
								{item.label}
								{item.href === '/admin/legacy-migrations' && pendingLegacyMigrationsCount > 0 ? (
									<Badge
										variant="destructive"
										solid
										className="h-5 min-w-5 border-0 px-1.5 text-[10px] leading-none ring-1 ring-destructive/80"
									>
										{pendingLegacyMigrationsCount > 99
											? t('admin.shell.countOverflow', { value: formatNumber(99) })
											: formatNumber(pendingLegacyMigrationsCount)}
									</Badge>
								) : null}
							</span>
						</Link>
					)
				})}

				<div className="mt-4 pt-4 border-t border-border">
					<div className="mb-4">
						<LocalePicker />
					</div>
					<Link
						to="/dashboard"
						onClick={onNavigate}
						className={cn(
							'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
							'hover:bg-accent/50 hover:text-accent-foreground',
							'text-muted-foreground border border-border'
						)}
					>
						<ArrowLeft className="h-4 w-4" />
						{t('admin.shell.dashboard')}
					</Link>
				</div>
			</div>
		</nav>
	)
}
