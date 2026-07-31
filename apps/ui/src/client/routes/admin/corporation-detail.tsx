import { formatDistanceToNow } from 'date-fns'
import {
	ArrowLeft,
	Building2,
	CheckCircle2,
	Database,
	MessageSquare,
	Package,
	Plus,
		RefreshCw,
	Settings,
	Shield,
	ShieldAlert,
	ShieldCheck,
	Skull,
	Trash2,
	TrendingUp,
	Users,
	Wallet,
	X,
	XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'

import { CorporationAlertsCard } from '@/components/admin/corporation-alerts-card'
import { DirectorList } from '@/components/DirectorList'
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useBreadcrumb } from '@/hooks/useBreadcrumb'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import {
	useAttachCorporationPermission,
	useCorporation,
	useCorporationDataSummary,
	useCorporationPermissions,
	useFetchCorporationData,
	useRefreshCorporationDiscord,
	useRemoveCorporationPermission,
	useUpdateCorporation,
	useVerifyCorporationAccess,
} from '@/hooks/useCorporations'
import {
	useAssignRoleToCorporationServer,
	useAttachDiscordServer,
	useCorporationDiscordServers,
	useDetachDiscordServer,
	useDiscordServers,
	useUnassignRoleFromCorporationServer,
	useUpdateCorporationDiscordServer,
	useUpdateCorporationDiscordServerNicknameConfig,
} from '@/hooks/useDiscord'
import { useMessage } from '@/hooks/useMessage'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useGlobalPermissions } from '@/hooks/usePermissions'

import type { CorporationAccessVerification } from '@/lib/api'

const ACCESS_ROLE_GROUPS = [
	{ label: 'Director', roles: ['Director'] },
	{ label: 'Accountant / Junior Accountant', roles: ['Accountant', 'Junior_Accountant'] },
	{ label: 'Station Manager', roles: ['Station_Manager'] },
	{
		label: 'Accountant / Junior Accountant / Trader',
		roles: ['Accountant', 'Junior_Accountant', 'Trader'],
	},
	{ label: 'Factory Manager', roles: ['Factory_Manager'] },
] as const

const DEFAULT_ATTACHMENT_SETTINGS = {
	autoInvite: false,
	autoAssignRoles: false,
} as const

type AttachmentSettingsState = {
	autoInvite: boolean
	autoAssignRoles: boolean
}

type NicknameBucketSource = 'corp' | 'alliance' | 'custom'

type NicknameBucketKey = 'corpMember' | 'allianceGuest' | 'nonAllianceGuest'

type NicknameBucketDraft = {
	enabled: boolean
	source: NicknameBucketSource
	customTicker: string
}

const NICKNAME_SOURCE_OPTIONS: Array<{ value: NicknameBucketSource; label: string }> = [
	{ value: 'corp', label: 'Corp ticker' },
	{ value: 'alliance', label: 'Alliance ticker' },
	{ value: 'custom', label: 'Custom ticker' },
]

function sanitizeNicknameTickerInput(value: string): string {
	return value
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '')
		.slice(0, 5)
}

const NICKNAME_BUCKET_CONFIGS: Array<{
	key: NicknameBucketKey
	label: string
	description: string
	enabledField:
		| 'corpMemberNicknameEnabled'
		| 'allianceGuestNicknameEnabled'
		| 'nonAllianceGuestNicknameEnabled'
	sourceField:
		| 'corpMemberNicknameSource'
		| 'allianceGuestNicknameSource'
		| 'nonAllianceGuestNicknameSource'
	customField:
		| 'corpMemberNicknameCustomTicker'
		| 'allianceGuestNicknameCustomTicker'
		| 'nonAllianceGuestNicknameCustomTicker'
}> = [
	{
		key: 'corpMember',
		label: 'Corp Members',
		description: 'Multi-select roles and ticker settings for members of this corporation.',
		enabledField: 'corpMemberNicknameEnabled',
		sourceField: 'corpMemberNicknameSource',
		customField: 'corpMemberNicknameCustomTicker',
	},
	{
		key: 'allianceGuest',
		label: 'Alliance Guest',
		description: 'Guest access for users affiliated with member corporations.',
		enabledField: 'allianceGuestNicknameEnabled',
		sourceField: 'allianceGuestNicknameSource',
		customField: 'allianceGuestNicknameCustomTicker',
	},
	{
		key: 'nonAllianceGuest',
		label: 'Non-Alliance Guest',
		description: 'Guest access for linked users outside the alliance.',
		enabledField: 'nonAllianceGuestNicknameEnabled',
		sourceField: 'nonAllianceGuestNicknameSource',
		customField: 'nonAllianceGuestNicknameCustomTicker',
	},
] as const

