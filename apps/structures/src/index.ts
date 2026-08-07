import { WorkerEntrypoint } from 'cloudflare:workers'

import { createDb } from './db'
import {
	createAlertDestination,
	deleteAlertDestination,
	listAlertDestinations,
	updateAlertDestination,
} from './services/alert-destinations.service'
import {
	deleteStructureGroupAlertConfig,
	deleteStructureGroupSetting,
	getStructureDetail,
	getStructureModuleConfig,
	listMiningCitadelStructures,
	listMoonDrillStructures,
	listSkyhookStructures,
	listSovereigntyStructures,
	listStructureCorporationGroupDefaults,
	listStructureGroupAlertConfigs,
	listStructureGroupSettings,
	listStructures,
	syncCorporationStructures,
	updateStructureConfig,
	updateStructureModuleConfig,
	upsertStructureCorporationGroupDefault,
	upsertStructureGroupAlertConfig,
	upsertStructureGroupSetting,
} from './services/structures.service'

import type { AlertDestinationType } from '@repo/alert-destinations'
import type {
	CreateStructureAlertDestinationRequest,
	CreateStructureGroupAlertConfigRequest,
	StructureActor,
	StructureAlertDestination,
	StructureAlertDestinationRecord,
	StructureCorporationGroupDefault,
	StructureDetailResult,
	StructureGroupAlertConfig,
	StructureGroupSetting,
	StructureListQuery,
	StructureListResponse,
	StructureMiningCitadelListQuery,
	StructureMiningCitadelListResponse,
	StructureModuleConfig,
	StructureMoonDrillListQuery,
	StructureMoonDrillListResponse,
	StructureSkyhookListQuery,
	StructureSkyhookListResponse,
	StructureSovereigntyListQuery,
	StructureSovereigntyListResponse,
	StructuresWorker,
	UpdateStructureAlertDestinationRequest,
	UpdateStructureConfigInput,
	UpdateStructureGroupAlertConfigRequest,
	UpdateStructureModuleConfigInput,
	UpsertStructureCorporationDefaultInput,
	UpsertStructureGroupSettingInput,
} from '@repo/structures'
import type { Env } from './context'

export class StructuresWorkerEntrypoint extends WorkerEntrypoint<Env> implements StructuresWorker {
	constructor(ctx: ExecutionContext, env: Env) {
		super(ctx, env)
	}

	private getDb() {
		return createDb(this.env.DATABASE_URL)
	}

	async listStructures(
		actor: StructureActor,
		query: StructureListQuery = {}
	): Promise<StructureListResponse> {
		return listStructures(this.getDb(), actor, query)
	}

	async listSovereigntyStructures(
		actor: StructureActor,
		query: StructureSovereigntyListQuery = {}
	): Promise<StructureSovereigntyListResponse> {
		return listSovereigntyStructures(this.env, this.getDb(), actor, query)
	}

	async listSkyhookStructures(
		actor: StructureActor,
		query: StructureSkyhookListQuery = {}
	): Promise<StructureSkyhookListResponse> {
		return listSkyhookStructures(this.getDb(), actor, query)
	}

	async listMoonDrillStructures(
		actor: StructureActor,
		query: StructureMoonDrillListQuery = {}
	): Promise<StructureMoonDrillListResponse> {
		return listMoonDrillStructures(this.getDb(), actor, query)
	}

	async listMiningCitadelStructures(
		actor: StructureActor,
		query: StructureMiningCitadelListQuery = {}
	): Promise<StructureMiningCitadelListResponse> {
		return listMiningCitadelStructures(this.getDb(), actor, query)
	}

	async getStructureDetail(
		actor: StructureActor,
		structureId: string
	): Promise<StructureDetailResult | null> {
		return getStructureDetail(this.env, this.getDb(), actor, structureId)
	}

	async updateStructureConfig(
		actor: StructureActor,
		structureId: string,
		input: UpdateStructureConfigInput
	): Promise<StructureDetailResult | null> {
		return updateStructureConfig(this.env, this.getDb(), actor, structureId, input)
	}

	async getStructureModuleConfig(_actor: StructureActor): Promise<StructureModuleConfig> {
		return getStructureModuleConfig(this.getDb())
	}

	async updateStructureModuleConfig(
		actor: StructureActor,
		input: UpdateStructureModuleConfigInput
	): Promise<StructureModuleConfig> {
		return updateStructureModuleConfig(this.getDb(), {
			...input,
			updatedBy: actor.id,
		})
	}

	async syncCorporationStructures(
		corporationId: string,
		forceRefresh = false
	): Promise<{
		structureCount: number
		stateChangeCount: number
	}> {
		return syncCorporationStructures(this.env, this.getDb(), corporationId, forceRefresh)
	}

