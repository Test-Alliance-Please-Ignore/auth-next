export const TIMERBOARD_CATEGORIES = [
	'structure',
	'sovereignty',
	'skyhook',
	'moon',
	'fleet',
	'custom',
] as const
export const TIMERBOARD_TYPES = [
	'reinforcement',
	'final',
	'anchoring',
	'unanchoring',
	'extraction',
	'custom',
] as const
export const TIMERBOARD_PRIORITIES = ['critical', 'high', 'normal', 'low'] as const
export const TIMERBOARD_HOSTILITIES = ['friendly', 'hostile', 'neutral', 'unknown'] as const
export const TIMERBOARD_STATES = ['planned', 'covered', 'completed', 'cancelled'] as const
export const TIMERBOARD_ACTIVITY_ACTIONS = [
	'created',
	'updated',
	'assigned',
	'state_changed',
	'cancelled',
] as const

export const TIMERBOARD_PERMISSION_URNS = {
	view: 'urn:timerboard:view',
	edit: 'urn:timerboard:edit',
	manage: 'urn:timerboard:manage',
} as const

export const TIMERBOARD_PERMISSION_DEFINITIONS = [
	{
		urn: TIMERBOARD_PERMISSION_URNS.view,
		name: 'View Timerboard',
		description: 'View the shared operational timerboard and its activity history',
	},
	{
		urn: TIMERBOARD_PERMISSION_URNS.edit,
		name: 'Edit Timerboard',
		description: 'Create timers and update, cover, or complete timers the user created',
	},
	{
		urn: TIMERBOARD_PERMISSION_URNS.manage,
		name: 'Manage Timerboard',
		description: 'Update, assign, complete, or cancel every operational timer',
	},
] as const

export type TimerCategory = (typeof TIMERBOARD_CATEGORIES)[number]
export type TimerType = (typeof TIMERBOARD_TYPES)[number]
export type TimerPriority = (typeof TIMERBOARD_PRIORITIES)[number]
export type TimerHostility = (typeof TIMERBOARD_HOSTILITIES)[number]
export type TimerState = (typeof TIMERBOARD_STATES)[number]

export type TimerboardDestinationRef = {
	adapterKey: string
	targetKey: string
	selectionMeta?: Record<string, unknown>
}

export type TimerboardDestinationCatalogItem = TimerboardDestinationRef & {
	label: string
	description: string | null
}

export type TimerboardDestinationSyncState =
	| 'pending'
	| 'syncing'
	| 'synced'
	| 'delete_pending'
	| 'failed'
	| 'dead_letter'
	| 'inactive'

export interface TimerboardEntryActions {
	canEdit: boolean
	canAssign: boolean
	canSetCovered: boolean
	canComplete: boolean
	canCancel: boolean
}

export interface TimerboardEntry {
	id: string
	category: TimerCategory
	timerType: TimerType
	title: string
	priority: TimerPriority
	hostility: TimerHostility
	startsAt: string
	state: TimerState
	systemId: string | null
	systemName: string | null
	regionId: string | null
	regionName: string | null
	planetId?: string | null
	planetName?: string | null
	moonId?: string | null
	moonName?: string | null
	corporationId: string | null
	corporationName: string | null
	corporationTicker?: string | null
	allianceId: string | null
	allianceName: string | null
	allianceTicker?: string | null
	structureVisibilityEnforced?: boolean
	visibilityGroupIds?: string[]
	sharingEnabled?: boolean
	shareDestinations?: TimerboardDestinationRef[]
	subjectId: string | null
	subjectType: string | null
	subjectName: string | null
	assignedUserId: string | null
	assignedCharacterId: string | null
	assignedCharacterName: string | null
	notes: string | null
	sourceKind: 'manual'
	sourceReference: string | null
	createdByUserId: string
	updatedByUserId: string
	version: number
	createdAt: string
	updatedAt: string
	isOverdue: boolean
	actions: TimerboardEntryActions
}

