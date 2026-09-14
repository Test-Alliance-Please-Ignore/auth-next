import { ArrowLeft } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAdminDiscordInspection, useAdminUser } from '@/hooks/useAdminUsers'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { useDiscordServers, useStripDiscordGuildRoles } from '@/hooks/useDiscord'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatNumber, useAppTranslation } from '@/i18n'

import type { AppTranslator } from '@/i18n'

function renderRolePills(
	roles: Array<{ roleId: string; roleName: string | null }>,
	variant: 'secondary' | 'ghost',
	t: AppTranslator,
	extraClassName?: string
) {
	if (roles.length === 0) {
		return <span className="text-xs text-muted-foreground">{t('admin.users.discord.none')}</span>
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
	const { t } = useAppTranslation()
	usePageTitle(t('admin.users.discord.pageTitle'))
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
			title: (translate) => translate('admin.users.discord.stripTitle'),
			description: (translate) => translate('admin.users.discord.stripWarning'),
			confirmLabel: (translate) => translate('admin.users.discord.stripRoles'),
			cancelLabel: (translate) => translate('common.cancel'),
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
					{t('admin.users.account.backToUser')}
				</Button>
			</div>

			<div className="space-y-1">
				<h1 className="text-3xl font-bold gradient-text">
					{t('admin.users.discord.inspectionTitle')}
				</h1>
				<p className="text-muted-foreground">
					{userLoading
						? t('admin.users.account.loadingUser')
						: t('admin.users.discord.inspectionDescription', {
								name:
									user?.characters.find((c) => c.is_primary)?.characterName ||
									t('admin.users.account.user'),
							})}
				</p>
			</div>

			{inspectionLoading ? (
				<Card>
					<CardContent className="py-8 text-center text-muted-foreground">
						{t('admin.users.discord.loadingInspection')}
					</CardContent>
				</Card>
			) : error ? (
				<Card className="border-destructive/30 bg-destructive/10">
					<CardContent className="py-4 text-destructive">
						{t('admin.users.discord.inspectionError')}
					</CardContent>
				</Card>
			) : !inspection ? (
				<Card>
					<CardContent className="py-8 text-center text-muted-foreground">
						{t('admin.users.discord.noInspection')}
					</CardContent>
				</Card>
			) : (
				<>
					<div className="grid grid-cols-2 md:grid-cols-3 gap-3">
						<Card>
							<CardContent className="pt-4">
								<div className="text-xs text-muted-foreground">
									{t('admin.users.discord.guildsInspected')}
								</div>
								<div className="text-xl font-semibold">
									{formatNumber(inspection.summary.guildsInspected)}
								</div>
							</CardContent>
						</Card>
						<Card>
							<CardContent className="pt-4">
								<div className="text-xs text-muted-foreground">
									{t('admin.users.discord.memberGuilds')}
								</div>
								<div className="text-xl font-semibold">
									{formatNumber(inspection.summary.memberGuilds)}
								</div>
							</CardContent>
						</Card>
						<Card>
							<CardContent className="pt-4">
								<div className="text-xs text-muted-foreground">
									{t('admin.users.discord.guildsWithDrift')}
								</div>
								<div className="text-xl font-semibold text-amber-700">
									{formatNumber(inspection.summary.guildsWithDrift)}
								</div>
							</CardContent>
						</Card>
						<Card>
							<CardContent className="pt-4">
								<div className="text-xs text-muted-foreground">
									{t('admin.users.discord.missingExpected')}
								</div>
								<div className="text-xl font-semibold text-amber-700">
									{formatNumber(inspection.summary.totalMissingExpectedManagedRoles)}
								</div>
							</CardContent>
						</Card>
						<Card>
							<CardContent className="pt-4">
								<div className="text-xs text-muted-foreground">
									{t('admin.users.discord.unexpectedManaged')}
								</div>
								<div className="text-xl font-semibold text-red-700">
									{formatNumber(inspection.summary.totalUnexpectedManagedRoles)}
								</div>
							</CardContent>
						</Card>
						<Card>
							<CardContent className="pt-4">
								<div className="text-xs text-muted-foreground">
									{t('admin.users.discord.currentUnmanaged')}
								</div>
								<div className="text-xl font-semibold">
									{formatNumber(inspection.summary.totalUnmanagedCurrentRoles)}
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
													{guild.isMember
														? t('admin.users.discord.member')
														: t('admin.users.discord.notMember')}
												</Badge>
												<Badge
													variant="ghost"
													className={
														hasDrift
															? 'border-amber-600 text-amber-700'
															: 'border-green-600 text-green-700'
													}
												>
													{hasDrift
														? t('admin.users.discord.drift')
														: t('admin.users.discord.inSync')}
												</Badge>
												<Button
													variant="destructive"
													size="sm"
													onClick={() => void stripRolesForGuild(guild.guildId)}
													disabled={
														!guild.isMember ||
														!discordServers.some((server) => server.guildId === guild.guildId) ||
														stripRoles.isPending
													}
												>
													{t('admin.users.discord.stripRoles')}
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
													{t('admin.users.discord.expectedCount', {
														count: guild.expectedManagedRoles.length,
													})}
												</p>
												{renderRolePills(guild.expectedManagedRoles, 'secondary', t)}
											</div>
											<div className="space-y-1">
												<p className="text-xs font-medium text-muted-foreground">
													{t('admin.users.discord.currentCount', {
														count: guild.currentManagedRoles.length,
													})}
												</p>
												{renderRolePills(guild.currentManagedRoles, 'secondary', t)}
											</div>
											<div className="space-y-1">
												<p className="text-xs font-medium text-muted-foreground">
													{t('admin.users.discord.missingCount', {
														count: guild.missingExpectedManagedRoles.length,
													})}
												</p>
												{renderRolePills(
													guild.missingExpectedManagedRoles,
													'ghost',
													t,
													'border-amber-500/40 text-amber-700'
												)}
											</div>
											<div className="space-y-1">
												<p className="text-xs font-medium text-muted-foreground">
													{t('admin.users.discord.unexpectedCount', {
														count: guild.unexpectedManagedRoles.length,
													})}
												</p>
												{renderRolePills(
													guild.unexpectedManagedRoles,
													'ghost',
													t,
													'border-red-500/40 text-red-700'
												)}
											</div>
										</div>

										<div className="space-y-1">
											<p className="text-xs font-medium text-muted-foreground">
												{t('admin.users.discord.unmanagedCount', {
													count: guild.currentUnmanagedRoles.length,
												})}
											</p>
											{renderRolePills(guild.currentUnmanagedRoles, 'ghost', t)}
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
