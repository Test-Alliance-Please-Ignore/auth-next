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
import { formatDateTime, formatNumber, useAppTranslation } from '@/i18n'
import { formatRelativeTime } from '@/lib/date-utils'

import type { AppTranslationKey } from '@/i18n'
import type { CorporationAccessVerification, CorporationDiscordServer } from '@/lib/api'

const fetchCategoryKeys = {
	all: 'admin.organizations.corp.categories.all',
	public: 'admin.organizations.corp.categories.public',
	core: 'admin.organizations.corp.categories.core',
	financial: 'admin.organizations.corp.categories.financial',
	assets: 'admin.organizations.corp.categories.assets',
	market: 'admin.organizations.corp.categories.market',
	killmails: 'admin.organizations.corp.categories.killmails',
} as const

const ACCESS_ROLE_GROUPS = [
	{ labelKey: 'admin.organizations.roles.director', roles: ['Director'] },
	{ labelKey: 'admin.organizations.roles.accountants', roles: ['Accountant', 'Junior_Accountant'] },
	{ labelKey: 'admin.organizations.roles.stationManager', roles: ['Station_Manager'] },
	{
		labelKey: 'admin.organizations.roles.traders',
		roles: ['Accountant', 'Junior_Accountant', 'Trader'],
	},
	{ labelKey: 'admin.organizations.roles.factoryManager', roles: ['Factory_Manager'] },
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

const NICKNAME_SOURCE_OPTIONS: Array<{ value: NicknameBucketSource; labelKey: AppTranslationKey }> =
	[
		{ value: 'corp', labelKey: 'admin.organizations.discord.corpTicker' },
		{ value: 'alliance', labelKey: 'admin.organizations.discord.allianceTicker' },
		{ value: 'custom', labelKey: 'admin.organizations.discord.customTicker' },
	]

const EMPTY_CORPORATION_DISCORD_SERVERS: CorporationDiscordServer[] = []

function sanitizeNicknameTickerInput(value: string): string {
	return value
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '')
		.slice(0, 5)
}

const NICKNAME_BUCKET_CONFIGS: Array<{
	key: NicknameBucketKey
	labelKey: AppTranslationKey
	descriptionKey: AppTranslationKey
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
		labelKey: 'admin.organizations.discord.corpMembers',
		descriptionKey: 'admin.organizations.discord.corpMembersDescription',
		enabledField: 'corpMemberNicknameEnabled',
		sourceField: 'corpMemberNicknameSource',
		customField: 'corpMemberNicknameCustomTicker',
	},
	{
		key: 'allianceGuest',
		labelKey: 'admin.organizations.discord.allianceGuest',
		descriptionKey: 'admin.organizations.discord.allianceGuestDescription',
		enabledField: 'allianceGuestNicknameEnabled',
		sourceField: 'allianceGuestNicknameSource',
		customField: 'allianceGuestNicknameCustomTicker',
	},
	{
		key: 'nonAllianceGuest',
		labelKey: 'admin.organizations.discord.otherGuest',
		descriptionKey: 'admin.organizations.discord.otherGuestDescription',
		enabledField: 'nonAllianceGuestNicknameEnabled',
		sourceField: 'nonAllianceGuestNicknameSource',
		customField: 'nonAllianceGuestNicknameCustomTicker',
	},
] as const