	async listStructureGroupSettings(_actor: StructureActor): Promise<StructureGroupSetting[]> {
		return listStructureGroupSettings(this.getDb())
	}

	async upsertStructureGroupSetting(
		actor: StructureActor,
		input: UpsertStructureGroupSettingInput
	): Promise<StructureGroupSetting> {
		return upsertStructureGroupSetting(this.getDb(), {
			...input,
			updatedBy: actor.id,
		})
	}

	async deleteStructureGroupSetting(
		_actor: StructureActor,
		groupId: string
	): Promise<StructureGroupSetting | null> {
		return deleteStructureGroupSetting(this.getDb(), { groupId })
	}

	async listStructureCorporationGroupDefaults(
		_actor: StructureActor
	): Promise<StructureCorporationGroupDefault[]> {
		return listStructureCorporationGroupDefaults(this.getDb())
	}

	async upsertStructureCorporationDefault(
		actor: StructureActor,
		input: UpsertStructureCorporationDefaultInput
	): Promise<StructureCorporationGroupDefault> {
		return upsertStructureCorporationGroupDefault(this.getDb(), {
			...input,
			updatedBy: actor.id,
		})
	}

	async listStructureGroupAlertDestinations(
		_actor: StructureActor,
		groupId: string
	): Promise<StructureAlertDestination[]> {
		return listAlertDestinations(this.getDb(), 'structure_group', groupId)
	}

	async createStructureAlertDestination(
		actor: StructureActor,
		groupId: string,
		input: CreateStructureAlertDestinationRequest
	): Promise<StructureAlertDestinationRecord> {
		return createAlertDestination(this.getDb(), {
			scopeType: 'structure_group',
			scopeId: groupId,
			alertType: input.alertType,
			destinationType: input.destinationType as AlertDestinationType,
			discordServerId: input.discordServerId ?? null,
			channelId: input.channelId ?? null,
			coreUserId: input.coreUserId ?? null,
			groupId: input.groupId ?? null,
			destinationConfig: input.destinationConfig ?? {},
			isEnabled: input.isEnabled ?? true,
			createdBy: actor.id,
			updatedBy: actor.id,
		})
	}

	async updateStructureAlertDestination(
		actor: StructureActor,
		groupId: string,
		destinationId: string,
		input: UpdateStructureAlertDestinationRequest
	): Promise<StructureAlertDestinationRecord> {
		return updateAlertDestination(this.getDb(), 'structure_group', groupId, destinationId, {
			alertType: input.alertType,
			destinationType: input.destinationType as AlertDestinationType,
			discordServerId: input.discordServerId ?? null,
			channelId: input.channelId ?? null,
			coreUserId: input.coreUserId ?? null,
			groupId: input.groupId ?? null,
			destinationConfig: input.destinationConfig,
			isEnabled: input.isEnabled,
			updatedBy: actor.id,
		})
	}

	async deleteStructureAlertDestination(
		_actor: StructureActor,
		groupId: string,
		destinationId: string
	): Promise<void> {
		return deleteAlertDestination(this.getDb(), 'structure_group', groupId, destinationId)
	}

	async listStructureGroupAlertConfigs(
		_actor: StructureActor,
		groupId: string
	): Promise<StructureGroupAlertConfig[]> {
		return listStructureGroupAlertConfigs(this.getDb(), groupId)
	}

	async createStructureGroupAlertConfig(
		actor: StructureActor,
		groupId: string,
		input: CreateStructureGroupAlertConfigRequest
	): Promise<StructureGroupAlertConfig> {
		return upsertStructureGroupAlertConfig(this.getDb(), {
			groupId,
			alertType: input.alertType,
			destinationIds: input.destinationIds,
			config: input.config ?? {},
			isEnabled: input.isEnabled ?? true,
		})
	}

	async updateStructureGroupAlertConfig(
		actor: StructureActor,
		groupId: string,
		configId: string,
		input: UpdateStructureGroupAlertConfigRequest
	): Promise<StructureGroupAlertConfig> {
		return upsertStructureGroupAlertConfig(this.getDb(), {
			id: configId,
			groupId,
			alertType: input.alertType ?? 'structure_state_changed',
			destinationIds: input.destinationIds ?? [],
			config: input.config ?? {},
			isEnabled: input.isEnabled ?? true,
		})
	}

	async deleteStructureGroupAlertConfig(
		_actor: StructureActor,
		groupId: string,
		configId: string
	): Promise<void> {
		return deleteStructureGroupAlertConfig(this.getDb(), groupId, configId)
	}

	override async fetch(): Promise<Response> {
		return new Response('Structures Worker - RPC only, not accessible via HTTP', {
			status: 404,
			headers: { 'Content-Type': 'text/plain' },
		})
	}
}

export default StructuresWorkerEntrypoint
