import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RecentLossRefreshCoordinatorDO } from '../../recent-loss-refresh-coordinator'

vi.mock('cloudflare:workers', () => ({
	DurableObject: class {},
}))
vi.mock('@repo/workflow-utils', () => ({
	createWorkflow: vi.fn(),
}))

const USER_ID = 'user-1'
const WORKFLOW_ID = 'workflow-1'
const STATUS_KEY = `recent-loss-refresh-status:${USER_ID}`

interface StoredValueMap {
	get: ReturnType<typeof vi.fn>
	put: ReturnType<typeof vi.fn>
	delete: ReturnType<typeof vi.fn>
	list: ReturnType<typeof vi.fn>
	setAlarm: ReturnType<typeof vi.fn>
	deleteAlarm: ReturnType<typeof vi.fn>
	values: Map<string, unknown>
}

function createStorage(initialStatus: Record<string, unknown>): StoredValueMap {
	const values = new Map<string, unknown>([[STATUS_KEY, initialStatus]])
	const storage: StoredValueMap = {
		get: vi.fn(async (key: string) => values.get(key)),
		put: vi.fn(async (key: string, value: unknown) => {
			values.set(key, value)
		}),
		delete: vi.fn(async (key: string | string[]) => {
			for (const storageKey of Array.isArray(key) ? key : [key]) values.delete(storageKey)
		}),
		list: vi.fn(async ({ prefix }: { prefix: string }) => {
			return new Map([...values.entries()].filter(([key]) => key.startsWith(prefix)))
		}),
		setAlarm: vi.fn(),
		deleteAlarm: vi.fn(),
		values,
	}
	return storage
}

function createStatus(overrides: Record<string, unknown> = {}) {
	return {
		userId: USER_ID,
		workflowInstanceId: WORKFLOW_ID,
		status: 'running',
		totalCharacters: 1,
		processedCharacters: 0,
		successfulCharacters: 0,
		failedCharacters: 0,
		queuedAt: '2026-08-04T00:00:00.000Z',
		updatedAt: '2026-08-04T00:00:00.000Z',
		failures: [],
		maxLossAgeDays: 30,
		...overrides,
	}
}

function createCoordinator(
	status: Record<string, unknown>,
	workflowStatus: { status: string } | Error
): { coordinator: RecentLossRefreshCoordinatorDO; storage: StoredValueMap } {
	const storage = createStorage(status)
	const workflow = {
		get: vi.fn(async () => {
			if (workflowStatus instanceof Error) throw workflowStatus
			return { status: vi.fn(async () => workflowStatus) }
		}),
	}
	const coordinator = Object.create(
		RecentLossRefreshCoordinatorDO.prototype
	) as RecentLossRefreshCoordinatorDO
	Object.assign(coordinator, {
		ctx: { storage },
		env: { SRP_RECENT_LOSS_REFRESH_WORKFLOW: workflow },
	})
	return { coordinator, storage }
}

describe('RecentLossRefreshCoordinatorDO workflow reconciliation', () => {
	beforeEach(() => {
		vi.useRealTimers()
	})

	it('marks a persisted active status completed when the workflow has completed', async () => {
		const { coordinator, storage } = createCoordinator(createStatus(), { status: 'complete' })

		const result = await coordinator.getRecentLossRefreshStatus(USER_ID)

		expect(result.status?.status).toBe('completed')
		expect(result.status?.completedAt).toEqual(expect.any(String))
		expect(storage.put).toHaveBeenCalledWith(
			STATUS_KEY,
			expect.objectContaining({ status: 'completed' })
		)
	})

	it('keeps the active status when the workflow is still running', async () => {
		const { coordinator, storage } = createCoordinator(createStatus(), { status: 'running' })

		const result = await coordinator.getRecentLossRefreshStatus(USER_ID)

		expect(result.status?.status).toBe('running')
		expect(storage.put).not.toHaveBeenCalled()
	})

	it('marks the status failed when the workflow has terminated', async () => {
		const { coordinator, storage } = createCoordinator(createStatus(), { status: 'terminated' })

		const result = await coordinator.getRecentLossRefreshStatus(USER_ID)

		expect(result.status?.status).toBe('failed')
		expect(result.status?.lastError).toContain('terminated')
		expect(storage.put).toHaveBeenCalledWith(
			STATUS_KEY,
			expect.objectContaining({ status: 'failed' })
		)
	})

	it('clears an active status after the fallback timeout when the workflow cannot be inspected', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-08-04T02:00:00.000Z'))
		const { coordinator, storage } = createCoordinator(
			createStatus({
				queuedAt: '2026-08-04T00:00:00.000Z',
				updatedAt: '2026-08-04T00:30:00.000Z',
			}),
			new Error('workflow lookup unavailable')
		)

		const result = await coordinator.getRecentLossRefreshStatus(USER_ID)

		expect(result.status?.status).toBe('failed')
		expect(result.status?.lastError).toContain('fallback timeout')
		expect(storage.values.has(STATUS_KEY)).toBe(false)
		expect(storage.delete).toHaveBeenCalledWith(STATUS_KEY)
	})

	it('evicts dormant terminal status during the coordinator alarm', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-08-04T02:00:00.000Z'))
		const { coordinator, storage } = createCoordinator(
			createStatus({
				status: 'completed',
				completedAt: '2026-08-04T00:00:00.000Z',
			}),
			{ status: 'complete' }
		)

		await coordinator.alarm()

		expect(storage.values.has(STATUS_KEY)).toBe(false)
		expect(storage.deleteAlarm).toHaveBeenCalled()
	})
})
