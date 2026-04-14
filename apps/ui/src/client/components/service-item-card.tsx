import { Server, Settings } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

import type { UserService } from '@/lib/api'

interface ServiceItemCardProps {
	service: UserService
	onClick: () => void
}

export function ServiceItemCard({ service, onClick }: ServiceItemCardProps) {
	return (
		<Card
			className="group relative cursor-pointer"
			onClick={onClick}
			title={`Manage ${service.service.name}`}
		>
			<CardContent className="p-4">
				<div className="flex items-center gap-3">
					{service.service.icon ? (
						<img
							src={service.service.icon}
							alt={`${service.service.name} icon`}
							className="w-12 h-12 rounded-full border border-border/50 group-hover:border-primary/30 transition-colors shadow-md"
							onError={(e) => {
								;(e.currentTarget as HTMLImageElement).style.display = 'none'
								const fallback = e.currentTarget.nextElementSibling
								if (fallback) {
									;(fallback as HTMLElement).style.display = 'flex'
								}
							}}
						/>
					) : null}
					<div
						className={`w-12 h-12 rounded-full bg-muted items-center justify-center border border-border/50 group-hover:border-primary/30 transition-colors shadow-md ${
							service.service.icon ? 'hidden' : 'flex'
						}`}
					>
						<Server className="h-6 w-6 text-muted-foreground" />
					</div>
					<div className="flex-1 min-w-0">
						<h3 className="font-semibold truncate group-hover:text-primary transition-colors">
							{service.service.name}
						</h3>
						<div className="flex items-center gap-2 mt-1">
							<Badge
								variant="default"
								className={`text-xs ${
									service.enabled
										? 'bg-green-500/20 text-green-500'
										: 'bg-muted text-muted-foreground'
								}`}
							>
								{service.enabled ? 'Active' : 'Disabled'}
							</Badge>
						</div>
					</div>
					<Settings className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
				</div>
			</CardContent>
		</Card>
	)
}
