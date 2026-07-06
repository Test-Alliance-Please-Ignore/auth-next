import {
	ArrowLeft,
	ArchiveRestore,
	Building2,
	ChevronDown,
	ChevronRight,
	Coins,
	FileText,
	Factory,
	FolderKanban,
	Key,
	Link2,
	MessageSquare,
	Radio,
	Receipt,
	ScrollText,
	ShieldBan,
	Waypoints,
	UserCircle,
	Users,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface AdminNavProps {
	onNavigate?: () => void
}

function isRouteActive(pathname: string, href: string): boolean {
	return pathname === href || pathname.startsWith(`${href}/`)
}

export function AdminNav({ onNavigate }: AdminNavProps) {
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
			label: 'Users',
			href: '/admin/users',
			icon: UserCircle,
		},
		{
			label: 'Groups',
			href: '/admin/groups',
			icon: Users,
		},
		{
			label: 'Categories',
			href: '/admin/categories',
			icon: FolderKanban,
		},
		{
			label: 'Permissions',
			href: '/admin/permissions/categories',
			icon: Key,
		},
		{
			label: 'Corporations',
			href: '/admin/corporations',
			icon: Building2,
		},
		{
			label: 'Structures',
			href: '/admin/structures',
			icon: Building2,
		},
		{
			label: 'Discord',
			href: '/admin/discord',
			icon: MessageSquare,
			children: [
				{ label: 'Servers', href: '/admin/discord-servers' },
				{ label: 'Commands', href: '/admin/discord-commands' },
				{ label: 'Member Audit', href: '/admin/discord-audit' },
			],
		},
		{
			label: 'Broadcasts',
			href: '/admin/broadcasts',
			icon: Radio,
			children: [
				{ label: 'History', href: '/admin/broadcasts' },
				{ label: 'Targets', href: '/admin/broadcasts-targets' },
				{ label: 'Templates', href: '/admin/broadcasts-templates' },
			],
		},
		{
			label: 'Bills',
			href: '/admin/bills',
			icon: Receipt,
		},
		{
			label: 'DKP',
			href: '/admin/dkp',
			icon: Coins,
		},
		{
			label: 'Industry Providers',
			href: '/admin/industry-providers',
			icon: Factory,
		},
		{
			label: 'Pastes',
			href: '/admin/pastes',
			icon: FileText,
		},
		{
			label: 'Legacy Migrations',
			href: '/admin/legacy-migrations',
			icon: ArchiveRestore,
		},
		{
			label: 'Third-Party Apps',
			href: '/admin/third-party-apps',
			icon: Waypoints,
		},
		{
			label: 'External Links',
			href: '/admin/external-links',
			icon: Link2,
		},
		{
			label: 'Blacklist',
			href: '/admin/blacklist',
			icon: ShieldBan,
		},
		{
			label: 'Activity Log',
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
					Admin
				</Link>
				<p className="text-xs text-muted-foreground mt-1">System Management</p>
			</div>

			<div className="flex-1 p-4 space-y-1 overflow-y-auto">
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
									<span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold leading-none text-destructive-foreground ring-1 ring-destructive/80">
										{pendingLegacyMigrationsCount > 99 ? '99+' : pendingLegacyMigrationsCount}
									</span>
								) : null}
							</span>
						</Link>
					)
				})}

				<div className="mt-4 pt-4 border-t border-border">
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
						Back to Dashboard
					</Link>
				</div>
			</div>
		</nav>
	)
}
