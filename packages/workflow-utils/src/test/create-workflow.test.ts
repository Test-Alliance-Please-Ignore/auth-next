import { describe, expect, it, vi } from 'vitest'

import { createWorkflow, createWorkflowBatch, DEFAULT_WORKFLOW_RETENTION } from '../index'

import type { CreateWorkflowOptions } from '../index'

/**
 * Minimal stand-in for a Workflow binding that records the options it was called with.
 * miniflare's Workflow binding ignores `retention` entirely, so asserting against a real
 * binding would pass regardless of what this module does.
 */
function mockWorkflow<PARAMS = unknown>() {
	const create = vi.fn(async (options?: WorkflowInstanceCreateOptions<PARAMS>) => ({
		id: 'instance-1',
		options,
	}))
	const createBatch = vi.fn(async (batch: Array<WorkflowInstanceCreateOptions<PARAMS>>) =>
		batch.map((options, i) => ({ id: `instance-${i}`, options }))
	)
	return { create, createBatch } as unknown as Workflow<PARAMS> & {
		create: typeof create
		createBatch: typeof createBatch
	}
}

describe('createWorkflow', () => {
	it('applies the default retention policy', async () => {
		const workflow = mockWorkflow()

		await createWorkflow(workflow, { id: 'abc', params: { userId: '1' } })

		expect(workflow.create).toHaveBeenCalledWith({
			id: 'abc',
			params: { userId: '1' },
			retention: DEFAULT_WORKFLOW_RETENTION,
		})
	})

	it('applies retention when called with no options', async () => {
		const workflow = mockWorkflow()

		await createWorkflow(workflow)

		expect(workflow.create).toHaveBeenCalledWith({ retention: DEFAULT_WORKFLOW_RETENTION })
	})

	it('merges a partial override over the default, leaving the other field intact', async () => {
		const workflow = mockWorkflow()

		await createWorkflow(workflow, { retention: { successRetention: '6 hours' } })

		expect(workflow.create).toHaveBeenCalledWith({
			retention: {
				successRetention: '6 hours',
				errorRetention: DEFAULT_WORKFLOW_RETENTION.errorRetention,
			},
		})
	})

	it('falls back to the default when an override field is explicitly undefined', async () => {
		const workflow = mockWorkflow()

		// `strict` without `exactOptionalPropertyTypes` allows this; propagating the undefined
		// would silently revert retention to the 30-day account default.
		const options: CreateWorkflowOptions = { retention: { successRetention: undefined } }
		await createWorkflow(workflow, options)

		expect(workflow.create).toHaveBeenCalledWith({ retention: DEFAULT_WORKFLOW_RETENTION })
	})

	it('does not leak a `retention` key into params', async () => {
		const workflow = mockWorkflow<{ userId: string }>()

		await createWorkflow(workflow, { params: { userId: '1' } })

		const [options] = workflow.create.mock.calls[0]!
		expect(options?.params).toEqual({ userId: '1' })
	})
})

describe('createWorkflowBatch', () => {
	it('applies the default retention to every entry', async () => {
		const workflow = mockWorkflow<{ billId: string }>()

		await createWorkflowBatch(workflow, [
			{ id: 'a', params: { billId: '1' } },
			{ id: 'b', params: { billId: '2' } },
		])

		expect(workflow.createBatch).toHaveBeenCalledWith([
			{ id: 'a', params: { billId: '1' }, retention: DEFAULT_WORKFLOW_RETENTION },
			{ id: 'b', params: { billId: '2' }, retention: DEFAULT_WORKFLOW_RETENTION },
		])
	})

	it('honors a per-entry override without affecting siblings', async () => {
		const workflow = mockWorkflow()

		await createWorkflowBatch(workflow, [
			{ id: 'a', retention: { errorRetention: '30 days' } },
			{ id: 'b' },
		])

		expect(workflow.createBatch).toHaveBeenCalledWith([
			{
				id: 'a',
				retention: {
					successRetention: DEFAULT_WORKFLOW_RETENTION.successRetention,
					errorRetention: '30 days',
				},
			},
			{ id: 'b', retention: DEFAULT_WORKFLOW_RETENTION },
		])
	})

	it('passes an empty batch through without calling into a retention merge', async () => {
		const workflow = mockWorkflow()

		await createWorkflowBatch(workflow, [])

		expect(workflow.createBatch).toHaveBeenCalledWith([])
	})
})

describe('DEFAULT_WORKFLOW_RETENTION', () => {
	it('uses string durations, never bare numbers (which the platform reads as milliseconds)', () => {
		expect(typeof DEFAULT_WORKFLOW_RETENTION.successRetention).toBe('string')
		expect(typeof DEFAULT_WORKFLOW_RETENTION.errorRetention).toBe('string')
	})

	it('uses the shortest documented duration for both success and error retention', () => {
		expect(DEFAULT_WORKFLOW_RETENTION.successRetention).toBe('1 hour')
		expect(DEFAULT_WORKFLOW_RETENTION.errorRetention).toBe('3 days')
	})
})
