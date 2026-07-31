import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowLeft } from 'lucide-react'

import { MemberAvatar } from '@/components/member-avatar'
import { Badge } from '@/components/ui/badge'
import type { BadgeVariant } from '@/components/ui/badge'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Separator } from '@/components/ui/separator'

export function UserProfilePageShell({
	rootLabel,
	rootTo,
	midLabel,
	backTarget,
	backLabel,
	accountName,
	userId,
	mainCharacterId,
	mainCharacterName,
	sidebarBadges,
	sidebarStats,
	sidebarFooter,
	children,
}: {
	rootLabel: string
	rootTo: string
	midLabel: string
	backTarget: string
	backLabel: string
	accountName: string
	userId: string
	mainCharacterId?: string | null
	mainCharacterName?: string | null
	sidebarBadges?: ReactNode
	sidebarStats?: ReactNode
	sidebarFooter?: ReactNode
	children: ReactNode
}) {
	return (
		<Container>
			<div className="flex items-center justify-between mb-6">
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink to={rootTo}>{rootLabel}</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbLink to={backTarget}>{midLabel}</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{accountName}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
				<Button variant="ghost" asChild>
					<Link to={backTarget}>
						<ArrowLeft className="h-4 w-4" />
						{backLabel}
					</Link>
				</Button>
			</div>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
				<div className="space-y-4 lg:sticky lg:top-8 lg:self-start">
					<Card>
						<CardContent className="pt-6">
							<div className="flex flex-col items-center space-y-3 text-center">
								{mainCharacterId && mainCharacterName && (
									<MemberAvatar
										characterId={mainCharacterId}
										characterName={mainCharacterName}
										size="lg"
									/>
								)}
								<div className="space-y-1">
									<h1 className="text-xl font-bold">{accountName}</h1>
									<p className="font-mono text-xs text-muted-foreground">User ID: {userId}</p>
								</div>
								<div className="flex flex-wrap items-center justify-center gap-2">
									{sidebarBadges}
								</div>
							</div>
						</CardContent>
					</Card>

					{sidebarStats ? (
						<Card>
							<CardContent className="space-y-3 pt-6">
								{sidebarStats}
							</CardContent>
						</Card>
					) : null}

					{sidebarFooter}
				</div>

				<div className="space-y-6">{children}</div>
			</div>
		</Container>
	)
}

export function UserProfileStatRow({
	label,
	value,
}: {
	label: string
	value: ReactNode
}) {
	return (
		<div className="flex justify-between text-sm">
			<span className="text-muted-foreground">{label}</span>
			<span className="font-medium">{value}</span>
		</div>
	)
}

export function UserProfileStatusBadge({
	children,
	variant = 'secondary',
}: {
	children: ReactNode
	variant?: BadgeVariant
}) {
	return (
		<Badge variant={variant} className="gap-1">
			{children}
		</Badge>
	)
}

export function UserProfileStatsSeparator() {
	return <Separator />
}
