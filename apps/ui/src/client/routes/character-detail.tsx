import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, RefreshCw, Shield, User, Users } from 'lucide-react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'

import { CharacterAttributes } from '../components/character-attributes'
import { CharacterCorporationHistory } from '../components/character-corporation-history'
import { CharacterPrivateInfo } from '../components/character-private-info'
import { CharacterSkillQueue } from '../components/character-skill-queue'
import { CharacterSkills } from '../components/character-skills'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Container } from '../components/ui/container'
import { useHrPermissionCheck } from '../features/hr/hooks'
import { useAuth } from '../hooks/useAuth'
import { useRefreshCharacter } from '../hooks/useCharacters'
import { usePageTitle } from '../hooks/usePageTitle'
import { useUserPermissions } from '../hooks/useUserPermissions'
import { api } from '../lib/api'
import { allianceLogoUrl, characterPortraitUrl, corporationLogoUrl } from '../lib/eve-images'

type CharacterDetailSource =
	| 'admin-user-detail'
	| 'admin-activity-log'
	| 'dashboard'
	| 'corporation-members'
	| 'hr-auditor-user-profile'
	| 'hr-member-profile'

function resolveBackLabel(source?: CharacterDetailSource): string | null {
	switch (source) {
		case 'dashboard':
			return 'Back to Dashboard'
		case 'admin-activity-log':
			return 'Back to Activity Log'
		case 'admin-user-detail':
		case 'hr-auditor-user-profile':
			return 'Back to User Details'
		case 'corporation-members':
			return 'Back to Members'
		case 'hr-member-profile':
			return 'Back to User Profile'
		default:
			return null
	}
}

