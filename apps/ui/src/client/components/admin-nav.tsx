import { Link, useLocation } from 'react-router-dom'
import { FolderKanban, Users } from 'lucide-react'

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
	]

	return (
		<nav className="flex flex-col gap-2 p-4">
			<div className="mb-4">
				<h2 className="text-lg font-semibold gradient-text">Admin</h2>
				<p className="text-sm text-muted-foreground">Groups Management</p>
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
		</nav>
	)
}
