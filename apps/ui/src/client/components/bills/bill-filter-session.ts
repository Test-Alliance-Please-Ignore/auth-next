import type { BillStatus, EntityType } from '@repo/bills'

export type BillingFilterSessionState = {
	status?: BillStatus
	issuerId?: string
	issuerQuery: string
	payerType?: EntityType
	payerId?: string
	payerQuery: string
	payeeType?: EntityType
	payeeId?: string
	payeeQuery: string
	dueAfter: string
	dueBefore: string
	coalesced?: boolean
}

type BillingFilterScope = 'admin' | 'mine'

const STORAGE_KEYS: Record<BillingFilterScope, string> = {
	admin: 'billing-filters:admin',
	mine: 'billing-filters:mine',
}
const SESSION_VERSIONS: Record<BillingFilterScope, number> = {
	admin: 2,
	mine: 3,
}

const BILL_STATUSES: BillStatus[] = ['draft', 'issued', 'paid', 'cancelled', 'overdue']
const ENTITY_TYPES: EntityType[] = ['character', 'corporation', 'group']

export function getDefaultBillDueAfter(): string {
	const date = new Date()
	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, '0')
	const day = String(date.getDate()).padStart(2, '0')
	return `${year}-${month}-${day}`
}

function readString(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback
}

function readOptionalString(value: unknown, fallback?: string): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : fallback
}

function readEnum<T extends string>(
	value: unknown,
	values: readonly T[],
	fallback?: T
): T | undefined {
	return typeof value === 'string' && values.includes(value as T) ? (value as T) : fallback
}

export function readBillingFilterSession(
	scope: BillingFilterScope,
	defaults: BillingFilterSessionState
): BillingFilterSessionState {
	if (typeof window === 'undefined') return defaults

	try {
		const rawValue = window.sessionStorage.getItem(STORAGE_KEYS[scope])
		if (!rawValue) return defaults
		const saved = JSON.parse(rawValue) as Record<string, unknown>
		const isCurrentVersion = saved.version === SESSION_VERSIONS[scope]

		return {
			...defaults,
			status: readEnum(saved.status, BILL_STATUSES, defaults.status),
			issuerId: readOptionalString(saved.issuerId, defaults.issuerId),
			issuerQuery: readString(saved.issuerQuery, defaults.issuerQuery),
			payerType: readEnum(saved.payerType, ENTITY_TYPES, defaults.payerType),
			payerId: readOptionalString(saved.payerId, defaults.payerId),
			payerQuery: readString(saved.payerQuery, defaults.payerQuery),
			payeeType: readEnum(saved.payeeType, ENTITY_TYPES, defaults.payeeType),
			payeeId: readOptionalString(saved.payeeId, defaults.payeeId),
			payeeQuery: readString(saved.payeeQuery, defaults.payeeQuery),
			dueAfter: !isCurrentVersion
				? defaults.dueAfter
				: readString(saved.dueAfter, defaults.dueAfter),
			dueBefore: readString(saved.dueBefore, defaults.dueBefore),
			coalesced: typeof saved.coalesced === 'boolean' ? saved.coalesced : defaults.coalesced,
		}
	} catch {
		return defaults
	}
}

export function writeBillingFilterSession(
	scope: BillingFilterScope,
	state: BillingFilterSessionState
): void {
	if (typeof window === 'undefined') return

	try {
		window.sessionStorage.setItem(
			STORAGE_KEYS[scope],
			JSON.stringify({ ...state, version: SESSION_VERSIONS[scope] })
		)
	} catch {
		// Session storage is optional; the in-memory filters remain usable.
	}
}