export default function CorporationDetailPage() {
	const { t } = useAppTranslation()
	const { corporationId } = useParams<{ corporationId: string }>()
	const corpId = corporationId || ''

	const { data: corporation, isLoading } = useCorporation(corpId)

	// Set dynamic page title based on corporation name
	usePageTitle(
		corporation?.name
			? t('admin.organizations.shared.entityTitle', { name: corporation.name })
			: t('admin.organizations.corp.detailPageTitle')
	)
	const { data: dataSummary, isLoading: summaryLoading } = useCorporationDataSummary(corpId)
	const updateCorporation = useUpdateCorporation()
	const verifyAccess = useVerifyCorporationAccess()
	const fetchData = useFetchCorporationData()

	// Discord hooks
	const refreshCorporationDiscord = useRefreshCorporationDiscord()
	const { data: discordServers = [] } = useDiscordServers()
	const { data: corporationDiscordServersData } = useCorporationDiscordServers(corpId)
	const corporationDiscordServers =
		corporationDiscordServersData ?? EMPTY_CORPORATION_DISCORD_SERVERS
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
		successKey: AppTranslationKey,
		errorKey: AppTranslationKey
	) => {
		try {
			await updateAttachment.mutateAsync({
				corporationId: corpId,
				attachmentId,
				data,
			})
			showSuccess((t) => t(successKey))
		} catch (error) {
			showError((t) => (error instanceof Error ? error.message : t(errorKey)))
		}
	}

	const updateNicknameAttachment = async (
		attachmentId: string,
		data: Parameters<typeof updateNicknameConfig.mutateAsync>[0]['data'],
		successKey: AppTranslationKey,
		errorKey: AppTranslationKey
	) => {
		try {
			await updateNicknameConfig.mutateAsync({
				corporationId: corpId,
				attachmentId,
				data,
			})
			showSuccess((t) => t(successKey))
		} catch (error) {
			showError((t) => (error instanceof Error ? error.message : t(errorKey)))
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
			showSuccess((t) => t('admin.organizations.feedback.serverAttached'))
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.organizations.feedback.serverAttachError')
			)
		}
	}

	const handleDetachServer = async (attachmentId: string) => {
		requestConfirmation({
			title: (t) => t('admin.organizations.discord.detachTitle'),
			description: (t) => t('admin.organizations.discord.detachWarning'),
			confirmLabel: (t) => t('admin.organizations.discord.detach'),
			intent: 'destructive',
			onConfirm: async () => {
				try {
					await detachServer.mutateAsync({ corporationId: corpId, attachmentId })
					showSuccess((t) => t('admin.organizations.feedback.serverDetached'))
				} catch (error) {
					showError((t) =>
						error instanceof Error
							? error.message
							: t('admin.organizations.feedback.serverDetachError')
					)
				}
			},
		})
	}

	const handleToggleAutoInvite = async (attachmentId: string, currentValue: boolean) => {
		await updateRoleAttachment(
			attachmentId,
			{ autoInvite: !currentValue },
			'admin.organizations.feedback.autoInviteSaved',
			'admin.organizations.feedback.autoInviteError'
		)
	}

	const handleToggleAutoAssignRoles = async (attachmentId: string, currentValue: boolean) => {
		await updateRoleAttachment(
			attachmentId,
			{ autoAssignRoles: !currentValue },
			'admin.organizations.feedback.autoAssignSaved',
			'admin.organizations.feedback.autoAssignError'
		)
	}

	const handleAssignRole = async (attachmentId: string, discordRoleId: string) => {
		try {
			await assignRole.mutateAsync({
				corporationId: corpId,
				attachmentId,
				data: { discordRoleId },
			})
			showSuccess((t) => t('admin.organizations.feedback.roleAssigned'))
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.organizations.feedback.roleAssignError')
			)
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
			'admin.organizations.feedback.scenarioRoleSaved',
			'admin.organizations.feedback.scenarioRoleError'
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
			'admin.organizations.feedback.scenarioAutoSaved',
			'admin.organizations.feedback.scenarioAutoError'
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
			'admin.organizations.feedback.nicknameSaved',
			'admin.organizations.feedback.nicknameError'
		)
	}

	const handleUnassignRole = async (attachmentId: string, roleAssignmentId: string) => {
		try {
			await unassignRole.mutateAsync({
				corporationId: corpId,
				attachmentId,
				roleAssignmentId,
			})
			showSuccess((t) => t('admin.organizations.feedback.roleUnassigned'))
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.organizations.feedback.roleUnassignError')
			)
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
			showSuccess((t) => t('admin.organizations.feedback.permissionAttached'))
		} catch (error) {
			showError((t) =>
				error instanceof Error
					? error.message
					: t('admin.organizations.feedback.permissionAttachError')
			)
		}
	}

	const handleRemovePermission = async (permissionId: string) => {
		try {
			await removePermission.mutateAsync({
				corporationId: corpId,
				permissionId,
			})
			showSuccess((t) => t('admin.organizations.feedback.permissionRemoved'))
		} catch (error) {
			showError((t) =>
				error instanceof Error
					? error.message
					: t('admin.organizations.feedback.permissionRemoveError')
			)
		}
	}

	const handleVerify = async () => {
		clearMessage()
		setAccessVerification(null)
		try {
			const result = await verifyAccess.mutateAsync(corpId)
			setAccessVerification(result)
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.organizations.feedback.accessError')
			)
		}
	}

	const handleFetch = async (category: keyof typeof fetchCategoryKeys) => {
		try {
			await fetchData.mutateAsync({ corporationId: corpId, data: { category } })
			showSuccess((t) =>
				t('admin.organizations.feedback.fetchStarted', {
					category: t(fetchCategoryKeys[category]),
				})
			)
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.organizations.feedback.fetchError')
			)
		}
	}

	const handleUpdateBackgroundRefresh = async (enabled: boolean) => {
		try {
			await updateCorporation.mutateAsync({
				corporationId: corpId,
				data: { includeInBackgroundRefresh: enabled },
			})
			showSuccess((t) =>
				t(
					enabled
						? 'admin.organizations.feedback.backgroundEnabled'
						: 'admin.organizations.feedback.backgroundDisabled'
				)
			)
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.organizations.feedback.settingError')
			)
		}
	}

	const handleUpdateStructureAssetSync = async (enabled: boolean) => {
		try {
			await updateCorporation.mutateAsync({
				corporationId: corpId,
				data: { includeInStructureAssetSync: enabled },
			})
			showSuccess((t) =>
				t(
					enabled
						? 'admin.organizations.feedback.assetsEnabled'
						: 'admin.organizations.feedback.assetsDisabled'
				)
			)
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.organizations.feedback.settingError')
			)
		}
	}

	const handleUpdateMemberCorporation = async (enabled: boolean) => {
		if (!enabled) {
			requestConfirmation({
				title: (t) => t('admin.organizations.corp.disableMemberTitle'),
				description: (t) => t('admin.organizations.corp.disableMemberWarning'),
				confirmLabel: (t) => t('admin.organizations.corp.disableMembership'),
				intent: 'destructive',
				onConfirm: async () => {
					try {
						await updateCorporation.mutateAsync({
							corporationId: corpId,
							data: { isMemberCorporation: enabled },
						})
						showSuccess((t) => t('admin.organizations.feedback.memberDisabled'))
					} catch (error) {
						showError((t) =>
							error instanceof Error
								? error.message
								: t('admin.organizations.feedback.settingError')
						)
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
			showSuccess((t) => t('admin.organizations.feedback.memberEnabled'))
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.organizations.feedback.settingError')
			)
		}
	}

	const handleUpdateAltCorp = async (enabled: boolean) => {
		try {
			await updateCorporation.mutateAsync({
				corporationId: corpId,
				data: { isAltCorp: enabled },
			})
			showSuccess((t) =>
				t(
					enabled
						? 'admin.organizations.feedback.altEnabled'
						: 'admin.organizations.feedback.altDisabled'
				)
			)
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.organizations.feedback.settingError')
			)
		}
	}

	const handleUpdateSpecialPurpose = async (enabled: boolean) => {
		try {
			await updateCorporation.mutateAsync({
				corporationId: corpId,
				data: { isSpecialPurpose: enabled },
			})
			showSuccess((t) =>
				t(
					enabled
						? 'admin.organizations.feedback.specialEnabled'
						: 'admin.organizations.feedback.specialDisabled'
				)
			)
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.organizations.feedback.settingError')
			)
		}
	}

	const formatDate = (date: string | Date | null) => {
		if (!date) return t('admin.users.account.never')
		const parsedDate = date instanceof Date ? date : new Date(date)
		if (Number.isNaN(parsedDate.getTime())) return t('admin.users.account.never')
		return formatRelativeTime(parsedDate)
	}

	const scenarioRoleConfigs = [
		{
			key: 'allianceGuest',
			label: t('admin.organizations.discord.allianceGuest'),
			description: t('admin.organizations.discord.allianceGuestDescription'),
			nicknameLabel: t('admin.organizations.discord.allianceGuestTicker'),
			nicknameDescription: t('admin.organizations.discord.allianceTickerHint'),
			nicknameClassName: 'border-sky-500/30 bg-sky-500/5',
			roleIdKey: 'allianceGuestRoleId' as const,
			autoApplyKey: 'allianceGuestAutoApply' as const,
		},
		{
			key: 'nonAllianceGuest',
			label: t('admin.organizations.discord.otherGuest'),
			description: t('admin.organizations.discord.otherGuestDescription'),
			nicknameLabel: t('admin.organizations.discord.otherGuestTicker'),
			nicknameDescription: t('admin.organizations.discord.otherTickerHint'),
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
				label: t('admin.users.discord.none'),
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
				<LoadingSpinner label={t('admin.organizations.corp.loadingDetail')} />
			</div>
		)
	}

	if (!corporation) {
		return (
			<div className="text-center py-12">
				<Building2 className="mx-auto h-12 w-12 text-muted-foreground" />
				<h3 className="mt-4 text-lg font-medium">{t('admin.organizations.corp.notFound')}</h3>
				<p className="text-muted-foreground mt-2">{t('admin.organizations.corp.notFoundHint')}</p>
				<Button asChild className="mt-4">
					<Link to="/admin/corporations">
						<ArrowLeft className="h-4 w-4" />
						{t('admin.organizations.corp.back')}
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
						{t('admin.organizations.corp.back')}
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
								{verifyAccess.isPending
									? t('admin.organizations.corp.verifying')
									: t('admin.organizations.corp.verify')}
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
										<CardTitle className="text-base">
											{t('admin.organizations.corp.accessVerification')}
										</CardTitle>
										<Badge
											variant={accessVerification.hasAccess ? 'success' : 'destructive'}
											className="gap-1"
										>
											{accessVerification.hasAccess ? (
												<CheckCircle2 className="h-3 w-3" />
											) : (
												<ShieldAlert className="h-3 w-3" />
											)}
											{accessVerification.hasAccess
												? t('admin.organizations.corp.accessVerified')
												: t('admin.organizations.corp.accessMissing')}
										</Badge>
									</div>
									<CardDescription>
										{accessVerification.hasAccess
											? t('admin.organizations.corp.verifiedVia', {
													name:
														accessVerification.characterName ??
														t('admin.organizations.corp.eligibleDirector'),
												})
											: t('admin.organizations.corp.noDirectorAccess')}
									</CardDescription>
								</div>
								<p className="text-xs text-muted-foreground">
									{accessVerification.lastVerified
										? t('admin.organizations.corp.checked', {
												date: formatDate(accessVerification.lastVerified),
											})
										: t('admin.organizations.corp.notChecked')}
								</p>
							</div>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<div className="flex items-center justify-between gap-3">
									<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
										{t('admin.organizations.corp.roleRequirements')}
									</p>
									<p className="text-xs text-muted-foreground">
										{t('admin.organizations.corp.rolesSatisfied', {
											satisfied: satisfiedAccessRoleGroups.length,
											total: ACCESS_ROLE_GROUPS.length,
										})}
									</p>
								</div>
								<div className="flex flex-wrap gap-2">
									{accessRoleStatuses.map((group) => (
										<Badge
											key={group.labelKey}
											variant={group.satisfied ? 'success' : 'destructive'}
											className="gap-1"
										>
											{group.satisfied ? (
												<CheckCircle2 className="h-3 w-3" />
											) : (
												<XCircle className="h-3 w-3" />
											)}
											{t(group.labelKey)}
										</Badge>
									))}
								</div>
							</div>

							{missingAccessRoleGroups.length > 0 && (
								<div className="space-y-2">
									<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
										{t('admin.organizations.corp.missingRoles')}
									</p>
									<div className="flex flex-wrap gap-2">
										{missingAccessRoleGroups.map((group) => (
											<Badge key={group.labelKey} variant="destructive" className="gap-1">
												<XCircle className="h-3 w-3" />
												{t(group.labelKey)}
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
							<CardTitle className="text-sm font-medium">
								{t('admin.users.account.status')}
							</CardTitle>
							{corporation.isActive ? (
								<CheckCircle2 className="h-4 w-4 text-green-600" />
							) : (
								<XCircle className="h-4 w-4 text-muted-foreground" />
							)}
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">
								{corporation.isActive
									? t('admin.users.account.active')
									: t('admin.organizations.corp.inactive')}
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">
								{t('admin.organizations.corp.lastSync')}
							</CardTitle>
							<RefreshCw className="h-4 w-4 text-muted-foreground" />
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">{formatDate(corporation.lastSync)}</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">
								{t('admin.organizations.corp.verification')}
							</CardTitle>
							{corporation.isVerified ? (
								<ShieldCheck className="h-4 w-4 text-green-600" />
							) : (
								<ShieldAlert className="h-4 w-4 text-destructive" />
							)}
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">
								{corporation.isVerified
									? t('admin.organizations.corp.verified')
									: t('admin.organizations.corp.unverified')}
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
						<TabsTrigger value="config">{t('admin.organizations.corp.configuration')}</TabsTrigger>
						<TabsTrigger value="data">{t('admin.organizations.corp.dataSummary')}</TabsTrigger>
						<TabsTrigger value="fetch">{t('admin.organizations.corp.fetchData')}</TabsTrigger>
						<TabsTrigger value="permissions">{t('admin.nav.permissions')}</TabsTrigger>
					</TabsList>

					{/* Configuration Tab */}
					<TabsContent value="config" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>{t('admin.organizations.corp.directors')}</CardTitle>
								<CardDescription>
									{t('admin.organizations.corp.directorDescription')}
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
									<CardTitle>{t('admin.organizations.corp.collectionSettings')}</CardTitle>
								</div>
								<CardDescription>
									{t('admin.organizations.corp.collectionDescription')}
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
												{t('admin.organizations.corp.backgroundRefresh')}
											</Label>
										</div>
										<p className="text-sm text-muted-foreground ml-11">
											{t('admin.organizations.corp.backgroundDescription')}
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
												{t('admin.organizations.corp.structureSync')}
											</Label>
										</div>
										<p className="text-sm text-muted-foreground ml-11">
											{t('admin.organizations.corp.structureDescription')}
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
									<CardTitle>{t('admin.organizations.corp.classification')}</CardTitle>
								</div>
								<CardDescription>
									{t('admin.organizations.corp.classificationDescription')}
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
												{t('admin.organizations.corp.member')}
											</Label>
										</div>
										<p className="text-sm text-muted-foreground ml-11">
											{t('admin.organizations.corp.memberHint')}
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
												{t('admin.organizations.corp.alt')}
											</Label>
										</div>
										<p className="text-sm text-muted-foreground ml-11">
											{t('admin.organizations.corp.altHint')}
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
												{t('admin.organizations.corp.special')}
											</Label>
										</div>
										<p className="text-sm text-muted-foreground ml-11">
											{t('admin.organizations.corp.specialHint')}
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
											<CardTitle>{t('admin.organizations.discord.servers')}</CardTitle>
										</div>
										<CardDescription>
											{t('admin.organizations.discord.corpDescription')}
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
																(t) =>
																	data.message ||
																	t('admin.organizations.discord.queued', {
																		count: data.usersQueued,
																	})
															),
														onError: (error) =>
															showError((t) =>
																error instanceof Error
																	? error.message
																	: t('admin.organizations.feedback.discordRefreshError')
															),
													}
												)
											}}
										>
											<RefreshCw
												className={`h-4 w-4 ${refreshCorporationDiscord.isPending ? 'animate-spin' : ''}`}
											/>
											{t('admin.organizations.discord.refreshMembers')}
										</Button>
										<Button
											onClick={() => setShowAddServerDialog(true)}
											disabled={discordServers.length === 0}
											size="sm"
										>
											<Plus className="h-4 w-4" />
											{t('admin.organizations.discord.attachServer')}
										</Button>
									</div>
								</div>
							</CardHeader>
							<CardContent>
								{corporationDiscordServers.length === 0 ? (
									<div className="text-center py-8">
										<MessageSquare className="mx-auto h-12 w-12 text-muted-foreground" />
										<h3 className="mt-4 text-sm font-medium">
											{t('admin.organizations.discord.empty')}
										</h3>
										<p className="text-sm text-muted-foreground mt-2">
											{t('admin.organizations.discord.emptyHint')}
										</p>
										{discordServers.length === 0 && (
											<p className="text-xs text-muted-foreground mt-2">
												<Link to="/admin/discord-servers" className="text-primary hover:underline">
													{t('admin.organizations.discord.registryHint')}
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
																{t('admin.organizations.shared.id', {
																	id: attachment.discordServer?.guildId,
																})}
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
																			<p className="text-sm font-medium">
																				{t('admin.organizations.discord.autoInvite')}
																			</p>
																			<p className="text-xs text-muted-foreground">
																				{t('admin.organizations.discord.autoInviteHint')}
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
																			<p className="text-sm font-medium">
																				{t('admin.organizations.discord.roleSync')}
																			</p>
																			<p className="text-xs text-muted-foreground">
																				{t('admin.organizations.discord.roleSyncHint')}
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
																				<p className="text-sm font-medium">
																					{t('admin.organizations.discord.corpMembers')}
																				</p>
																				<p className="text-xs text-muted-foreground">
																					{t('admin.organizations.discord.corpRolesHint')}
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
																				{t('admin.organizations.discord.noCorpRoles')}
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
																					placeholder={t('admin.organizations.discord.addRole')}
																					emptyText={t(
																						'admin.organizations.discord.noMatchingRoles'
																					)}
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
																					{t('admin.organizations.discord.corpMembersTicker')}
																				</p>
																				<p className="text-xs text-muted-foreground">
																					{t('admin.organizations.discord.corpTickerHint')}
																				</p>
																				{!nicknameManagementEnabled && (
																					<p className="mt-1 text-xs text-muted-foreground">
																						{t('admin.organizations.discord.enableNicknameHint')}
																					</p>
																				)}
																			</div>
																			<div className="flex items-center gap-2">
																				<Switch
																					id={`corp-members-nickname-enabled-${attachment.id}`}
																					aria-label={t(
																						'admin.organizations.discord.enableCorpTicker'
																					)}
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
																					{t('admin.organizations.shared.save')}
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
																				options={NICKNAME_SOURCE_OPTIONS.map(
																					({ value, labelKey }) => ({ value, label: t(labelKey) })
																				)}
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
																					placeholder={t(
																						'admin.organizations.discord.customTicker'
																					)}
																					maxLength={5}
																				/>
																				<p className="text-xs text-muted-foreground">
																					{t('admin.organizations.discord.tickerLimit')}
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
																	)?.roleName ?? t('admin.users.discord.none')
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
																							{t('admin.organizations.discord.autoApply')}
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
																						placeholder={t(
																							'admin.organizations.discord.selectRole'
																						)}
																						emptyText={t('admin.organizations.discord.noAvailable')}
																						className="w-full"
																						contentClassName="w-[min(90vw,36rem)]"
																						inputClassName="h-9"
																					/>
																					<p className="text-xs text-muted-foreground">
																						{t('admin.organizations.discord.currentRole', {
																							role: currentRoleLabel,
																						})}
																					</p>
																				</div>
																			</div>

																			<div className="space-y-3 xl:border-l xl:pl-6">
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
																							{t('admin.organizations.shared.save')}
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
																						options={NICKNAME_SOURCE_OPTIONS.map(
																							({ value, labelKey }) => ({
																								value,
																								label: t(labelKey),
																							})
																						)}
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
																							placeholder={t(
																								'admin.organizations.discord.customTicker'
																							)}
																							maxLength={5}
																						/>
																						<p className="text-xs text-muted-foreground">
																							{t('admin.organizations.discord.tickerLimit')}
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
											<DialogTitle>{t('admin.organizations.discord.attachTitle')}</DialogTitle>
											<DialogDescription>
												{t('admin.organizations.discord.attachCorpDescription')}
											</DialogDescription>
										</DialogHeader>

										<div className="space-y-4">
											<div className="space-y-2">
												<Label htmlFor="discord-server">
													{t('admin.organizations.discord.selectServer')}
												</Label>
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
													placeholder={t('admin.organizations.discord.chooseServer')}
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
														{t('admin.organizations.discord.enableAutoInvite')}
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
														{t('admin.organizations.discord.autoAssign')}
													</Label>
												</div>
												<p className="text-xs text-muted-foreground">
													{t('admin.organizations.discord.rolesApplyHint')}
												</p>
											</div>
										</div>

										<DialogFooter>
											<Button variant="cancel" onClick={() => setShowAddServerDialog(false)}>
												{t('common.cancel')}
											</Button>
											<Button
												variant="confirm"
												onClick={handleAttachServer}
												disabled={!selectedServerId}
												showIcon={false}
											>
												<Plus className="h-4 w-4" />
												{t('admin.organizations.discord.attach')}
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
								<LoadingSpinner label={t('admin.organizations.corp.loadingSummary')} />
							</div>
						) : (
							<div className="grid gap-4 md:grid-cols-2">
								<Card>
									<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
										<CardTitle className="text-sm font-medium">
											{t('admin.organizations.group.members')}
										</CardTitle>
										<Users className="h-4 w-4 text-muted-foreground" />
									</CardHeader>
									<CardContent>
										<div className="text-2xl font-bold">
											{formatNumber(dataSummary?.coreData?.memberCount || 0)}
										</div>
										<p className="text-xs text-muted-foreground">
											{t('admin.organizations.corp.tracking', {
												count: dataSummary?.coreData?.trackingCount || 0,
											})}
										</p>
									</CardContent>
								</Card>

								<Card>
									<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
										<CardTitle className="text-sm font-medium">{t('admin.nav.wallets')}</CardTitle>
										<Wallet className="h-4 w-4 text-muted-foreground" />
									</CardHeader>
									<CardContent>
										<div className="text-2xl font-bold">
											{formatNumber(dataSummary?.financialData?.walletCount || 0)}
										</div>
										<p className="text-xs text-muted-foreground">
											{t('admin.organizations.corp.journal', {
												count: dataSummary?.financialData?.journalCount || 0,
											})}
										</p>
									</CardContent>
								</Card>

								<Card>
									<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
										<CardTitle className="text-sm font-medium">
											{t('admin.organizations.corp.assets')}
										</CardTitle>
										<Package className="h-4 w-4 text-muted-foreground" />
									</CardHeader>
									<CardContent>
										<div className="text-2xl font-bold">
											{formatNumber(dataSummary?.assetsData?.assetCount || 0)}
										</div>
										<p className="text-xs text-muted-foreground">
											{t('admin.organizations.corp.structures', {
												count: dataSummary?.assetsData?.structureCount || 0,
											})}
										</p>
									</CardContent>
								</Card>

								<Card>
									<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
										<CardTitle className="text-sm font-medium">
											{t('admin.organizations.corp.market')}
										</CardTitle>
										<TrendingUp className="h-4 w-4 text-muted-foreground" />
									</CardHeader>
									<CardContent>
										<div className="text-2xl font-bold">
											{formatNumber(dataSummary?.marketData?.orderCount || 0)}
										</div>
										<p className="text-xs text-muted-foreground">
											{t('admin.organizations.corp.contracts', {
												count: dataSummary?.marketData?.contractCount || 0,
											})}
										</p>
									</CardContent>
								</Card>

								<Card>
									<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
										<CardTitle className="text-sm font-medium">
											{t('admin.organizations.corp.killmails')}
										</CardTitle>
										<Skull className="h-4 w-4 text-muted-foreground" />
									</CardHeader>
									<CardContent>
										<div className="text-2xl font-bold">
											{formatNumber(dataSummary?.killmailCount || 0)}
										</div>
										<p className="text-xs text-muted-foreground">
											{t('admin.organizations.corp.recentKillmails')}
										</p>
									</CardContent>
								</Card>
							</div>
						)}
					</TabsContent>

					{/* Fetch Data Tab */}
					<TabsContent value="fetch" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>{t('admin.organizations.corp.fetchTitle')}</CardTitle>
								<CardDescription>{t('admin.organizations.corp.fetchDescription')}</CardDescription>
							</CardHeader>
							<CardContent>
								<div className="grid gap-3">
									<Button
										onClick={() => handleFetch('all')}
										disabled={fetchData.isPending || !corporation.assignedCharacterId}
										className="w-full justify-start"
									>
										<Database className="h-4 w-4" />
										{t('admin.organizations.corp.fetchAll')}
									</Button>
									<Button
										variant="ghost"
										onClick={() => handleFetch('public')}
										disabled={fetchData.isPending}
										className="w-full justify-start"
									>
										<Building2 className="h-4 w-4" />
										{t('admin.organizations.corp.fetchPublic')}
									</Button>
									<Button
										variant="ghost"
										onClick={() => handleFetch('core')}
										disabled={fetchData.isPending || !corporation.assignedCharacterId}
										className="w-full justify-start"
									>
										<Users className="h-4 w-4" />
										{t('admin.organizations.corp.fetchMembers')}
									</Button>
									<Button
										variant="ghost"
										onClick={() => handleFetch('financial')}
										disabled={fetchData.isPending || !corporation.assignedCharacterId}
										className="w-full justify-start"
									>
										<Wallet className="h-4 w-4" />
										{t('admin.organizations.corp.fetchFinancial')}
									</Button>
									<Button
										variant="ghost"
										onClick={() => handleFetch('assets')}
										disabled={fetchData.isPending || !corporation.assignedCharacterId}
										className="w-full justify-start"
									>
										<Package className="h-4 w-4" />
										{t('admin.organizations.corp.fetchAssets')}
									</Button>
									<Button
										variant="ghost"
										onClick={() => handleFetch('market')}
										disabled={fetchData.isPending || !corporation.assignedCharacterId}
										className="w-full justify-start"
									>
										<TrendingUp className="h-4 w-4" />
										{t('admin.organizations.corp.fetchMarket')}
									</Button>
									<Button
										variant="ghost"
										onClick={() => handleFetch('killmails')}
										disabled={fetchData.isPending || !corporation.assignedCharacterId}
										className="w-full justify-start"
									>
										<Skull className="h-4 w-4" />
										{t('admin.organizations.corp.fetchKillmails')}
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
										<CardTitle>{t('admin.organizations.corp.permissions')}</CardTitle>
										<CardDescription>
											{t('admin.organizations.corp.permissionsDescription')}
										</CardDescription>
									</div>
									<Button onClick={() => setShowAttachPermissionDialog(true)}>
										<Plus className="h-4 w-4" />
										{t('admin.permissionAttachment.attach')}
									</Button>
								</div>
							</CardHeader>
							<CardContent>
								{permissionsLoading ? (
									<LoadingSpinner />
								) : corporationPermissions.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										{t('admin.organizations.corp.noPermissions')}
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
															{t('admin.organizations.corp.permissionAdded', {
																date: formatDateTime(perm.createdAt),
															})}
														</p>
													</div>
													<Button
														variant="destructive"
														size="sm"
														showIcon={false}
														onClick={() =>
															requestConfirmation({
																title: (t) => t('admin.organizations.shared.removePermission'),
																description: (t) => t('admin.organizations.corp.removePermission'),
																confirmLabel: (t) => t('common.remove'),
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
									<DialogTitle>{t('admin.organizations.corp.attachPermissionTitle')}</DialogTitle>
									<DialogDescription>
										{t('admin.organizations.corp.attachPermissionDescription')}
									</DialogDescription>
								</DialogHeader>
								<div className="space-y-4">
									<div>
										<Label htmlFor="permission">{t('admin.organizations.corp.permission')}</Label>
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
											placeholder={t('admin.organizations.corp.selectPermission')}
											className="mt-1.5 w-full"
										/>
									</div>
								</div>
								<DialogFooter>
									<Button variant="cancel" onClick={() => setShowAttachPermissionDialog(false)}>
										{t('common.cancel')}
									</Button>
									<Button
										variant="confirm"
										onClick={handleAttachPermission}
										disabled={!selectedPermissionId || attachPermission.isPending}
									>
										{t('admin.permissionAttachment.attach')}
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
