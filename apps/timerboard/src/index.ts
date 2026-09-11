import { WorkerEntrypoint } from 'cloudflare:workers'

import { getStub, withRpcResult } from '@repo/do-utils'

import { createDb } from './db'
import { TimerboardService } from './services/timerboard.service'

import type { TimerboardWorker } from '@repo/core'
import type { Groups } from '@repo/groups'
import type { Env } from './context'

export class TimerboardWorkerEntrypoint extends WorkerEntrypoint<Env> implements TimerboardWorker {
	private getService(): TimerboardService {
		const groups = getStub<Groups>(this.env.GROUPS, 'default')
		return new TimerboardService(createDb(this.env.DATABASE_URL), this.env, {
			getUserGroupIds: async (userId) =>
				withRpcResult(groups.getUserMemberships(userId), (memberships) =>
					memberships.map((membership) => membership.groupId)
				),
			resolveStructureVisibility: async (userId, structureIds) =>
				this.env.STRUCTURES.resolveStructureVisibility(userId, structureIds),
		})
	}

	list(
		actor: Parameters<TimerboardWorker['list']>[0],
		query: Parameters<TimerboardWorker['list']>[1]
	) {
		return this.getService().list(actor, query)
	}
	get(actor: Parameters<TimerboardWorker['get']>[0], entryId: string) {
		return this.getService().get(actor, entryId)
	}
	create(
		actor: Parameters<TimerboardWorker['create']>[0],
		input: Parameters<TimerboardWorker['create']>[1]
	) {
		return this.getService().create(actor, input)
	}
	update(
		actor: Parameters<TimerboardWorker['update']>[0],
		entryId: string,
		input: Parameters<TimerboardWorker['update']>[2],
		expectedVersion: number
	) {
		return this.getService().update(actor, entryId, input, expectedVersion)
	}
	setState(
		actor: Parameters<TimerboardWorker['setState']>[0],
		entryId: string,
		state: Parameters<TimerboardWorker['setState']>[2],
		expectedVersion: number
	) {
		return this.getService().setState(actor, entryId, state, expectedVersion)
	}
	assign(
		actor: Parameters<TimerboardWorker['assign']>[0],
		entryId: string,
		assignment: Parameters<TimerboardWorker['assign']>[2],
		expectedVersion: number
	) {
		return this.getService().assign(actor, entryId, assignment, expectedVersion)
	}
	listActivity(actor: Parameters<TimerboardWorker['listActivity']>[0], entryId: string) {
		return this.getService().listActivity(actor, entryId)
	}
	searchAssignmentCandidates(
		actor: Parameters<TimerboardWorker['searchAssignmentCandidates']>[0],
		search: string,
		limit?: number
	) {
		return this.getService().searchAssignmentCandidates(actor, search, limit)
	}
	listShareDestinations(actor: Parameters<TimerboardWorker['listShareDestinations']>[0]) {
		return this.getService().listShareDestinations(actor)
	}
	getTimerDestinationSync(
		actor: Parameters<TimerboardWorker['getTimerDestinationSync']>[0],
		entryId: string
	) {
		return this.getService().getTimerDestinationSync(actor, entryId)
	}
}

export default TimerboardWorkerEntrypoint
