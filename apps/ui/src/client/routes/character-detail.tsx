import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, RefreshCw, Shield, User, Users } from 'lucide-react'
import { Link, Navigate, useLocation, useParams } from 'react-router'

import { i18n, useAppTranslation } from '@/i18n'
import { formatRelativeTime as formatDistanceToNow } from '@/lib/date-utils'

import { CharacterAttributes } from '../components/character-attributes'
import { CharacterCorporationHistory } from '../components/character-corporation-history'
import { CharacterPrivateInfo } from '../components/character-private-info'
import { CharacterSkillQueue } from '../components/character-skill-queue'
import { CharacterSkills } from '../components/character-skills'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Container } from '../components/ui/container'
import { useCorporationAccess } from '../features/corporations/hooks'
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
			return i18n.t('characterpages.backToDashboard')
		case 'admin-activity-log':
			return i18n.t('characterpages.backToActivityLog')
		case 'admin-user-detail':
		case 'hr-auditor-user-profile':
			return i18n.t('characterpages.backToUserDetails')
		case 'corporation-members':
			return i18n.t('characterpages.backToMembers')
		case 'hr-member-profile':
			return i18n.t('characterpages.backToUserProfile')
		default:
			return null
	}
}

export default function CharacterDetailPage() {
	const { t } = useAppTranslation()

	const { characterId } = useParams<{ characterId: string }>()
	const location = useLocation()
	const { user } = useAuth()
	const { hasAnyPermission } = useUserPermissions()
	const isHrAuditor = hasAnyPermission('urn:hr:auditor')
	const navigationState = location.state as {
		source?: CharacterDetailSource
		backTo?: string
		backLabel?: string
	} | null
	const backTo = navigationState?.backTo
	const backLabel =
		navigationState?.backLabel ??
		resolveBackLabel(navigationState?.source) ??
		t('characterpages.back')

	if (!characterId) {
		return <Navigate to="/dashboard" replace />
	}

	// Fetch character details
	const {
		data: character,
		isLoading,
		error,
	} = useQuery({
		queryKey: ['character', characterId, 'overview'],
		queryFn: () => api.getCharacterDetail(characterId),
		meta: {
			suppressErrorToast: true,
		},
		enabled: !!characterId,
	})
	const { data: characterPrivate, isLoading: isPrivateLoading } = useQuery({
		queryKey: ['character', characterId, 'private'],
		queryFn: () => api.getCharacterPrivateDetail(characterId),
		meta: {
			suppressErrorToast: true,
		},
		enabled: !!characterId,
	})

	const corporationIdForLink = character?.public.info?.corporationId
		? String(character.public.info.corporationId)
		: null
	const { data: corporationAccess } = useCorporationAccess()

	const { data: isManagedCorporation = false } = useQuery({
		queryKey: ['admin-corporation-exists', corporationIdForLink],
		enabled: Boolean(user?.is_admin && corporationIdForLink),
		queryFn: async () => {
			if (!corporationIdForLink) return false
			try {
				await api.getCorporation(corporationIdForLink)
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
	// Set page title based on character name
	usePageTitle(
		character?.public?.info?.name ? `${character.public.info.name}` : t('characterpages.character')
	)

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
						<CardTitle>
							{isForbidden ? t('characterpages.accessDenied') : t('characterpages.error')}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-destructive">
							{isForbidden
								? t('characterpages.youDoNotHavePermissionToViewThisCharacterOnly')
								: isNotFound
									? t('characterpages.characterNotFound')
									: t('characterpages.failedToLoadCharacterDetails')}
						</p>
					</CardContent>
				</Card>
			</Container>
		)
	}

	const lastUpdatedText = character.lastUpdated
		? t('characterpages.updatedValue1', {
				value1: formatDistanceToNow(new Date(character.lastUpdated), { addSuffix: true }),
			})
		: t('characterpages.neverUpdated')
	const canLinkToAdminCorporation = Boolean(
		user?.is_admin && corporationIdForLink && isManagedCorporation
	)
	const showAdminRefresh = Boolean(user?.is_admin)
	const canViewPrivateSections =
		character.isOwner ||
		character.viewedAsAdmin ||
		isHrAuditor ||
		character.viewedAsCeoOrDirector ||
		character.viewedAsHrViewer
	const corporationMembersLink =
		!user?.is_admin &&
		corporationIdForLink &&
		corporationAccess?.corporations.some((corp) => corp.corporationId === corporationIdForLink)
			? `/corporations/${corporationIdForLink}/members`
			: null

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
								<p className="font-medium">{t('characterpages.viewingAsSiteAdministrator')}</p>
								{character.owner && (
									<p className="text-sm text-muted-foreground">
										{t('characterpages.thisCharacterBelongsTo')}{' '}
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
								<p className="font-medium">
									{t('characterpages.viewingAsCorporation')}
									{character.viewerRole}
								</p>
								<p className="text-sm text-muted-foreground">
									{t(
										'characterpages.youCanViewPublicCharacterInformationAttributesCorporationHistory'
									)}
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
								<p className="font-medium">{t('characterpages.viewingAsHrViewer')}</p>
								<p className="text-sm text-muted-foreground">
									{t('characterpages.youCanViewPublicCharacterInformation')}
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
												title={t('characterpages.corporationIdValue1', {
													value1: character.public.info.corporationId,
												})}
											>
												{character.public.info.corporationName ||
													t('characterpages.corporationValue1', {
														value1: character.public.info.corporationId,
													})}
											</Link>
										) : corporationMembersLink ? (
											<Link
												to={corporationMembersLink}
												className="text-sm font-medium underline-offset-2 hover:underline"
												title={t('characterpages.corporationIdValue1', {
													value1: character.public.info.corporationId,
												})}
											>
												{character.public.info.corporationName ||
													t('characterpages.corporationValue1', {
														value1: character.public.info.corporationId,
													})}
											</Link>
										) : (
											<span
												className="text-sm font-medium"
												title={t('characterpages.corporationIdValue1', {
													value1: character.public.info.corporationId,
												})}
											>
												{character.public.info.corporationName ||
													t('characterpages.corporationValue1', {
														value1: character.public.info.corporationId,
													})}
											</span>
										)}
									</div>
								)}
								{(character.public.info?.allianceName || character.public.info?.allianceId) && (
									<div className="flex items-center gap-1.5">
										<img
											src={allianceLogoUrl(character.public.info.allianceId, 32)}
											alt=""
											className="h-4 w-4 rounded"
										/>
										<span
											className="text-sm"
											title={t('characterpages.allianceIdValue1', {
												value1: character.public.info.allianceId,
											})}
										>
											{character.public.info.allianceName ||
												t('characterpages.allianceValue1', {
													value1: character.public.info.allianceId,
												})}
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
								{refreshCharacter.isPending
									? t('characterpages.refreshing')
									: t('characterpages.refresh')}
							</Button>
						)}
						{character.isOwner &&
							!character.viewedAsAdmin &&
							!character.viewedAsCeoOrDirector &&
							!character.viewedAsHrViewer && (
								<span className="text-sm text-success font-medium flex items-center">
									<User className="h-4 w-4 mr-1" />
									{t('characterpages.owner')}
								</span>
							)}
					</div>
				</CardHeader>
			</Card>

			{/* Sensitive information */}
			{canViewPrivateSections && characterPrivate?.private && (
				<CharacterPrivateInfo
					sensitiveDataIsLive={characterPrivate.private.sensitiveDataIsLive}
					location={characterPrivate.private.location}
					wallet={characterPrivate.private.wallet}
					status={characterPrivate.private.status}
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
			{canViewPrivateSections && characterPrivate?.private?.skillQueue && (
				<CharacterSkillQueue queue={characterPrivate.private.skillQueue} />
			)}

			{/* Character Skills */}
			{characterPrivate?.skills ? (
				<CharacterSkills
					characterId={characterId || ''}
					skills={characterPrivate.skills}
					allSkills={characterPrivate.allSkills}
					showProgress={canViewPrivateSections}
				/>
			) : canViewPrivateSections ? (
				<Card>
					<CardHeader>
						<CardTitle>{t('characterpages.skills')}</CardTitle>
						<CardDescription>
							{isPrivateLoading
								? t('characterpages.loadingSkillData')
								: t('characterpages.skillDataNotAvailable')}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="text-center py-8">
							<p className="text-muted-foreground mb-4">
								{isPrivateLoading
									? t('characterpages.loadingCharacterDataNeededToRenderSkills')
									: t('characterpages.characterDataIsNotAvailableForThisView')}
							</p>
							{isPrivateLoading && (
								<Button
									onClick={handleRefresh}
									variant="primary"
									disabled={refreshCharacter.isPending}
								>
									<RefreshCw
										className={`h-4 w-4 ${refreshCharacter.isPending ? 'animate-spin' : ''}`}
									/>
									{refreshCharacter.isPending
										? t('characterpages.refreshing')
										: t('characterpages.refreshCharacterData')}
								</Button>
							)}
						</div>
					</CardContent>
				</Card>
			) : (
				<Card>
					<CardHeader>
						<CardTitle>{t('characterpages.skills')}</CardTitle>
						<CardDescription>{t('characterpages.noSkillDataAvailable')}</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-center text-muted-foreground py-8">
							{t('characterpages.thisCharacterSSkillDataHasNotBeenLoadedYet')}
						</p>
					</CardContent>
				</Card>
			)}
		</Container>
	)
}