export default function CharacterDetailPage() {
	const { characterId } = useParams<{ characterId: string }>()
	const location = useLocation()
	const { user } = useAuth()
	const { hasAnyPermission } = useUserPermissions()
	const isHrAuditor = hasAnyPermission('urn:hr:auditor')
	const navigationState = location.state as {
		source?: CharacterDetailSource
		backTo?: string
		backLabel?: string
		corporationId?: string
	} | null
	const backTo = navigationState?.backTo
	const backLabel = navigationState?.backLabel ?? resolveBackLabel(navigationState?.source) ?? 'Back'
	const hrCorporationId = navigationState?.corporationId

	if (!characterId) {
		return <Navigate to="/dashboard" replace />
	}

	// Fetch character details
	const {
		data: character,
		isLoading,
		error,
	} = useQuery({
		queryKey: ['character', characterId, hrCorporationId],
		queryFn: () => api.getCharacterDetail(characterId, hrCorporationId),
		meta: {
			suppressErrorToast: true,
		},
		enabled: !!characterId,
	})

	const corporationIdForAdminLink = character?.public.info?.corporationId
		? String(character.public.info.corporationId)
		: null

	const { data: isManagedCorporation = false } = useQuery({
		queryKey: ['admin-corporation-exists', corporationIdForAdminLink],
		enabled: Boolean(user?.is_admin && corporationIdForAdminLink),
		queryFn: async () => {
			if (!corporationIdForAdminLink) return false
			try {
				await api.getCorporation(corporationIdForAdminLink)
				return true
			} catch (queryError) {
				if (
					queryError &&
					typeof queryError === 'object' &&
					'status' in queryError &&
					queryError.status === 404
				) {
					return false
				}
				throw queryError
			}
		},
		retry: false,
		staleTime: 1000 * 60,
	})
	const { data: hrPermission } = useHrPermissionCheck(
		hrCorporationId ? { corporationId: hrCorporationId } : null
	)

	// Set page title based on character name
	usePageTitle(character?.public?.info?.name ? `${character.public.info.name}` : 'Character')

	// Handle character refresh with toast notifications
	const refreshCharacter = useRefreshCharacter()

	const handleRefresh = () => {
		if (!characterId) return
		refreshCharacter.mutate(characterId)
	}

	if (!characterId) {
		return <Navigate to="/dashboard" replace />
	}

	if (isLoading) {
		return (
			<Container className="p-8">
				<div className="space-y-4">
					<Card>
						<CardHeader>
							<div className="h-8 bg-muted rounded animate-pulse w-1/3" />
						</CardHeader>
						<CardContent>
							<div className="space-y-2">
								<div className="h-4 bg-muted rounded animate-pulse" />
								<div className="h-4 bg-muted rounded animate-pulse w-5/6" />
								<div className="h-4 bg-muted rounded animate-pulse w-2/3" />
							</div>
						</CardContent>
					</Card>
				</div>
			</Container>
		)
	}

	if (error || !character) {
		// Check if it's a 403 Forbidden error
		const isForbidden =
			error && typeof error === 'object' && 'status' in error && error.status === 403
		const isNotFound =
			error && typeof error === 'object' && 'status' in error && error.status === 404

		return (
			<Container className="p-8">
				<Card>
					<CardHeader>
						<CardTitle>{isForbidden ? 'Access Denied' : 'Error'}</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-destructive">
							{isForbidden
								? 'You do not have permission to view this character. Only the character owner can view character details.'
								: isNotFound
									? 'Character not found'
									: 'Failed to load character details'}
						</p>
					</CardContent>
				</Card>
			</Container>
		)
	}

	const lastUpdatedText = character.lastUpdated
		? `Updated ${formatDistanceToNow(new Date(character.lastUpdated), { addSuffix: true })}`
		: 'Never updated'
	const canLinkToAdminCorporation = Boolean(
		user?.is_admin && corporationIdForAdminLink && isManagedCorporation
	)
	const showAdminRefresh = Boolean(user?.is_admin)
	const canViewPrivateSections =
		character.isOwner ||
		character.viewedAsAdmin ||
		isHrAuditor ||
		hrPermission?.currentRole === 'hr_admin' ||
		hrPermission?.currentRole === 'hr_reviewer'

	return (
		<Container className="p-8 space-y-6">
			{backTo && (
				<div className="flex justify-end">
					<Button asChild variant="ghost">
						<Link to={backTo}>
							<ArrowLeft className="h-4 w-4" />
							{backLabel}
						</Link>
					</Button>
				</div>
			)}
			{/* Admin View Alert */}
			{character.viewedAsAdmin && (
				<Card className="border-amber-500/50 bg-amber-500/10">
					<CardContent className="pt-6">
						<div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
							<Shield className="h-5 w-5" />
							<div>
								<p className="font-medium">Viewing as Site Administrator</p>
								{character.owner && (
									<p className="text-sm text-muted-foreground">
										This character belongs to:{' '}
										<Link
											to={`/admin/users/${character.owner.userId}`}
											className="font-medium text-foreground underline-offset-2 hover:underline"
										>
											{character.owner.mainCharacterName}
										</Link>
									</p>
								)}
							</div>
						</div>
				</CardContent>
			</Card>
		)}

			{/* CEO/Director View Alert */}
			{character.viewedAsCeoOrDirector && (
				<Card className="border-blue-500/50 bg-blue-500/10">
					<CardContent className="pt-6">
						<div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
							<Shield className="h-5 w-5" />
							<div>
								<p className="font-medium">Viewing as Corporation {character.viewerRole}</p>
								<p className="text-sm text-muted-foreground">
									You can view public character information (skills, attributes, corporation
									history). Private data (wallet, location, assets) is not available.
								</p>
							</div>
						</div>
				</CardContent>
			</Card>
		)}

			{/* HR Viewer Alert */}
			{character.viewedAsHrViewer && (
				<Card className="border-emerald-500/50 bg-emerald-500/10">
					<CardContent className="pt-6">
						<div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
							<Users className="h-5 w-5" />
							<div>
								<p className="font-medium">Viewing as HR Viewer</p>
								<p className="text-sm text-muted-foreground">
									You can view public character information and HR-accessible private data.
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Character Header */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<div className="flex items-center gap-4">
						<img
							src={characterPortraitUrl(characterId, 128)}
							alt={character.public.info?.name}
							className="w-24 h-24 rounded"
						/>
						<div>
							<CardTitle className="text-2xl">{character.public.info?.name}</CardTitle>
							<div className="mt-1 space-y-0.5">
								{(character.public.info?.corporationName ||
									character.public.info?.corporationId) && (
									<div className="flex items-center gap-1.5">
										<img
											src={corporationLogoUrl(character.public.info.corporationId, 32)}
											alt=""
											className="h-4 w-4 rounded"
										/>
										{canLinkToAdminCorporation ? (
											<Link
												to={`/admin/corporations/${character.public.info.corporationId}`}
												className="text-sm font-medium underline-offset-2 hover:underline"
												title={`Corporation ID: ${character.public.info.corporationId}`}
											>
												{character.public.info.corporationName ||
													`Corporation #${character.public.info.corporationId}`}
											</Link>
										) : (
											<span
												className="text-sm font-medium"
												title={`Corporation ID: ${character.public.info.corporationId}`}
											>
												{character.public.info.corporationName ||
													`Corporation #${character.public.info.corporationId}`}
											</span>
										)}
									</div>
								)}
								{(character.public.info?.allianceName ||
									character.public.info?.allianceId) && (
									<div className="flex items-center gap-1.5">
										<img
											src={allianceLogoUrl(character.public.info.allianceId, 32)}
											alt=""
											className="h-4 w-4 rounded"
										/>
										<span
											className="text-sm"
											title={`Alliance ID: ${character.public.info.allianceId}`}
										>
											{character.public.info.allianceName ||
												`Alliance #${character.public.info.allianceId}`}
										</span>
									</div>
								)}
							</div>
							<p className="text-xs text-muted-foreground mt-1">{lastUpdatedText}</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						{showAdminRefresh && (
							<Button
								onClick={handleRefresh}
								size="sm"
								variant="ghost"
								disabled={refreshCharacter.isPending}
							>
								<RefreshCw
									className={`h-4 w-4 ${refreshCharacter.isPending ? 'animate-spin' : ''}`}
								/>
								{refreshCharacter.isPending ? 'Refreshing...' : 'Refresh'}
							</Button>
						)}
						{character.isOwner && !character.viewedAsAdmin && !character.viewedAsCeoOrDirector && !character.viewedAsHrViewer && (
							<span className="text-sm text-success font-medium flex items-center">
								<User className="h-4 w-4 mr-1" />
								Owner
							</span>
						)}
					</div>
				</CardHeader>
			</Card>

			{/* Sensitive information */}
			{canViewPrivateSections && character.private && (
				<CharacterPrivateInfo
					sensitiveDataIsLive={character.private.sensitiveDataIsLive}
					location={character.private.location}
					wallet={character.private.wallet}
					status={character.private.status}
				/>
			)}

			<div className="grid gap-6 lg:grid-cols-2">
				{/* Character Attributes */}
				{character.public.attributes && (
					<CharacterAttributes attributes={character.public.attributes} />
				)}

				{/* Corporation History */}
				{character.public.corporationHistory && (
					<CharacterCorporationHistory history={character.public.corporationHistory} />
				)}
			</div>

			{/* Skill Queue */}
			{canViewPrivateSections && character.private?.skillQueue && (
				<CharacterSkillQueue queue={character.private.skillQueue} />
			)}

			{/* Character Skills */}
			{character.public.skills ? (
				<CharacterSkills
					characterId={characterId || ''}
					skills={character.public.skills}
					allSkills={character.public.allSkills}
					showProgress={canViewPrivateSections}
				/>
			) : canViewPrivateSections ? (
				<Card>
					<CardHeader>
						<CardTitle>Skills</CardTitle>
						<CardDescription>Skill data not available</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="text-center py-8">
							<p className="text-muted-foreground mb-4">
								Skills data hasn't been fetched yet. Click the Refresh button above to load your
								character's skills.
							</p>
							<Button
								onClick={handleRefresh}
								variant="primary"
								disabled={refreshCharacter.isPending}
							>
								<RefreshCw
									className={`h-4 w-4 ${refreshCharacter.isPending ? 'animate-spin' : ''}`}
								/>
								{refreshCharacter.isPending ? 'Refreshing...' : 'Refresh Character Data'}
							</Button>
						</div>
					</CardContent>
				</Card>
			) : (
				<Card>
					<CardHeader>
						<CardTitle>Skills</CardTitle>
						<CardDescription>No skill data available</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-center text-muted-foreground py-8">
							This character's skill data has not been loaded yet.
						</p>
					</CardContent>
				</Card>
			)}
		</Container>
	)
}
