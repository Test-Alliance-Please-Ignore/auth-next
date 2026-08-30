export const TIMERBOARD_KINDS = [
	'structure',
	'sovereignty',
	'skyhook',
	'moon',
	'fleet',
	'custom',
] as const
export const TIMERBOARD_PRIORITIES = ['critical', 'high', 'normal', 'low'] as const
export const TIMERBOARD_SIDES = ['friendly', 'hostile', 'neutral', 'unknown'] as const
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

export type TimerKind = (typeof TIMERBOARD_KINDS)[number]
export type TimerPriority = (typeof TIMERBOARD_PRIORITIES)[number]
export type TimerSide = (typeof TIMERBOARD_SIDES)[number]
export type TimerState = (typeof TIMERBOARD_STATES)[number]

export interface TimerboardEntryActions {
	canEdit: boolean
	canAssign: boolean
	canSetCovered: boolean
	canComplete: boolean
	canCancel: boolean
}

export interface TimerboardEntry {
	id: string
	kind: TimerKind
	title: string
	priority: TimerPriority
	side: TimerSide
	startsAt: string
	endsAt: string | null
	state: TimerState
	systemId: string | null
	systemName: string | null
	entityId: string | null
	entityType: string | null
	entityName: string | null
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
	kind?: TimerKind
	priority?: TimerPriority
	side?: TimerSide
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
	kind: TimerKind
	title: string
	priority: TimerPriority
	side: TimerSide
	startsAt: string
	endsAt: string | null
	systemId: string | null
	systemName: string | null
	entityId: string | null
	entityType: string | null
	entityName: string | null
	notes: string | null
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
