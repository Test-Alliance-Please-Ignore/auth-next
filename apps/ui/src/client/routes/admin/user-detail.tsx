import {
	AlertTriangle,
	ArrowLeft,
	ExternalLink,
	MessageSquare,
	RefreshCw,
	Shield,
	ShieldOff,
	Trash2,
	XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CancelButton } from '@/components/ui/cancel-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { DestructiveButton } from '@/components/ui/destructive-button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import {
	useActivityLogs,
	useAdminUser,
	useDeleteUserCharacter,
	useRevokeDiscordLink,
	useSetUserAdmin,
} from '@/hooks/useAdminUsers'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDateTime, formatRelativeTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

export default function UserDetailPage() {
	usePageTitle('Admin - User Details')
	const { userId } = useParams<{ userId: string }>()
	const navigate = useNavigate()

	const { data: user, isLoading, refetch } = useAdminUser(userId!)
	const setUserAdmin = useSetUserAdmin()
	const deleteCharacter = useDeleteUserCharacter()
	const revokeDiscord = useRevokeDiscordLink()

	// Dialog state
	const [adminDialogOpen, setAdminDialogOpen] = useState(false)
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [revokeDiscordDialogOpen, setRevokeDiscordDialogOpen] = useState(false)
	const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null)

	// Message state
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	// Fetch recent activity for this user
	const { data: activityData } = useActivityLogs({
		userId: userId!,
		pageSize: 10,
	})

	const recentActivity = activityData?.data || []

	if (isLoading) {
		return (
			<div className="space-y-6">
				<div className="flex items-center gap-4">
					<Button variant="ghost" onClick={() => navigate('/admin/users')}>
						<ArrowLeft className="h-4 w-4 mr-2" />
						Back
					</Button>
				</div>
				<div className="text-center py-8 text-muted-foreground">Loading user details...</div>
			</div>
		)
	}

	if (!user) {
		return (
			<div className="space-y-6">
				<div className="flex items-center gap-4">
					<Button variant="ghost" onClick={() => navigate('/admin/users')}>
						<ArrowLeft className="h-4 w-4 mr-2" />
						Back
					</Button>
				</div>
				<div className="text-center py-8 text-muted-foreground">User not found</div>
			</div>
		)
	}

	const handleToggleAdmin = async () => {
		try {
			await setUserAdmin.mutateAsync({ userId: user.id, isAdmin: !user.is_admin })
			setAdminDialogOpen(false)
			setMessage({
				type: 'success',
				text: user.is_admin
					? 'Admin privileges revoked successfully'
					: 'Admin privileges granted successfully',
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to update admin status',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleDeleteCharacterClick = (characterId: string) => {
		const character = user.characters.find((c) => c.characterId === characterId)

		// Prevent deleting primary character if it's the only one
		if (character?.is_primary && user.characters.length === 1) {
			setMessage({
				type: 'error',
				text: 'Cannot delete the only character on an account',
			})
			setTimeout(() => setMessage(null), 5000)
			return
		}

		setSelectedCharacter(characterId)
		setDeleteDialogOpen(true)
	}

	const handleDeleteCharacterConfirm = async () => {
		if (!selectedCharacter) return

		const character = user.characters.find((c) => c.characterId === selectedCharacter)

		try {
			await deleteCharacter.mutateAsync({ userId: user.id, characterId: selectedCharacter })
			setDeleteDialogOpen(false)
			setSelectedCharacter(null)
			setMessage({
				type: 'success',
				text: `Character ${character?.characterName} deleted successfully`,
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to delete character',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleRevokeDiscordConfirm = async () => {
		try {
			await revokeDiscord.mutateAsync(user.id)
			setRevokeDiscordDialogOpen(false)
			setMessage({
				type: 'success',
				text: 'Discord authorization revoked successfully',
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to revoke Discord authorization',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const selectedCharacterData = user.characters.find((c) => c.characterId === selectedCharacter)

	return (
		<div className="space-y-6">
			{/* Back Button */}
			<div className="flex items-center gap-4">
				<Button variant="ghost" onClick={() => navigate('/admin/users')}>
					<ArrowLeft className="h-4 w-4 mr-2" />
					Back to Users
				</Button>
				<Button variant="ghost" size="sm" onClick={() => refetch()}>
					<RefreshCw className="h-4 w-4" />
				</Button>
			</div>

			{/* Success/Error Message */}
			{message && (
				<Card
					className={
						message.type === 'error'
							? 'border-destructive bg-destructive/10'
							: 'border-primary bg-primary/10'
					}
				>
					<CardContent className="py-3">
						<p className={message.type === 'error' ? 'text-destructive' : 'text-primary'}>
							{message.text}
						</p>
					</CardContent>
				</Card>
			)}

			{/* User Header */}
			<Card variant="interactive">
				<CardContent className="pt-6">
					<div className="flex items-start gap-6">
						<img
							src={`https://images.evetech.net/characters/${user.mainCharacterId}/portrait?size=128`}
							alt={user.characters.find((c) => c.is_primary)?.characterName || 'Unknown'}
							className="h-24 w-24 rounded-full"
						/>
						<div className="flex-1">
							<div className="flex items-start justify-between">
								<div>
									<h2 className="text-2xl font-bold">
										{user.characters.find((c) => c.is_primary)?.characterName || 'Unknown'}
									</h2>
									<p className="text-sm text-muted-foreground mt-1">User ID: {user.id}</p>
								</div>
								<div className="flex items-center gap-2">
									{user.is_admin && (
										<Badge variant="default" className="bg-primary/20 text-primary">
											<Shield className="h-3 w-3 mr-1" />
											Admin
										</Badge>
									)}
									<Button
										variant={user.is_admin ? 'destructive' : 'default'}
										size="sm"
										onClick={() => setAdminDialogOpen(true)}
										disabled={setUserAdmin.isPending}
									>
										{user.is_admin ? (
											<>
												<ShieldOff className="h-4 w-4 mr-2" />
												Revoke Admin
											</>
										) : (
											<>
												<Shield className="h-4 w-4 mr-2" />
												Grant Admin
											</>
										)}
									</Button>
								</div>
							</div>

							<div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6">
								<div>
									<div className="text-sm text-muted-foreground">Characters</div>
									<div className="text-lg font-semibold">{user.characters.length}</div>
								</div>
								<div>
									<div className="text-sm text-muted-foreground">Last Updated</div>
									<div className="text-sm font-medium" title={formatDateTime(user.updatedAt)}>
										{formatRelativeTime(user.updatedAt)}
									</div>
								</div>
								<div>
									<div className="text-sm text-muted-foreground">Created</div>
									<div className="text-sm font-medium" title={formatDateTime(user.createdAt)}>
										{formatRelativeTime(user.createdAt)}
									</div>
								</div>
							</div>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Discord Information */}
			{user.discord && (
				<Card variant="interactive">
					<CardHeader>
						<div className="flex items-center justify-between">
							<div>
								<CardTitle>Discord Account</CardTitle>
								<CardDescription>Linked Discord account information</CardDescription>
							</div>
							{!user.discord.authRevoked && (
								<DestructiveButton
									onClick={() => setRevokeDiscordDialogOpen(true)}
									disabled={revokeDiscord.isPending}
									size="sm"
									showIcon={false}
								>
									<XCircle className="h-4 w-4 mr-2" />
									Revoke Authorization
								</DestructiveButton>
							)}
						</div>
					</CardHeader>
					<CardContent>
						<div className="space-y-4">
							<div className="flex items-center gap-3">
								<div className="flex items-center justify-center w-12 h-12 rounded-full bg-[hsl(var(--discord-blurple))]">
									<MessageSquare className="h-6 w-6 text-white" />
								</div>
								<div>
									<p className="font-semibold text-lg">
										{user.discord.username}
										{user.discord.discriminator !== '0' && `#${user.discord.discriminator}`}
									</p>
									<p className="text-sm text-muted-foreground">Discord ID: {user.discord.userId}</p>
								</div>
							</div>

							{user.discord.authRevoked && (
								<div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
									<div className="flex items-start gap-2">
										<AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
										<div>
											<p className="text-sm text-destructive font-medium">Authorization Revoked</p>
											<p className="text-sm text-destructive/90 mt-1">
												User's Discord authorization was revoked on{' '}
												{user.discord.authRevokedAt
													? formatDateTime(user.discord.authRevokedAt)
													: 'unknown date'}
											</p>
										</div>
									</div>
								</div>
							)}

							<div className="grid grid-cols-2 gap-4 pt-2">
								<div>
									<div className="text-sm text-muted-foreground">Authorization Status</div>
									<div className="text-sm font-medium">
										{user.discord.authRevoked ? (
											<Badge variant="default" className="bg-red-500/20 text-red-500">
												Revoked
											</Badge>
										) : (
											<Badge variant="default" className="bg-green-500/20 text-green-500">
												Active
											</Badge>
										)}
									</div>
								</div>
								<div>
									<div className="text-sm text-muted-foreground">Last Successful Auth</div>
									<div className="text-sm font-medium">
										{user.discord.lastSuccessfulAuth
											? formatRelativeTime(user.discord.lastSuccessfulAuth)
											: 'Never'}
									</div>
								</div>
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Characters */}
			<Card variant="interactive">
				<CardHeader>
					<CardTitle>Characters</CardTitle>
					<CardDescription>All characters associated with this user account</CardDescription>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Character</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Token Status</TableHead>
								<TableHead>Added</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{user.characters.map((character) => (
								<TableRow key={character.characterId}>
									<TableCell>
										<div className="flex items-center gap-3">
											<img
												src={`https://images.evetech.net/characters/${character.characterId}/portrait?size=64`}
												alt={character.characterName}
												className="h-10 w-10 rounded-full"
											/>
											<div>
												<div className="font-medium">{character.characterName}</div>
												<div className="text-xs text-muted-foreground">{character.characterId}</div>
											</div>
										</div>
									</TableCell>
									<TableCell>
										{character.is_primary && (
											<Badge variant="default" className="bg-blue-500/20 text-blue-500">
												Primary
											</Badge>
										)}
									</TableCell>
									<TableCell>
										<div className="text-sm">
											{character.hasValidToken ? (
												<Badge variant="default" className="bg-green-500/20 text-green-500">
													Valid
												</Badge>
											) : (
												<Badge variant="default" className="bg-red-500/20 text-red-500">
													Invalid
												</Badge>
											)}
										</div>
									</TableCell>
									<TableCell>
										<div className="text-sm" title={formatDateTime(character.linkedAt)}>
											{formatRelativeTime(character.linkedAt)}
										</div>
									</TableCell>
									<TableCell className="text-right">
										<div className="flex items-center justify-end gap-2">
											<Link to={`/character/${character.characterId}`}>
												<Button variant="ghost" size="sm">
													<ExternalLink className="h-4 w-4" />
												</Button>
											</Link>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => handleDeleteCharacterClick(character.characterId)}
												disabled={
													deleteCharacter.isPending ||
													(character.is_primary && user.characters.length === 1)
												}
											>
												<Trash2 className="h-4 w-4 text-destructive" />
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			{/* Recent Activity */}
			<Card variant="interactive">
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Recent Activity</CardTitle>
							<CardDescription>Last 10 activity log entries for this user</CardDescription>
						</div>
						<Link to={`/admin/activity-log?userId=${user.id}`}>
							<Button variant="outline" size="sm">
								View All
								<ExternalLink className="h-4 w-4 ml-2" />
							</Button>
						</Link>
					</div>
				</CardHeader>
				<CardContent>
					{recentActivity.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">No recent activity</div>
					) : (
						<div className="space-y-3">
							{recentActivity.map((log) => (
								<div
									key={log.id}
									className="flex items-start gap-3 p-3 rounded-md border border-border bg-muted/30"
								>
									<div className="flex-1">
										<div className="flex items-center gap-2">
											<Badge
												variant="outline"
												className={cn(
													log.action.includes('login') && 'border-green-500 text-green-500',
													log.action.includes('create') && 'border-blue-500 text-blue-500',
													log.action.includes('delete') && 'border-red-500 text-red-500',
													log.action.includes('update') && 'border-yellow-500 text-yellow-500'
												)}
											>
												{log.action}
											</Badge>
											<span className="text-sm text-muted-foreground">
												{formatRelativeTime(log.createdAt)}
											</span>
										</div>
										{log.characterName && (
											<div className="text-sm mt-1">Character: {log.characterName}</div>
										)}
									</div>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Admin Toggle Confirmation Dialog */}
			<Dialog open={adminDialogOpen} onOpenChange={setAdminDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{user.is_admin ? 'Revoke Admin Privileges' : 'Grant Admin Privileges'}
						</DialogTitle>
						<DialogDescription>
							{user.is_admin
								? `Are you sure you want to revoke admin privileges for ${user.characters.find((c) => c.is_primary)?.characterName || 'this user'}? They will lose access to all admin features.`
								: `Are you sure you want to grant admin privileges to ${user.characters.find((c) => c.is_primary)?.characterName || 'this user'}? They will have full access to all admin features.`}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<CancelButton
							onClick={() => setAdminDialogOpen(false)}
							disabled={setUserAdmin.isPending}
						>
							Cancel
						</CancelButton>
						{user.is_admin ? (
							<DestructiveButton
								onClick={handleToggleAdmin}
								loading={setUserAdmin.isPending}
								showIcon={false}
								loadingText="Revoking..."
							>
								<ShieldOff className="mr-2 h-4 w-4" />
								Revoke Admin
							</DestructiveButton>
						) : (
							<ConfirmButton
								onClick={handleToggleAdmin}
								loading={setUserAdmin.isPending}
								loadingText="Granting..."
								showIcon={false}
							>
								<Shield className="mr-2 h-4 w-4" />
								Grant Admin
							</ConfirmButton>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Revoke Discord Authorization Confirmation Dialog */}
			<Dialog open={revokeDiscordDialogOpen} onOpenChange={setRevokeDiscordDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Revoke Discord Authorization</DialogTitle>
						<DialogDescription>
							Are you sure you want to revoke Discord authorization for{' '}
							{user.characters.find((c) => c.is_primary)?.characterName || 'this user'}? This will
							mark their Discord account as unauthorized and they will need to re-link it.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<CancelButton
							onClick={() => setRevokeDiscordDialogOpen(false)}
							disabled={revokeDiscord.isPending}
						>
							Cancel
						</CancelButton>
						<DestructiveButton
							onClick={handleRevokeDiscordConfirm}
							loading={revokeDiscord.isPending}
							loadingText="Revoking..."
							showIcon={false}
						>
							<XCircle className="mr-2 h-4 w-4" />
							Revoke Authorization
						</DestructiveButton>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Character Confirmation Dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Character</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete "{selectedCharacterData?.characterName}"? This action
							cannot be undone. The character will be removed from the user's account.
							{selectedCharacterData?.is_primary && (
								<div className="mt-2 text-destructive font-semibold">
									Warning: This is the user's primary character. A new primary will be automatically
									selected.
								</div>
							)}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<CancelButton
							onClick={() => {
								setDeleteDialogOpen(false)
								setSelectedCharacter(null)
							}}
							disabled={deleteCharacter.isPending}
						>
							Cancel
						</CancelButton>
						<DestructiveButton
							onClick={handleDeleteCharacterConfirm}
							loading={deleteCharacter.isPending}
							loadingText="Deleting..."
							showIcon={false}
						>
							<Trash2 className="mr-2 h-4 w-4" />
							Delete Character
						</DestructiveButton>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