export default function CorporationDetailPage() {
	const { corporationId } = useParams<{ corporationId: string }>()
	const corpId = corporationId || ''

	const { data: corporation, isLoading } = useCorporation(corpId)

	// Set dynamic page title based on corporation name
	usePageTitle(corporation?.name ? `Admin - ${corporation.name}` : 'Admin - Corporation Details')
	const { data: dataSummary, isLoading: summaryLoading } = useCorporationDataSummary(corpId)
	const updateCorporation = useUpdateCorporation()
	const verifyAccess = useVerifyCorporationAccess()
	const fetchData = useFetchCorporationData()

	// Discord hooks
	const refreshCorporationDiscord = useRefreshCorporationDiscord()
	const { data: discordServers = [] } = useDiscordServers()
	const { data: corporationDiscordServers = [] } = useCorporationDiscordServers(corpId)
	const attachServer = useAttachDiscordServer()
	const detachServer = useDetachDiscordServer()
	const updateAttachment = useUpdateCorporationDiscordServer()
	const updateNicknameConfig = useUpdateCorporationDiscordServerNicknameConfig()
	const assignRole = useAssignRoleToCorporationServer()
	const unassignRole = useUnassignRoleFromCorporationServer()

	// Permission hooks
	const { data: corporationPermissions = [], isLoading: permissionsLoading } =
		useCorporationPermissions(corpId)
	const { data: globalPermissions = [] } = useGlobalPermissions()
	const attachPermission = useAttachCorporationPermission()
	const removePermission = useRemoveCorporationPermission()

	// Set breadcrumb
	const { setCustomLabel, clearCustomLabel } = useBreadcrumb()
	useEffect(() => {
		if (corporation) {
			setCustomLabel(`/admin/corporations/${corpId}`, corporation.name)
		}

		// Cleanup function to clear the breadcrumb label when component unmounts or corpId changes
		return () => {
			clearCustomLabel(`/admin/corporations/${corpId}`)
		}
	}, [corporation, corpId, setCustomLabel, clearCustomLabel])

	// Message handling with automatic cleanup
	const { message, showSuccess, showError, clearMessage } = useMessage()
	const [accessVerification, setAccessVerification] =
		useState<CorporationAccessVerification | null>(null)
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

	const accessRoleStatuses = useMemo(() => {
		const verifiedRoles = new Set(accessVerification?.verifiedRoles ?? [])

		return ACCESS_ROLE_GROUPS.map((group) => ({
			...group,
			satisfied: group.roles.some((role) => verifiedRoles.has(role)),
		}))
	}, [accessVerification])

	const satisfiedAccessRoleGroups = accessRoleStatuses.filter((group) => group.satisfied)
	const missingAccessRoleGroups = accessRoleStatuses.filter((group) => !group.satisfied)

	// Discord UI state
	const [showAddServerDialog, setShowAddServerDialog] = useState(false)
	const [selectedServerId, setSelectedServerId] = useState('')
	const [pendingRoleSelections, setPendingRoleSelections] = useState<Record<string, string>>({})
	const [nicknameConfigDrafts, setNicknameConfigDrafts] = useState<
		Record<string, Record<NicknameBucketKey, NicknameBucketDraft>>
	>({})
	const [attachmentSettings, setAttachmentSettings] = useState<AttachmentSettingsState>({
		...DEFAULT_ATTACHMENT_SETTINGS,
	})

	// Permission UI state
	const [showAttachPermissionDialog, setShowAttachPermissionDialog] = useState(false)
	const [selectedPermissionId, setSelectedPermissionId] = useState('')
	const noneScenarioRoleValue = '__none__'

	useEffect(() => {
		setAttachmentSettings({ ...DEFAULT_ATTACHMENT_SETTINGS })
	}, [selectedServerId])

	useEffect(() => {
		setNicknameConfigDrafts(
			Object.fromEntries(
				corporationDiscordServers.map((attachment) => [
					attachment.id,
					{
						corpMember: {
							enabled: attachment.corpMemberNicknameEnabled,
							source: attachment.corpMemberNicknameSource,
							customTicker: attachment.corpMemberNicknameCustomTicker ?? '',
						},
						allianceGuest: {
							enabled: attachment.allianceGuestNicknameEnabled,
							source: attachment.allianceGuestNicknameSource,
							customTicker: attachment.allianceGuestNicknameCustomTicker ?? '',
						},
						nonAllianceGuest: {
							enabled: attachment.nonAllianceGuestNicknameEnabled,
							source: attachment.nonAllianceGuestNicknameSource,
							customTicker: attachment.nonAllianceGuestNicknameCustomTicker ?? '',
						},
					},
				])
			)
		)
	}, [corporationDiscordServers])

	const updateRoleAttachment = async (
		attachmentId: string,
		data: Parameters<typeof updateAttachment.mutateAsync>[0]['data'],
		successMessage: string,
		errorMessage: string
	) => {
		try {
			await updateAttachment.mutateAsync({
				corporationId: corpId,
				attachmentId,
				data,
			})
			showSuccess(successMessage)
		} catch (error) {
			showError(error instanceof Error ? error.message : errorMessage)
		}
	}

	const updateNicknameAttachment = async (
		attachmentId: string,
		data: Parameters<typeof updateNicknameConfig.mutateAsync>[0]['data'],
		successMessage: string,
		errorMessage: string
	) => {
		try {
			await updateNicknameConfig.mutateAsync({
				corporationId: corpId,
				attachmentId,
				data,
			})
			showSuccess(successMessage)
		} catch (error) {
			showError(error instanceof Error ? error.message : errorMessage)
		}
	}

	// Handlers for Discord servers
	const handleAttachServer = async () => {
		if (!selectedServerId) return

		try {
			await attachServer.mutateAsync({
				corporationId: corpId,
				data: {
					discordServerId: selectedServerId,
					autoInvite: attachmentSettings.autoInvite,
					autoAssignRoles: attachmentSettings.autoAssignRoles,
				},
			})
			setShowAddServerDialog(false)
			setSelectedServerId('')
			setAttachmentSettings({ ...DEFAULT_ATTACHMENT_SETTINGS })
			showSuccess('Discord server attached successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to attach Discord server')
		}
	}

	const handleDetachServer = async (attachmentId: string) => {
		requestConfirmation({
			title: 'Detach Discord Server?',
			description:
				'Detaching this server removes corporation Discord attachment-based access. This may revoke Discord roles for affected users on the next sync.',
			confirmLabel: 'Detach Server',
			intent: 'destructive',
			onConfirm: async () => {
				try {
					await detachServer.mutateAsync({ corporationId: corpId, attachmentId })
					showSuccess('Discord server detached successfully!')
				} catch (error) {
					showError(error instanceof Error ? error.message : 'Failed to detach Discord server')
				}
			},
		})
	}

	const handleToggleAutoInvite = async (attachmentId: string, currentValue: boolean) => {
		await updateRoleAttachment(
			attachmentId,
			{ autoInvite: !currentValue },
			'Auto-invite setting updated!',
			'Failed to update auto-invite setting'
		)
	}

	const handleToggleAutoAssignRoles = async (attachmentId: string, currentValue: boolean) => {
		await updateRoleAttachment(
			attachmentId,
			{ autoAssignRoles: !currentValue },
			'Auto-assign roles setting updated!',
			'Failed to update auto-assign roles setting'
		)
	}

	const handleAssignRole = async (attachmentId: string, discordRoleId: string) => {
		try {
			await assignRole.mutateAsync({
				corporationId: corpId,
				attachmentId,
				data: { discordRoleId },
			})
			showSuccess('Role assigned successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to assign role')
		}
	}

	const handleScenarioRoleChange = async (
		attachmentId: string,
		field: 'allianceGuestRoleId' | 'nonAllianceGuestRoleId',
		nextValue: string
	) => {
		await updateRoleAttachment(
			attachmentId,
			{
				[field]: nextValue === noneScenarioRoleValue ? null : nextValue,
			} as Parameters<typeof updateAttachment.mutateAsync>[0]['data'],
			'Scenario role updated!',
			'Failed to update scenario role'
		)
	}

	const handleScenarioAutoApplyToggle = async (
		attachmentId: string,
		field: 'allianceGuestAutoApply' | 'nonAllianceGuestAutoApply',
		currentValue: boolean
	) => {
		await updateRoleAttachment(
			attachmentId,
			{
				[field]: !currentValue,
			} as Parameters<typeof updateAttachment.mutateAsync>[0]['data'],
			'Scenario auto-apply updated!',
			'Failed to update scenario auto-apply'
		)
	}

	const updateNicknameBucketDraft = (
		attachmentId: string,
		bucket: NicknameBucketKey,
		patch: Partial<NicknameBucketDraft>
	) => {
		setNicknameConfigDrafts((current) => ({
			...current,
			[attachmentId]: {
				...(current[attachmentId] ?? {
					corpMember: { enabled: false, source: 'corp', customTicker: '' },
					allianceGuest: { enabled: false, source: 'corp', customTicker: '' },
					nonAllianceGuest: { enabled: false, source: 'corp', customTicker: '' },
				}),
				[bucket]: {
					...(current[attachmentId]?.[bucket] ?? {
						enabled: false,
						source: 'corp',
						customTicker: '',
					}),
					...patch,
				},
			},
		}))
	}

	const saveNicknameBucketDraft = async (attachmentId: string, bucket: NicknameBucketKey) => {
		const attachmentDraft = nicknameConfigDrafts[attachmentId]?.[bucket]
		if (!attachmentDraft) {
			return
		}

		const bucketConfig = NICKNAME_BUCKET_CONFIGS.find((config) => config.key === bucket)
		if (!bucketConfig) {
			return
		}

		await updateNicknameAttachment(
			attachmentId,
			{
				[bucketConfig.enabledField]: attachmentDraft.enabled,
				[bucketConfig.sourceField]: attachmentDraft.source,
				[bucketConfig.customField]:
					attachmentDraft.source === 'custom'
						? sanitizeNicknameTickerInput(attachmentDraft.customTicker) || null
						: null,
			} as Parameters<typeof updateNicknameConfig.mutateAsync>[0]['data'],
			'Nickname config updated!',
			'Failed to update nickname config'
		)
	}

	const handleUnassignRole = async (attachmentId: string, roleAssignmentId: string) => {
		try {
			await unassignRole.mutateAsync({
				corporationId: corpId,
				attachmentId,
				roleAssignmentId,
			})
			showSuccess('Role unassigned successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to unassign role')
		}
	}

	// Handlers for permissions
	const handleAttachPermission = async () => {
		if (!selectedPermissionId) return

		try {
			await attachPermission.mutateAsync({
				corporationId: corpId,
				permissionId: selectedPermissionId,
			})
			setShowAttachPermissionDialog(false)
			setSelectedPermissionId('')
			showSuccess('Permission attached successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to attach permission')
		}
	}

	const handleRemovePermission = async (permissionId: string) => {
		try {
			await removePermission.mutateAsync({
				corporationId: corpId,
				permissionId,
			})
			showSuccess('Permission removed successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to remove permission')
		}
	}

	const handleVerify = async () => {
		clearMessage()
		setAccessVerification(null)
		try {
			const result = await verifyAccess.mutateAsync(corpId)
			setAccessVerification(result)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to verify access')
		}
	}

	const handleFetch = async (category: string) => {
		try {
			await fetchData.mutateAsync({ corporationId: corpId, data: { category: category as any } })
			showSuccess(`Started fetching ${category} data...`)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to fetch data')
		}
	}

	const handleUpdateBackgroundRefresh = async (enabled: boolean) => {
		try {
			await updateCorporation.mutateAsync({
				corporationId: corpId,
				data: { includeInBackgroundRefresh: enabled },
			})
			showSuccess(`Background refresh ${enabled ? 'enabled' : 'disabled'}`)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to update setting')
		}
	}

	const handleUpdateStructureAssetSync = async (enabled: boolean) => {
		try {
			await updateCorporation.mutateAsync({
				corporationId: corpId,
				data: { includeInStructureAssetSync: enabled },
			})
			showSuccess(`Structure asset sync ${enabled ? 'enabled' : 'disabled'}`)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to update setting')
		}
	}

	const handleUpdateMemberCorporation = async (enabled: boolean) => {
		if (!enabled) {
			requestConfirmation({
				title: 'Disable Member Corporation?',
				description:
					'Disabling member corporation status removes member-corp alliance access and may revoke associated Discord access/roles for affected users.',
				confirmLabel: 'Disable Membership',
				intent: 'destructive',
				onConfirm: async () => {
					try {
						await updateCorporation.mutateAsync({
							corporationId: corpId,
							data: { isMemberCorporation: enabled },
						})
						showSuccess('Member corporation status disabled')
					} catch (error) {
						showError(error instanceof Error ? error.message : 'Failed to update setting')
					}
				},
			})
			return
		}

		try {
			await updateCorporation.mutateAsync({
				corporationId: corpId,
				data: { isMemberCorporation: enabled },
			})
			showSuccess('Member corporation status enabled')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to update setting')
		}
	}

	const handleUpdateAltCorp = async (enabled: boolean) => {
		try {
			await updateCorporation.mutateAsync({
				corporationId: corpId,
				data: { isAltCorp: enabled },
			})
			showSuccess(`Alt corporation status ${enabled ? 'enabled' : 'disabled'}`)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to update setting')
		}
	}

	const handleUpdateSpecialPurpose = async (enabled: boolean) => {
		try {
			await updateCorporation.mutateAsync({
				corporationId: corpId,
				data: { isSpecialPurpose: enabled },
			})
			showSuccess(`Special purpose status ${enabled ? 'enabled' : 'disabled'}`)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to update setting')
		}
	}

	const formatDate = (date: string | Date | null) => {
		if (!date) return 'Never'
		const parsedDate = date instanceof Date ? date : new Date(date)
		if (Number.isNaN(parsedDate.getTime())) return 'Never'
		return formatDistanceToNow(parsedDate, { addSuffix: true })
	}

	const scenarioRoleConfigs = [
		{
			key: 'allianceGuest',
			label: 'Alliance Guest',
			description: 'Guest access for users affiliated with member corporations',
			nicknameLabel: 'Alliance Guest Ticker',
			nicknameDescription:
				'Used for alliance members outside this corporation. Takes priority over the non-alliance setting.',
			nicknameClassName: 'border-sky-500/30 bg-sky-500/5',
			roleIdKey: 'allianceGuestRoleId' as const,
			autoApplyKey: 'allianceGuestAutoApply' as const,
		},
		{
			key: 'nonAllianceGuest',
			label: 'Non-Alliance Guest',
			description: 'Guest access for linked users outside the alliance',
			nicknameLabel: 'Non-Alliance Guest Ticker',
			nicknameDescription:
				'Used for linked users outside this corporation and alliance. Fallback when no more specific setting applies.',
			nicknameClassName: 'border-slate-500/30 bg-slate-500/5',
			roleIdKey: 'nonAllianceGuestRoleId' as const,
			autoApplyKey: 'nonAllianceGuestAutoApply' as const,
		},
	] as const

	const getAttachmentUsedRoleIds = (attachment: (typeof corporationDiscordServers)[number]) => {
		const roleIds = new Set<string>()
		for (const roleAssignment of attachment.roles ?? []) {
			roleIds.add(roleAssignment.discordRole.id)
		}
		if (attachment.allianceGuestRoleId) roleIds.add(attachment.allianceGuestRoleId)
		if (attachment.nonAllianceGuestRoleId) roleIds.add(attachment.nonAllianceGuestRoleId)
		return roleIds
	}

	const buildRoleOptions = (
		attachment: (typeof corporationDiscordServers)[number],
		currentRoleId?: string | null
	) => {
		const usedRoleIds = getAttachmentUsedRoleIds(attachment)
		const options = [
			{
				value: noneScenarioRoleValue,
				label: 'None',
			},
		]

		for (const role of attachment.discordServer?.roles ?? []) {
			if (role.id === currentRoleId || !usedRoleIds.has(role.id)) {
				options.push({
					value: role.id,
					label: role.roleName,
				})
			}
		}

		return options
	}

	if (isLoading) {
		return (
			<div className="flex justify-center py-12">
				<LoadingSpinner label="Loading corporation..." />
			</div>
		)
	}

	if (!corporation) {
		return (
			<div className="text-center py-12">
				<Building2 className="mx-auto h-12 w-12 text-muted-foreground" />
				<h3 className="mt-4 text-lg font-medium">Corporation not found</h3>
				<p className="text-muted-foreground mt-2">This corporation may have been removed.</p>
				<Button asChild className="mt-4">
					<Link to="/admin/corporations">
						<ArrowLeft className="h-4 w-4" />
						Back to Corporations
					</Link>
				</Button>
			</div>
		)
	}

	return (
		<>
			<div className="space-y-6">
				{/* Back Button */}
				<Button variant="ghost" asChild>
					<Link to="/admin/corporations">
						<ArrowLeft className="h-4 w-4" />
						Back to Corporations
					</Link>
				</Button>

				{/* Page Header */}
				<div className="flex items-start justify-between">
					<div>
						<h1 className="text-3xl font-bold gradient-text">{corporation.name}</h1>
						<p className="text-muted-foreground mt-1">[{corporation.ticker}]</p>
					</div>
					<div className="flex gap-2">
						{corporation.assignedCharacterId && (
							<Button onClick={handleVerify} disabled={verifyAccess.isPending}>
								<Shield className="h-4 w-4" />
								{verifyAccess.isPending ? 'Verifying...' : 'Verify Access'}
							</Button>
						)}
					</div>
				</div>

				{/* Success/Error Message */}
				{accessVerification && (
					<Card
						className={
							accessVerification.hasAccess
								? 'border-success/30 bg-success/5'
								: 'border-destructive/30 bg-destructive/5'
						}
					>
						<CardHeader className="pb-3">
							<div className="flex items-start justify-between gap-4">
								<div className="space-y-1">
									<div className="flex flex-wrap items-center gap-2">
										<CardTitle className="text-base">Access verification</CardTitle>
										<Badge
											variant={accessVerification.hasAccess ? 'success' : 'destructive'}
											className="gap-1"
										>
											{accessVerification.hasAccess ? (
												<CheckCircle2 className="h-3 w-3" />
											) : (
												<ShieldAlert className="h-3 w-3" />
											)}
											{accessVerification.hasAccess ? 'Access verified' : 'Access missing'}
										</Badge>
									</div>
									<CardDescription>
										{accessVerification.hasAccess
											? `Verified via ${accessVerification.characterName ?? 'an eligible director'}`
											: 'No healthy director satisfied the required role matrix.'}
									</CardDescription>
								</div>
								<p className="text-xs text-muted-foreground">
									{accessVerification.lastVerified
										? `Checked ${formatDate(accessVerification.lastVerified)}`
										: 'Not checked'}
								</p>
							</div>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<div className="flex items-center justify-between gap-3">
									<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
										What we check for
									</p>
									<p className="text-xs text-muted-foreground">
										{satisfiedAccessRoleGroups.length} / {ACCESS_ROLE_GROUPS.length} satisfied
									</p>
								</div>
								<div className="flex flex-wrap gap-2">
									{accessRoleStatuses.map((group) => (
										<Badge
											key={group.label}
											variant={group.satisfied ? 'success' : 'destructive'}
											className="gap-1"
										>
											{group.satisfied ? (
												<CheckCircle2 className="h-3 w-3" />
											) : (
												<XCircle className="h-3 w-3" />
											)}
											{group.label}
										</Badge>
									))}
								</div>
							</div>

							{missingAccessRoleGroups.length > 0 && (
								<div className="space-y-2">
									<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
										What we don&apos;t have
									</p>
									<div className="flex flex-wrap gap-2">
										{missingAccessRoleGroups.map((group) => (
											<Badge key={group.label} variant="destructive" className="gap-1">
												<XCircle className="h-3 w-3" />
												{group.label}
											</Badge>
										))}
									</div>
								</div>
							)}
						</CardContent>
					</Card>
				)}

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

				{/* Status Overview */}
				<div className="grid gap-4 md:grid-cols-3">
					<Card>
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">Status</CardTitle>
							{corporation.isActive ? (
								<CheckCircle2 className="h-4 w-4 text-green-600" />
							) : (
								<XCircle className="h-4 w-4 text-muted-foreground" />
							)}
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">
								{corporation.isActive ? 'Active' : 'Inactive'}
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">Last Sync</CardTitle>
							<RefreshCw className="h-4 w-4 text-muted-foreground" />
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">{formatDate(corporation.lastSync)}</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">Verification</CardTitle>
							{corporation.isVerified ? (
								<ShieldCheck className="h-4 w-4 text-green-600" />
							) : (
								<ShieldAlert className="h-4 w-4 text-destructive" />
							)}
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">
								{corporation.isVerified ? 'Verified' : 'Unverified'}
							</div>
							<p className="text-xs text-muted-foreground mt-1">
								{formatDate(corporation.lastVerified)}
							</p>
						</CardContent>
					</Card>
				</div>

				{/* Tabs */}
				<Tabs defaultValue="config" className="space-y-4">
					<TabsList>
						<TabsTrigger value="config">Configuration</TabsTrigger>
						<TabsTrigger value="data">Data Summary</TabsTrigger>
						<TabsTrigger value="fetch">Fetch Data</TabsTrigger>
						<TabsTrigger value="permissions">Permissions</TabsTrigger>
					</TabsList>

					{/* Configuration Tab */}
					<TabsContent value="config" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Directors</CardTitle>
								<CardDescription>
									Manage director characters with access to corporation data via ESI. Multiple
									directors provide automatic failover and load balancing.
								</CardDescription>
							</CardHeader>
							<CardContent>
								<DirectorList corporationId={corpId} />
							</CardContent>
						</Card>

						{/* Data Collection Settings Card */}
						<Card>
							<CardHeader>
								<div className="flex items-center gap-2">
									<RefreshCw className="h-5 w-5 text-muted-foreground" />
									<CardTitle>Data Collection Settings</CardTitle>
								</div>
								<CardDescription>
									Configure automatic data fetching, synchronization behavior, and structure asset
									snapshots.
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="flex items-center justify-between">
									<div className="space-y-1">
										<div className="flex items-center space-x-2">
											<Switch
												id="background-refresh"
												checked={corporation.includeInBackgroundRefresh}
												onCheckedChange={(checked) => handleUpdateBackgroundRefresh(checked)}
												disabled={updateCorporation.isPending}
											/>
											<Label htmlFor="background-refresh" className="cursor-pointer font-medium">
												Include in Background Refresh
											</Label>
										</div>
										<p className="text-sm text-muted-foreground ml-11">
											When enabled, corporation data will be automatically fetched and updated on a
											regular schedule
										</p>
									</div>
								</div>

								<div className="flex items-center justify-between">
									<div className="space-y-1">
										<div className="flex items-center space-x-2">
											<Switch
												id="structure-asset-sync"
												checked={corporation.includeInStructureAssetSync}
												onCheckedChange={(checked) => handleUpdateStructureAssetSync(checked)}
												disabled={updateCorporation.isPending}
											/>
											<Label htmlFor="structure-asset-sync" className="cursor-pointer font-medium">
												Include in Structure Asset Sync
											</Label>
										</div>
										<p className="text-sm text-muted-foreground ml-11">
											When enabled, structure asset snapshots are fetched during corporation sync
										</p>
									</div>
								</div>
							</CardContent>
						</Card>

						{/* Corporation Classification Settings Card */}
						<Card>
							<CardHeader>
								<div className="flex items-center gap-2">
									<Settings className="h-5 w-5 text-muted-foreground" />
									<CardTitle>Corporation Classification</CardTitle>
								</div>
								<CardDescription>
									Categorize this corporation for filtering and organizational purposes
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="flex items-center justify-between">
									<div className="space-y-1">
										<div className="flex items-center space-x-2">
											<Switch
												id="member-corporation"
												checked={corporation.isMemberCorporation}
												onCheckedChange={(checked) => handleUpdateMemberCorporation(checked)}
												disabled={updateCorporation.isPending}
											/>
											<Label htmlFor="member-corporation" className="cursor-pointer font-medium">
												Member Corporation
											</Label>
										</div>
										<p className="text-sm text-muted-foreground ml-11">
											Mark this corporation as a member of the alliance
										</p>
									</div>
								</div>

								<div className="flex items-center justify-between">
									<div className="space-y-1">
										<div className="flex items-center space-x-2">
											<Switch
												id="alt-corp"
												checked={corporation.isAltCorp}
												onCheckedChange={(checked) => handleUpdateAltCorp(checked)}
												disabled={updateCorporation.isPending}
											/>
											<Label htmlFor="alt-corp" className="cursor-pointer font-medium">
												Alt Corporation
											</Label>
										</div>
										<p className="text-sm text-muted-foreground ml-11">
											Mark this corporation as an alt corp
										</p>
									</div>
								</div>

								<div className="flex items-center justify-between">
									<div className="space-y-1">
										<div className="flex items-center space-x-2">
											<Switch
												id="special-purpose"
												checked={corporation.isSpecialPurpose}
												onCheckedChange={(checked) => handleUpdateSpecialPurpose(checked)}
												disabled={updateCorporation.isPending}
											/>
											<Label htmlFor="special-purpose" className="cursor-pointer font-medium">
												Special Purpose Corporation
											</Label>
										</div>
										<p className="text-sm text-muted-foreground ml-11">
											Mark this corporation as a special purpose corp
										</p>
									</div>
								</div>
							</CardContent>
						</Card>

						{/* Discord Servers Card */}
						<Card>
							<CardHeader>
								<div className="flex items-center justify-between">
									<div>
										<div className="flex items-center gap-2">
											<MessageSquare className="h-5 w-5 text-[hsl(var(--discord-blurple))]" />
											<CardTitle>Discord Servers</CardTitle>
										</div>
										<CardDescription>
											Attach Discord servers from the registry to enable auto-invite for corporation
											members. Each server can be configured independently with role assignments.
										</CardDescription>
									</div>
									<div className="flex items-center gap-2">
										<Button
											variant="ghost"
											size="sm"
											disabled={refreshCorporationDiscord.isPending}
											onClick={() => {
												refreshCorporationDiscord.mutate(
													{ corporationId: corpId, allowRemoval: true },
													{
														onSuccess: (data) =>
															showSuccess(
																data.message ||
																	`Discord refresh queued for ${data.usersQueued} users`
															),
														onError: (error) =>
															showError(
																error instanceof Error ? error.message : 'Failed to refresh Discord'
															),
													}
												)
											}}
										>
											<RefreshCw
												className={`h-4 w-4 ${refreshCorporationDiscord.isPending ? 'animate-spin' : ''}`}
											/>
											Refresh All Members
										</Button>
										<Button
											onClick={() => setShowAddServerDialog(true)}
											disabled={discordServers.length === 0}
											size="sm"
										>
											<Plus className="h-4 w-4" />
											Attach Server
										</Button>
									</div>
								</div>
							</CardHeader>
							<CardContent>
								{corporationDiscordServers.length === 0 ? (
									<div className="text-center py-8">
										<MessageSquare className="mx-auto h-12 w-12 text-muted-foreground" />
										<h3 className="mt-4 text-sm font-medium">No Discord servers attached</h3>
										<p className="text-sm text-muted-foreground mt-2">
											Attach a Discord server from the registry to enable auto-invite
										</p>
										{discordServers.length === 0 && (
											<p className="text-xs text-muted-foreground mt-2">
												<Link to="/admin/discord-servers" className="text-primary hover:underline">
													Add servers to the registry first
												</Link>
											</p>
										)}
									</div>
								) : (
									<Accordion type="multiple" defaultValue={[]} className="space-y-4">
										{corporationDiscordServers.map((attachment) => {
											const nicknameManagementEnabled =
												attachment.discordServer?.manageNicknames ?? false
											const nicknameControlsDisabled = !nicknameManagementEnabled
											const attachmentNicknameDrafts = nicknameConfigDrafts[attachment.id] ?? {
												corpMember: {
													enabled: attachment.corpMemberNicknameEnabled,
													source: attachment.corpMemberNicknameSource,
													customTicker: attachment.corpMemberNicknameCustomTicker ?? '',
												},
												allianceGuest: {
													enabled: attachment.allianceGuestNicknameEnabled,
													source: attachment.allianceGuestNicknameSource,
													customTicker: attachment.allianceGuestNicknameCustomTicker ?? '',
												},
												nonAllianceGuest: {
													enabled: attachment.nonAllianceGuestNicknameEnabled,
													source: attachment.nonAllianceGuestNicknameSource,
													customTicker: attachment.nonAllianceGuestNicknameCustomTicker ?? '',
												},
											}

											return (
												<AccordionItem
													key={attachment.id}
													value={attachment.id}
													className="overflow-hidden rounded-lg border border-border/90 bg-card shadow-md ring-1 ring-border/50"
												>
													<AccordionTrigger className="px-4 py-4 text-left hover:bg-muted/40">
														<div>
															<h4 className="font-medium">{attachment.discordServer?.guildName}</h4>
															<p className="text-xs text-muted-foreground">
																ID: {attachment.discordServer?.guildId}
															</p>
															{attachment.discordServer?.description && (
																<p className="mt-1 text-sm text-muted-foreground">
																	{attachment.discordServer.description}
																</p>
															)}
														</div>
													</AccordionTrigger>
													<AccordionContent className="px-4 pb-4">
														<div className="space-y-4">
															<div className="flex justify-end">
																<Button
																	variant="ghost"
																	size="sm"
																	onClick={() => handleDetachServer(attachment.id)}
																>
																	<Trash2 className="h-4 w-4 text-destructive" />
																</Button>
															</div>

															<div className="grid gap-4 md:grid-cols-2">
																<div className="rounded-xl border border-border/80 bg-background/75 p-4 shadow-sm">
																	<div className="flex items-start justify-between gap-3">
																		<div>
																			<p className="text-sm font-medium">Auto-Invite</p>
																			<p className="text-xs text-muted-foreground">
																				Invite matching members automatically.
																			</p>
																		</div>
																		<Switch
																			id={`auto-invite-${attachment.id}`}
																			checked={attachment.autoInvite}
																			onCheckedChange={() =>
																				handleToggleAutoInvite(attachment.id, attachment.autoInvite)
																			}
																		/>
																	</div>
																</div>

																<div className="rounded-xl border border-border/80 bg-background/75 p-4 shadow-sm">
																	<div className="flex items-start justify-between gap-3">
																		<div>
																			<p className="text-sm font-medium">Role Sync</p>
																			<p className="text-xs text-muted-foreground">
																				When off, the role buckets below are ignored. Nickname
																				tickers still apply if the server is configured to manage
																				nicknames.
																			</p>
																		</div>
																		<Switch
																			id={`auto-assign-${attachment.id}`}
																			checked={attachment.autoAssignRoles}
																			onCheckedChange={() =>
																				handleToggleAutoAssignRoles(
																					attachment.id,
																					attachment.autoAssignRoles
																				)
																			}
																		/>
																	</div>
																</div>
															</div>

										<div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 shadow-md ring-1 ring-border/60">
											<div className="grid gap-6 xl:grid-cols-2">
																	<div className="space-y-3">
																		<div className="flex items-start justify-between gap-3">
																			<div>
																				<p className="text-sm font-medium">Corp Members</p>
																				<p className="text-xs text-muted-foreground">
																					Multi-select roles that apply to every linked user. This
																					bucket is the fallback ticker choice for corporation
																					members.
																				</p>
																			</div>
																		</div>
																		{attachment.roles?.length ? (
																			<div className="flex flex-wrap gap-2">
																				{attachment.roles.map((roleAssignment) => (
																					<div
																						key={roleAssignment.id}
																						className="inline-flex items-center gap-1 rounded-md border border-primary/50 bg-primary/10 px-2 py-1 text-sm text-primary"
																					>
																						<span>{roleAssignment.discordRole.roleName}</span>
																						<button
																							onClick={() =>
																								handleUnassignRole(attachment.id, roleAssignment.id)
																							}
																							className="ml-1 hover:text-destructive"
																						>
																							<X className="h-3 w-3" />
																						</button>
																					</div>
																				))}
																			</div>
																		) : (
																			<p className="text-xs text-muted-foreground">
																				No Corp Members roles assigned yet.
																			</p>
																		)}
																		{(attachment.discordServer?.roles ?? []).filter(
																			(role) =>
																				!getAttachmentUsedRoleIds(attachment).has(role.roleId)
																		).length > 0 && (
																			<div className="flex items-center gap-2">
																				<Select
																					value=""
																					onValueChange={(nextValue) => {
																						if (!nextValue) {
																							return
																						}
																						void handleAssignRole(attachment.id, nextValue).finally(
																							() => {
																								setPendingRoleSelections((prev) => {
																									const { [attachment.id]: _, ...rest } = prev
																									return rest
																								})
																							}
																						)
																					}}
																					query={pendingRoleSelections[attachment.id] ?? ''}
																					onQueryChange={(value) =>
																						setPendingRoleSelections((prev) => ({
																							...prev,
																							[attachment.id]: value,
																						}))
																					}
																					searchable
																					options={buildRoleOptions(attachment).filter(
																						(option) => option.value !== noneScenarioRoleValue
																					)}
																					placeholder="Add role..."
																					emptyText="No matching roles found"
																					className="w-full"
																					contentClassName="w-[min(90vw,36rem)]"
																					inputClassName="h-9"
																				/>
																			</div>
																		)}
																	</div>

											<div className="space-y-3 xl:border-l xl:pl-6">
																		<div className="flex items-start justify-between gap-3">
																			<div>
																				<p className="text-sm font-medium">
																	Corp Members Ticker
																				</p>
																				<p className="text-xs text-muted-foreground">
																	Used for members of this corporation. Takes priority over the guest
																	settings.
																				</p>
																				{!nicknameManagementEnabled && (
																					<p className="mt-1 text-xs text-muted-foreground">
																						Enable nickname management on the Discord server to edit
																						ticker settings.
																					</p>
																				)}
																			</div>
																			<div className="flex items-center gap-2">
																				<Switch
																					id={`corp-members-nickname-enabled-${attachment.id}`}
																					aria-label="Enable Corp Members ticker"
																					checked={attachmentNicknameDrafts.corpMember.enabled}
																					disabled={nicknameControlsDisabled}
																					onCheckedChange={() =>
																						updateNicknameBucketDraft(attachment.id, 'corpMember', {
																							enabled: !attachmentNicknameDrafts.corpMember.enabled,
																						})
																					}
																				/>
																				<Button
																					variant="confirm"
																					size="sm"
																					showIcon={false}
																					disabled={
																						nicknameControlsDisabled ||
																						updateNicknameConfig.isPending
																					}
																					onClick={() =>
																						void saveNicknameBucketDraft(
																							attachment.id,
																							'corpMember'
																						)
																					}
																				>
																					Save
																				</Button>
																			</div>
																		</div>
																		<div className="grid gap-3 sm:grid-cols-2">
																			<Select
																				value={attachmentNicknameDrafts.corpMember.source}
																				disabled={
																					nicknameControlsDisabled ||
																					!attachmentNicknameDrafts.corpMember.enabled
																				}
																				onValueChange={(nextValue) =>
																					updateNicknameBucketDraft(attachment.id, 'corpMember', {
																						source: nextValue as NicknameBucketSource,
																					})
																				}
																				options={NICKNAME_SOURCE_OPTIONS}
																				className="w-full"
																				contentClassName="w-[min(90vw,24rem)]"
																			/>
																			<div className="space-y-1">
																				<Input
																					value={attachmentNicknameDrafts.corpMember.customTicker}
																					disabled={
																						nicknameControlsDisabled ||
																						!attachmentNicknameDrafts.corpMember.enabled ||
																						attachmentNicknameDrafts.corpMember.source !== 'custom'
																					}
																					onChange={(event) =>
																						updateNicknameBucketDraft(attachment.id, 'corpMember', {
																							customTicker: sanitizeNicknameTickerInput(
																								event.target.value
																							),
																						})
																					}
																					placeholder="Custom ticker"
																					maxLength={5}
																				/>
																				<p className="text-xs text-muted-foreground">
																					Max 5 characters.
																				</p>
																			</div>
																		</div>
																	</div>
																</div>
															</div>

															{scenarioRoleConfigs.map((config) => {
																const currentRoleId = attachment[config.roleIdKey]
																const currentRoleLabel =
																	attachment.discordServer?.roles?.find(
																		(role) => role.id === currentRoleId
																	)?.roleName ?? 'None'
																const currentValue = currentRoleId ?? noneScenarioRoleValue
																const nicknameDraft = attachmentNicknameDrafts[config.key]

																return (
																	<div
																		key={`${attachment.id}-${config.roleIdKey}`}
															className={`rounded-xl border p-4 shadow-md ring-1 ring-border/60 ${config.nicknameClassName}`}
																	>
																		<div className="grid gap-6 xl:grid-cols-2">
																			<div className="space-y-3">
																				<div className="flex items-start justify-between gap-3">
																					<div>
																						<p className="text-sm font-medium">{config.label}</p>
																						<p className="text-xs text-muted-foreground">
																							{config.description}
																						</p>
																					</div>
																					<div className="flex items-center gap-2">
																						<Switch
																							id={`${config.autoApplyKey}-${attachment.id}`}
																							checked={attachment[config.autoApplyKey]}
																							onCheckedChange={() =>
																								handleScenarioAutoApplyToggle(
																									attachment.id,
																									config.autoApplyKey,
																									attachment[config.autoApplyKey]
																								)
																							}
																						/>
																						<Label
																							htmlFor={`${config.autoApplyKey}-${attachment.id}`}
																							className="cursor-pointer"
																						>
																							Auto-apply
																						</Label>
																					</div>
																				</div>
																				<div className="space-y-1">
																					<Select
																						value={currentValue}
																						onValueChange={(nextValue) =>
																							void handleScenarioRoleChange(
																								attachment.id,
																								config.roleIdKey,
																								nextValue
																							)
																						}
																						searchable
																						options={buildRoleOptions(attachment, currentRoleId)}
																						placeholder="Select a role..."
																						emptyText="No roles available"
																						className="w-full"
																						contentClassName="w-[min(90vw,36rem)]"
																						inputClassName="h-9"
																					/>
																					<p className="text-xs text-muted-foreground">
																						Currently {currentRoleLabel}
																					</p>
																				</div>
																			</div>

																			<div
															className="space-y-3 xl:border-l xl:pl-6"
																			>
																				<div className="flex items-start justify-between gap-3">
																					<div>
																						<p className="text-sm font-medium">
																							{config.nicknameLabel}
																						</p>
																						<p className="text-xs text-muted-foreground">
																							{config.nicknameDescription}
																						</p>
																					</div>
																					<div className="flex items-center gap-2">
																						<Switch
																							id={`${attachment.id}-${config.key}-nickname-enabled`}
																							checked={nicknameDraft.enabled}
																							disabled={nicknameControlsDisabled}
																							onCheckedChange={() =>
																								updateNicknameBucketDraft(
																									attachment.id,
																									config.key,
																									{
																										enabled: !nicknameDraft.enabled,
																									}
																								)
																							}
																						/>
																						<Button
																							variant="confirm"
																							size="sm"
																							showIcon={false}
																							disabled={
																								nicknameControlsDisabled ||
																								updateNicknameConfig.isPending
																							}
																							onClick={() =>
																								void saveNicknameBucketDraft(
																									attachment.id,
																									config.key
																								)
																							}
																						>
																							Save
																						</Button>
																					</div>
																				</div>
																				<div className="grid gap-3 sm:grid-cols-2">
																					<Select
																						value={nicknameDraft.source}
																						disabled={
																							nicknameControlsDisabled || !nicknameDraft.enabled
																						}
																						onValueChange={(nextValue) =>
																							updateNicknameBucketDraft(attachment.id, config.key, {
																								source: nextValue as NicknameBucketSource,
																							})
																						}
																						options={NICKNAME_SOURCE_OPTIONS}
																						className="w-full"
																						contentClassName="w-[min(90vw,24rem)]"
																					/>
																					<div className="space-y-1">
																						<Input
																							value={nicknameDraft.customTicker}
																							disabled={
																								nicknameControlsDisabled ||
																								!nicknameDraft.enabled ||
																								nicknameDraft.source !== 'custom'
																							}
																							onChange={(event) =>
																								updateNicknameBucketDraft(
																									attachment.id,
																									config.key,
																									{
																										customTicker: sanitizeNicknameTickerInput(
																											event.target.value
																										),
																									}
																								)
																							}
																							placeholder="Custom ticker"
																							maxLength={5}
																						/>
																						<p className="text-xs text-muted-foreground">
																							Max 5 characters.
																						</p>
																					</div>
																				</div>
																			</div>
																		</div>
																	</div>
																)
															})}
														</div>
													</AccordionContent>
												</AccordionItem>
											)
										})}
									</Accordion>
								)}

								{/* Add Server Dialog */}
								<Dialog
									open={showAddServerDialog}
									onOpenChange={(open) => {
										setShowAddServerDialog(open)
										if (!open) {
											setSelectedServerId('')
											setAttachmentSettings({ ...DEFAULT_ATTACHMENT_SETTINGS })
										}
									}}
								>
									<DialogContent>
										<DialogHeader>
											<DialogTitle>Attach Discord Server</DialogTitle>
											<DialogDescription>
												Select a Discord server from the registry to attach to this corporation
											</DialogDescription>
										</DialogHeader>

										<div className="space-y-4">
											<div className="space-y-2">
												<Label htmlFor="discord-server">Select Server</Label>
												<Select
													inputId="discord-server"
													value={selectedServerId}
													onValueChange={setSelectedServerId}
													options={discordServers
														.filter(
															(server) =>
																!corporationDiscordServers.some(
																	(att) => att.discordServerId === server.id
																)
														)
														.map((server) => ({ value: server.id, label: server.guildName }))}
													placeholder="Choose a server..."
													className="w-full"
												/>
											</div>

											<div className="space-y-3">
												<div className="flex items-center space-x-2">
													<Switch
														id="attach-auto-invite"
														checked={attachmentSettings.autoInvite}
														onCheckedChange={(checked) =>
															setAttachmentSettings({ ...attachmentSettings, autoInvite: checked })
														}
													/>
													<Label htmlFor="attach-auto-invite" className="cursor-pointer">
														Enable Auto-Invite
													</Label>
												</div>

												<div className="flex items-center space-x-2">
													<Switch
														id="attach-auto-assign"
														checked={attachmentSettings.autoAssignRoles}
														onCheckedChange={(checked) =>
															setAttachmentSettings({
																...attachmentSettings,
																autoAssignRoles: checked,
															})
														}
													/>
													<Label htmlFor="attach-auto-assign" className="cursor-pointer">
														Auto-Assign Roles
													</Label>
												</div>
												<p className="text-xs text-muted-foreground">
													When enabled, the roles assigned on the main page for this attachment are
													applied to all matching members.
												</p>
											</div>
										</div>

										<DialogFooter>
											<Button variant="cancel" onClick={() => setShowAddServerDialog(false)}>
												Cancel
											</Button>
											<Button
												variant="confirm"
												onClick={handleAttachServer}
												disabled={!selectedServerId}
												showIcon={false}
											>
												<Plus className="h-4 w-4" />
												Attach
											</Button>
										</DialogFooter>
									</DialogContent>
								</Dialog>
							</CardContent>
						</Card>

						<CorporationAlertsCard corporationId={corpId} />
					</TabsContent>

					{/* Data Summary Tab */}
					<TabsContent value="data" className="space-y-4">
						{summaryLoading ? (
							<div className="flex justify-center py-8">
								<LoadingSpinner label="Loading data summary..." />
							</div>
						) : (
							<div className="grid gap-4 md:grid-cols-2">
								<Card>
									<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
										<CardTitle className="text-sm font-medium">Members</CardTitle>
										<Users className="h-4 w-4 text-muted-foreground" />
									</CardHeader>
									<CardContent>
										<div className="text-2xl font-bold">
											{dataSummary?.coreData?.memberCount || 0}
										</div>
										<p className="text-xs text-muted-foreground">
											{dataSummary?.coreData?.trackingCount || 0} with tracking data
										</p>
									</CardContent>
								</Card>

								<Card>
									<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
										<CardTitle className="text-sm font-medium">Wallets</CardTitle>
										<Wallet className="h-4 w-4 text-muted-foreground" />
									</CardHeader>
									<CardContent>
										<div className="text-2xl font-bold">
											{dataSummary?.financialData?.walletCount || 0}
										</div>
										<p className="text-xs text-muted-foreground">
											{dataSummary?.financialData?.journalCount || 0} journal entries
										</p>
									</CardContent>
								</Card>

								<Card>
									<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
										<CardTitle className="text-sm font-medium">Assets</CardTitle>
										<Package className="h-4 w-4 text-muted-foreground" />
									</CardHeader>
									<CardContent>
										<div className="text-2xl font-bold">
											{dataSummary?.assetsData?.assetCount || 0}
										</div>
										<p className="text-xs text-muted-foreground">
											{dataSummary?.assetsData?.structureCount || 0} structures
										</p>
									</CardContent>
								</Card>

								<Card>
									<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
										<CardTitle className="text-sm font-medium">Market</CardTitle>
										<TrendingUp className="h-4 w-4 text-muted-foreground" />
									</CardHeader>
									<CardContent>
										<div className="text-2xl font-bold">
											{dataSummary?.marketData?.orderCount || 0}
										</div>
										<p className="text-xs text-muted-foreground">
											{dataSummary?.marketData?.contractCount || 0} contracts
										</p>
									</CardContent>
								</Card>

								<Card>
									<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
										<CardTitle className="text-sm font-medium">Killmails</CardTitle>
										<Skull className="h-4 w-4 text-muted-foreground" />
									</CardHeader>
									<CardContent>
										<div className="text-2xl font-bold">{dataSummary?.killmailCount || 0}</div>
										<p className="text-xs text-muted-foreground">Recent killmails</p>
									</CardContent>
								</Card>
							</div>
						)}
					</TabsContent>

					{/* Fetch Data Tab */}
					<TabsContent value="fetch" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Fetch Corporation Data</CardTitle>
								<CardDescription>
									Trigger data fetches from EVE ESI. Requires assigned director with proper roles.
								</CardDescription>
							</CardHeader>
							<CardContent>
								<div className="grid gap-3">
									<Button
										onClick={() => handleFetch('all')}
										disabled={fetchData.isPending || !corporation.assignedCharacterId}
										className="w-full justify-start"
									>
										<Database className="h-4 w-4" />
										Fetch All Data
									</Button>
									<Button
										variant="ghost"
										onClick={() => handleFetch('public')}
										disabled={fetchData.isPending}
										className="w-full justify-start"
									>
										<Building2 className="h-4 w-4" />
										Fetch Public Data
									</Button>
									<Button
										variant="ghost"
										onClick={() => handleFetch('core')}
										disabled={fetchData.isPending || !corporation.assignedCharacterId}
										className="w-full justify-start"
									>
										<Users className="h-4 w-4" />
										Fetch Members & Tracking
									</Button>
									<Button
										variant="ghost"
										onClick={() => handleFetch('financial')}
										disabled={fetchData.isPending || !corporation.assignedCharacterId}
										className="w-full justify-start"
									>
										<Wallet className="h-4 w-4" />
										Fetch Financial Data
									</Button>
									<Button
										variant="ghost"
										onClick={() => handleFetch('assets')}
										disabled={fetchData.isPending || !corporation.assignedCharacterId}
										className="w-full justify-start"
									>
										<Package className="h-4 w-4" />
										Fetch Assets & Structures
									</Button>
									<Button
										variant="ghost"
										onClick={() => handleFetch('market')}
										disabled={fetchData.isPending || !corporation.assignedCharacterId}
										className="w-full justify-start"
									>
										<TrendingUp className="h-4 w-4" />
										Fetch Market Data
									</Button>
									<Button
										variant="ghost"
										onClick={() => handleFetch('killmails')}
										disabled={fetchData.isPending || !corporation.assignedCharacterId}
										className="w-full justify-start"
									>
										<Skull className="h-4 w-4" />
										Fetch Killmails
									</Button>
								</div>
							</CardContent>
						</Card>
					</TabsContent>

					{/* Permissions Tab */}
					<TabsContent value="permissions" className="space-y-4">
						<Card>
							<CardHeader>
								<div className="flex items-center justify-between">
									<div>
										<CardTitle>Corporation Permissions</CardTitle>
										<CardDescription>
											Manage permissions for all members of this corporation. Permissions are
											automatically inherited by all corporation members.
										</CardDescription>
									</div>
									<Button onClick={() => setShowAttachPermissionDialog(true)}>
										<Plus className="h-4 w-4" />
										Attach Permission
									</Button>
								</div>
							</CardHeader>
							<CardContent>
								{permissionsLoading ? (
									<LoadingSpinner />
								) : corporationPermissions.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										No permissions attached to this corporation.
									</p>
								) : (
									<div className="space-y-2">
										{corporationPermissions.map((perm) => (
											<Card key={perm.id} className="p-4">
												<div className="flex items-start justify-between">
													<div className="flex-1">
														<div className="flex items-center gap-2">
															<Shield className="h-4 w-4 text-muted-foreground" />
															<h4 className="font-semibold">{perm.permission.name}</h4>
														</div>
														<p className="mt-1 text-sm text-muted-foreground">
															{perm.permission.urn}
														</p>
														{perm.permission.description && (
															<p className="mt-1 text-sm">{perm.permission.description}</p>
														)}
														{perm.permission.category && (
															<div className="mt-2 inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs">
																{perm.permission.category.name}
															</div>
														)}
														<p className="mt-2 text-xs text-muted-foreground">
															Added {new Date(perm.createdAt).toLocaleDateString()}
														</p>
													</div>
													<Button
														variant="destructive"
														size="sm"
														showIcon={false}
														onClick={() =>
															requestConfirmation({
																title: 'Remove Permission',
																description:
																	'Are you sure you want to remove this permission from the corporation?',
																confirmLabel: 'Remove',
																intent: 'destructive',
																onConfirm: () => handleRemovePermission(perm.id),
															})
														}
													>
														<Trash2 className="h-4 w-4" />
													</Button>
												</div>
											</Card>
										))}
									</div>
								)}
							</CardContent>
						</Card>

						{/* Attach Permission Dialog */}
						<Dialog open={showAttachPermissionDialog} onOpenChange={setShowAttachPermissionDialog}>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>Attach Permission to Corporation</DialogTitle>
									<DialogDescription>
										Select a global permission to attach to this corporation. All members will
										automatically inherit this permission.
									</DialogDescription>
								</DialogHeader>
								<div className="space-y-4">
									<div>
										<Label htmlFor="permission">Permission</Label>
										<Select
											inputId="permission"
											value={selectedPermissionId}
											onValueChange={setSelectedPermissionId}
											searchable
											options={globalPermissions
												.filter(
													(gp) => !corporationPermissions.some((cp) => cp.permissionId === gp.id)
												)
												.map((perm) => ({
													value: perm.id,
													label: perm.name,
													description: perm.urn,
												}))}
											placeholder="Select a permission..."
											className="mt-1.5 w-full"
										/>
									</div>
								</div>
								<DialogFooter>
									<Button variant="cancel" onClick={() => setShowAttachPermissionDialog(false)}>
										Cancel
									</Button>
									<Button
										variant="confirm"
										onClick={handleAttachPermission}
										disabled={!selectedPermissionId || attachPermission.isPending}
									>
										Attach Permission
									</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>
					</TabsContent>
				</Tabs>
			</div>
			{confirmationDialog}
		</>
	)
}
