import { ArrowLeft } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useDiscordServers, useStripDiscordGuildRoles } from '@/hooks/useDiscord'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { useAdminDiscordInspection, useAdminUser } from '@/hooks/useAdminUsers'
import { usePageTitle } from '@/hooks/usePageTitle'
import { Button } from '@/components/ui/button'

function renderRolePills(
	roles: Array<{ roleId: string; roleName: string | null }>,
	variant: 'secondary' | 'ghost',
	extraClassName?: string
) {
	if (roles.length === 0) {
		return <span className="text-xs text-muted-foreground">None</span>
	}

	return (
		<div className="flex flex-wrap gap-1">
			{roles.map((role) => (
				<Badge
					key={role.roleId}
					variant={variant}
					className={extraClassName}
					title={role.roleName ? `${role.roleName} (${role.roleId})` : role.roleId}
				>
					{role.roleName || role.roleId}
				</Badge>
			))}
		</div>
	)
}

export default function AdminUserDiscordAccessPage() {
	usePageTitle('Admin - User Discord Access')
	const { userId } = useParams<{ userId: string }>()
	const navigate = useNavigate()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()
	const { data: discordServers = [] } = useDiscordServers()
	const stripRoles = useStripDiscordGuildRoles()

	const { data: user, isLoading: userLoading } = useAdminUser(userId!)
	const {
		data: inspection,
		isLoading: inspectionLoading,
		error,
		refetch: refetchInspection,
	} = useAdminDiscordInspection(userId!, !!userId)

	const stripRolesForGuild = async (guildId: string) => {
		if (!inspection?.discordUserId) return
		const server = discordServers.find((s) => s.guildId === guildId)
		if (!server) return

		requestConfirmation({
			title: 'Strip all roles in this guild?',
			description:
				'This will clear all assignable roles for this user in the selected guild. This cannot be undone.',
			confirmLabel: 'Strip Roles',
			cancelLabel: 'Cancel',
			intent: 'destructive',
			onConfirm: async () => {
				await stripRoles.mutateAsync({
					serverId: server.id,
					discordUserIds: [inspection.discordUserId],
				})
				void refetchInspection()
			},
		})
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-4">
				<Button variant="ghost" onClick={() => navigate(`/admin/users/${userId}`)}>
					<ArrowLeft className="h-4 w-4" />
					Back to User
				</Button>
			</div>

			<div className="space-y-1">
				<h1 className="text-3xl font-bold gradient-text">Discord Access Inspection</h1>
				<p className="text-muted-foreground">
					{userLoading
						? 'Loading user...'
						: `Role and membership drift for ${user?.characters.find((c) => c.is_primary)?.characterName || 'user'}`}
				</p>
			</div>

			{inspectionLoading ? (
				<Card>
					<CardContent className="py-8 text-center text-muted-foreground">
						Loading Discord inspection...
					</CardContent>
				</Card>
			) : error ? (
				<Card className="border-destructive/30 bg-destructive/10">
					<CardContent className="py-4 text-destructive">
						Failed to inspect Discord access right now. Please try again.
					</CardContent>
				</Card>
			) : !inspection ? (
				<Card>
					<CardContent className="py-8 text-center text-muted-foreground">
						No inspection data available.
					</CardContent>
				</Card>
			) : (
				<>
					<div className="grid grid-cols-2 md:grid-cols-3 gap-3">
						<Card>
							<CardContent className="pt-4">
								<div className="text-xs text-muted-foreground">Guilds Inspected</div>
								<div className="text-xl font-semibold">{inspection.summary.guildsInspected}</div>
							</CardContent>
						</Card>
						<Card>
							<CardContent className="pt-4">
								<div className="text-xs text-muted-foreground">Member Guilds</div>
								<div className="text-xl font-semibold">{inspection.summary.memberGuilds}</div>
							</CardContent>
						</Card>
						<Card>
							<CardContent className="pt-4">
								<div className="text-xs text-muted-foreground">Guilds With Drift</div>
								<div className="text-xl font-semibold text-amber-700">
									{inspection.summary.guildsWithDrift}
								</div>
							</CardContent>
						</Card>
						<Card>
							<CardContent className="pt-4">
								<div className="text-xs text-muted-foreground">Missing Expected Managed</div>
								<div className="text-xl font-semibold text-amber-700">
									{inspection.summary.totalMissingExpectedManagedRoles}
								</div>
							</CardContent>
						</Card>
						<Card>
							<CardContent className="pt-4">
								<div className="text-xs text-muted-foreground">Unexpected Managed</div>
								<div className="text-xl font-semibold text-red-700">
									{inspection.summary.totalUnexpectedManagedRoles}
								</div>
							</CardContent>
						</Card>
						<Card>
							<CardContent className="pt-4">
								<div className="text-xs text-muted-foreground">Current Unmanaged</div>
								<div className="text-xl font-semibold">
									{inspection.summary.totalUnmanagedCurrentRoles}
								</div>
							</CardContent>
						</Card>
					</div>

					<div className="space-y-3">
						{inspection.guilds.map((guild) => {
							const hasDrift =
								guild.missingExpectedManagedRoles.length > 0 ||
								guild.unexpectedManagedRoles.length > 0

							return (
								<Card key={guild.guildId}>
									<CardHeader>
										<div className="flex items-center justify-between gap-3">
											<div>
												<CardTitle className="text-lg">{guild.guildName}</CardTitle>
												<CardDescription>{guild.guildId}</CardDescription>
											</div>
											<div className="flex items-center gap-2">
												<Badge
													variant="ghost"
													className={
														guild.isMember
															? 'border-green-600 text-green-700'
															: 'border-amber-600 text-amber-700'
													}
												>
													{guild.isMember ? 'Member' : 'Not a Member'}
												</Badge>
												<Badge
													variant="ghost"
													className={
														hasDrift
															? 'border-amber-600 text-amber-700'
															: 'border-green-600 text-green-700'
													}
												>
													{hasDrift ? 'Drift Detected' : 'In Sync'}
												</Badge>
												<Button
													variant="destructive"
													size="sm"
													onClick={() => void stripRolesForGuild(guild.guildId)}
													disabled={
														!discordServers.some((server) => server.guildId === guild.guildId) ||
														stripRoles.isPending
													}
												>
													Strip Roles
												</Button>
											</div>
										</div>
										{guild.membershipError && (
											<p className="text-xs text-destructive">{guild.membershipError}</p>
										)}
									</CardHeader>
									<CardContent className="space-y-3">
										<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
											<div className="space-y-1">
												<p className="text-xs font-medium text-muted-foreground">
													Expected ({guild.expectedManagedRoles.length})
												</p>
												{renderRolePills(guild.expectedManagedRoles, 'secondary')}
											</div>
											<div className="space-y-1">
												<p className="text-xs font-medium text-muted-foreground">
													Current ({guild.currentManagedRoles.length})
												</p>
												{renderRolePills(guild.currentManagedRoles, 'secondary')}
											</div>
											<div className="space-y-1">
												<p className="text-xs font-medium text-muted-foreground">
													Missing ({guild.missingExpectedManagedRoles.length})
												</p>
												{renderRolePills(
													guild.missingExpectedManagedRoles,
													'ghost',
													'border-amber-500/40 text-amber-700'
												)}
											</div>
											<div className="space-y-1">
												<p className="text-xs font-medium text-muted-foreground">
													Unexpected ({guild.unexpectedManagedRoles.length})
												</p>
												{renderRolePills(
													guild.unexpectedManagedRoles,
													'ghost',
													'border-red-500/40 text-red-700'
												)}
											</div>
										</div>

										<div className="space-y-1">
											<p className="text-xs font-medium text-muted-foreground">
												Unmanaged ({guild.currentUnmanagedRoles.length})
											</p>
											{renderRolePills(guild.currentUnmanagedRoles, 'ghost')}
										</div>
									</CardContent>
								</Card>
							)
						})}
					</div>
				</>
			)}
			{confirmationDialog}
		</div>
	)
}
