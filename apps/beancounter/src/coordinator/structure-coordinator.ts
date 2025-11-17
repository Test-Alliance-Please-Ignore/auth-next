import { getStub } from '@repo/do-utils'

import type { StructureMonitor } from '@repo/beancounter'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { StructureMonitorRepository } from './repository'

interface StructureCoordinatorDeps {
	repository: StructureMonitorRepository
	eveCorporationDataNamespace: DurableObjectNamespace
	structureMonitorNamespace: DurableObjectNamespace
	logger?: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>
}

/**
 * Coordinates structure discovery + monitoring orchestration.
 *
 * Business logic will be implemented in a future plan; for now we provide typed entry points.
 */
export class StructureCoordinator {
	private readonly logger: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>

	constructor(private readonly deps: StructureCoordinatorDeps) {
		this.logger = deps.logger ?? console
	}

	async scanCorporations(): Promise<void> {
		const corporations = await this.deps.repository.listTrackedCorporations()

		this.logger.info(`[StructureCoordinator] scanning ${corporations.length} corporation(s)`, {
			tags: { structureId: 'coordinator' },
		})

		for (const corporation of corporations) {
			await this.syncStructuresForCorp(corporation.corporationId)
		}
	}

	async syncStructuresForCorp(corporationId: string): Promise<void> {
		this.logger.info(`[StructureCoordinator] syncing structures`, {
			corporationId,
			tags: { structureId: 'coordinator' },
		})

		const corporationStub = getStub<EveCorporationData>(
			this.deps.eveCorporationDataNamespace,
			corporationId
		)

		// TODO: call EveCorporationData RPC once a structure export method exists.
		void corporationStub
	}

	async ensureMonitor(structureId: string): Promise<void> {
		this.logger.info(`[StructureCoordinator] ensuring monitor`, {
			structureId,
			tags: { structureId },
		})

		const monitorStub = getStub<StructureMonitor>(this.deps.structureMonitorNamespace, structureId)

		// TODO: invoke structure monitor RPCs when implemented.
		void monitorStub
	}
}