export interface TimerboardActivity {
	id: string
	entryId: string
	actorUserId: string
	actorCharacterName: string | null
	action: (typeof TIMERBOARD_ACTIVITY_ACTIONS)[number]
	payload: Record<string, unknown>
	createdAt: string
}

export interface TimerboardAssignmentCandidate {
	userId: string
	characterId: string
	characterName: string
	isPrimary: boolean
}

export interface TimerboardListQuery {
	state?: TimerState[]
	category?: TimerCategory
	timerTypes?: TimerType[]
	priorities?: TimerPriority[]
	hostilities?: TimerHostility[]
	subjectTypes?: string[]
	organizations?: string[]
	system?: string
	assignedToMe?: boolean
	from?: string
	to?: string
	page?: number
	pageSize?: number
}

export interface TimerboardListResponse {
	items: TimerboardEntry[]
	page: number
	pageSize: number
	total: number
}

export interface CreateTimerboardEntryInput {
	category: TimerCategory
	timerType: TimerType
	title: string
	priority: TimerPriority
	hostility: TimerHostility
	startsAt: string
	systemId: string | null
	systemName: string | null
	regionId: string | null
	regionName: string | null
	planetId?: string | null
	planetName?: string | null
	moonId?: string | null
	moonName?: string | null
	corporationId: string | null
	corporationName: string | null
	allianceId: string | null
	allianceName: string | null
	subjectId: string | null
	subjectType: string | null
	subjectName: string | null
	notes: string | null
	structureVisibilityEnforced?: boolean
	visibilityGroupIds?: string[]
	sharingEnabled?: boolean
	shareDestinations?: TimerboardDestinationRef[]
}

export type UpdateTimerboardEntryInput = Partial<CreateTimerboardEntryInput> & {
	expectedVersion: number
}

export interface TimerboardAssignmentInput {
	userId: string | null
	characterId: string | null
	characterName: string | null
	expectedVersion: number
}

export interface TimerboardConflictResponse {
	error: string
	current: TimerboardEntry
}

export interface TimerboardActor {
	userId: string
	isAdmin: boolean
	permissionUrns: readonly string[]
}

export interface TimerboardWorker {
	list(
		actor: TimerboardActor,
		query: {
			states?: TimerState[]
			category?: TimerCategory
			timerTypes?: TimerType[]
			priorities?: TimerPriority[]
			hostilities?: TimerHostility[]
			subjectTypes?: string[]
			organizations?: string[]
			system?: string
			assignedToMe?: boolean
			from?: string
			to?: string
			page: number
			pageSize: number
		}
	): Promise<TimerboardListResponse>
	get(actor: TimerboardActor, entryId: string): Promise<TimerboardEntry>
	create(actor: TimerboardActor, input: CreateTimerboardEntryInput): Promise<TimerboardEntry>
	update(
		actor: TimerboardActor,
		entryId: string,
		input: Partial<CreateTimerboardEntryInput>,
		expectedVersion: number
	): Promise<TimerboardEntry>
	setState(
		actor: TimerboardActor,
		entryId: string,
		state: TimerState,
		expectedVersion: number
	): Promise<TimerboardEntry>
	assign(
		actor: TimerboardActor,
		entryId: string,
		assignment: Omit<TimerboardAssignmentInput, 'expectedVersion'>,
		expectedVersion: number
	): Promise<TimerboardEntry>
	listActivity(actor: TimerboardActor, entryId: string): Promise<TimerboardActivity[]>
	searchAssignmentCandidates(
		actor: TimerboardActor,
		search: string,
		limit?: number
	): Promise<TimerboardAssignmentCandidate[]>
	listShareDestinations(actor: TimerboardActor): Promise<TimerboardDestinationCatalogItem[]>
	getTimerDestinationSync(
		actor: TimerboardActor,
		entryId: string
	): Promise<
		Array<{
			adapterKey: string
			targetKey: string
			state: TimerboardDestinationSyncState
			remoteId: string | null
			lastError: string | null
		}>
	>
}
