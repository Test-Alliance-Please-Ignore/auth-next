import {
	Building2,
	FolderHeart,
	LayoutDashboard,
	LogOut,
	Mail,
	Radio,
	Shield,
	Users,
} from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

import { useHasCorporationAccess } from '@/features/my-corporations'
import { useAuth, useLogout } from '@/hooks/useAuth'
import { usePendingInvitations } from '@/hooks/useGroups'
import { cn } from '@/lib/utils'

import { Badge } from './ui/badge'
import { Button } from './ui/button'

interface SidebarNavProps {
	onNavigate?: () => void
}

export function SidebarNav({ onNavigate }: SidebarNavProps) {
	const location = useLocation()
	const { user } = useAuth()
	const logout = useLogout()
	const { data: invitations } = usePendingInvitations()
	const { data: corporationAccess } = useHasCorporationAccess()

	const pendingCount = invitations?.length || 0
	const mainCharacter = user?.characters.find((c) => c.characterId === user.mainCharacterId)

	const navItems: Array<{
		label: string
		href: string
		icon: any
		badge?: number
	}> = [
		{
			label: 'Dashboard',
			href: '/dashboard',
			icon: LayoutDashboard,
		},
		{
			label: 'Groups',
			href: '/groups',
			icon: Users,
		},
		{
			label: 'My Groups',
			href: '/my-groups',
			icon: FolderHeart,
		},
	]

	// Add My Corporations nav item if user has CEO/director access
	if (corporationAccess?.hasAccess) {
		navItems.push({
			label: 'My Corporations',
			href: '/my-corporations',
			icon: Building2,
		})
	}

	// Continue with other nav items
	navItems.push(
		{
			label: 'Invitations',
			href: '/invitations',
			icon: Mail,
			badge: pendingCount > 0 ? pendingCount : undefined,
		},
		{
			label: 'Broadcasts',
			href: '/broadcasts',
			icon: Radio,
		}
	)

	// Add admin nav item if user is admin
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
				<Link
					to="/dashboard"
					onClick={onNavigate}
					className="text-xl font-bold gradient-text block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
				>
					TANG
				</Link>
				<p className="text-xs text-muted-foreground mt-1">Test Auth Next Gen</p>
			</div>

			{/* Navigation Items */}
			<nav className="flex-1 p-4 space-y-1 overflow-y-auto">
				{navItems.map((item) => {
					const isActive =
						location.pathname === item.href || location.pathname.startsWith(item.href + '/')
					const Icon = item.icon

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
									? 'bg-accent text-accent-foreground border-l-4 border-primary shadow-sm'
									: 'text-muted-foreground border-l-4 border-transparent'
							)}
						>
							<Icon className={cn('h-5 w-5 flex-shrink-0', isActive && 'text-primary')} />
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
							src={`https://images.evetech.net/characters/${mainCharacter.characterId}/portrait?size=64`}
							alt={`${mainCharacter.characterName}'s portrait`}
							loading="lazy"
							onError={(e) => {
								;(e.currentTarget as HTMLImageElement).src =
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
					variant="outline"
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
