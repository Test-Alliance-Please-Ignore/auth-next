import {
	ArrowLeft,
	Building2,
	FolderKanban,
	MessageSquare,
	ScrollText,
	UserCircle,
	Users,
} from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

import { cn } from '@/lib/utils'

export function AdminNav() {
	const location = useLocation()

	const navItems = [
		{
			label: 'Categories',
			href: '/admin/categories',
			icon: FolderKanban,
		},
		{
			label: 'Groups',
			href: '/admin/groups',
			icon: Users,
		},
		{
			label: 'Corporations',
			href: '/admin/corporations',
			icon: Building2,
		},
		{
			label: 'Discord Servers',
			href: '/admin/discord-servers',
			icon: MessageSquare,
		},
		{
			label: 'Users',
			href: '/admin/users',
			icon: UserCircle,
		},
		{
			label: 'Activity Log',
			href: '/admin/activity-log',
			icon: ScrollText,
		},
	]

	return (
		<nav className="flex flex-col gap-2 p-4">
			<div className="mb-4">
				<h2 className="text-lg font-semibold gradient-text">Admin</h2>
				<p className="text-sm text-muted-foreground">System Management</p>
			</div>

			{navItems.map((item) => {
				const isActive = location.pathname.startsWith(item.href)
				const Icon = item.icon

				return (
					<Link
						key={item.href}
						to={item.href}
						className={cn(
							'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
							'hover:bg-accent hover:text-accent-foreground',
							isActive
								? 'bg-accent text-accent-foreground border-l-2 border-primary'
								: 'text-muted-foreground'
						)}
					>
						<Icon className="h-4 w-4" />
						{item.label}
					</Link>
				)
			})}

			{/* Exit Admin Panel Link */}
			<div className="mt-4 pt-4 border-t border-border">
				<Link
					to="/dashboard"
					className={cn(
						'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
						'hover:bg-accent/50 hover:text-accent-foreground',
						'text-muted-foreground border border-border'
					)}
				>
					<ArrowLeft className="h-4 w-4" />
					Back to Dashboard
				</Link>
			</div>
		</nav>
	)
}
