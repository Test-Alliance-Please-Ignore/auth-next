import { DurableObject } from 'cloudflare:workers'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../common/db'
import { StructureMonitorRepository } from './repository'

import type {
	ClientWebSocketMessage,
	ServerWebSocketMessage,
	StructureCoordinator,
	StructureInventoryUpdate,
	StructureMonitor,
	StructureStatusUpdate,
} from '@repo/beancounter'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Env } from '../context'

/**
 * Coordinates structure discovery + monitoring orchestration.
 *
 * This Durable Object manages structure monitoring and broadcasts real-time updates
 * to connected WebSocket clients.
 */
export class StructureCoordinatorDO extends DurableObject<Env> implements StructureCoordinator {
	private readonly logger: typeof logger
	private readonly repository: StructureMonitorRepository

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)

		this.logger = logger
		this.logger.setTags({ service: 'beancounter-structure-coordinator' })

		const db = createDb(env.DATABASE_URL)
		this.repository = new StructureMonitorRepository(db)
	}

	/**
	 * Broadcast inventory update to all connected WebSocket clients.
	 */
	async notifyInventoryUpdate(
		structureId: string,
		update: StructureInventoryUpdate
	): Promise<void> {
		const connections = this.ctx.getWebSockets()
		if (connections.length === 0) {
			return
		}

		const message: ServerWebSocketMessage = {
			type: 'inventory_update',
			structureId,
			data: update,
			timestamp: new Date().toISOString(),
		}

		const messageStr = JSON.stringify(message)

		for (const ws of connections) {
			try {
				ws.send(messageStr)
			} catch (error) {
				this.logger.error('[StructureCoordinator] Failed to send inventory update', {
					structureId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		this.logger.info('[StructureCoordinator] Broadcasted inventory update', {
			structureId,
			clientCount: connections.length,
		})
	}

	/**
	 * Broadcast status update to all connected WebSocket clients.
	 */
	async notifyStatusUpdate(structureId: string, update: StructureStatusUpdate): Promise<void> {
		const connections = this.ctx.getWebSockets()
		if (connections.length === 0) {
			return
		}

		// Enhance update with structure name and location name from database if not already present
		let enhancedUpdate = { ...update }
		if (!enhancedUpdate.structureName || !enhancedUpdate.locationName) {
			try {
				const structures = await this.repository.listMonitoredStructures()
				const structure = structures.find((s) => s.structureId === structureId)
				if (structure) {
					if (!enhancedUpdate.structureName) {
						enhancedUpdate.structureName = structure.name ?? null
					}
					if (!enhancedUpdate.locationName && structure.solarSystemId) {
						try {
							const tokenStore = await getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
							const resolvedNames = await tokenStore.resolveIds([structure.solarSystemId])
							enhancedUpdate.locationName = resolvedNames[structure.solarSystemId] ?? null
						} catch (error) {
							this.logger.error(
								'[StructureCoordinator] Failed to resolve location name for status update',
								{
									structureId,
									solarSystemId: structure.solarSystemId,
									error: error instanceof Error ? error.message : String(error),
								}
							)
						}
					}
				}
			} catch (error) {
				this.logger.error(
					'[StructureCoordinator] Failed to enhance status update with structure info',
					{
						structureId,
						error: error instanceof Error ? error.message : String(error),
					}
				)
			}
		}

		const message: ServerWebSocketMessage = {
			type: 'status_update',
			structureId,
			data: enhancedUpdate,
			timestamp: new Date().toISOString(),
		}

		const messageStr = JSON.stringify(message)

		for (const ws of connections) {
			try {
				ws.send(messageStr)
			} catch (error) {
				this.logger.error('[StructureCoordinator] Failed to send status update', {
					structureId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		this.logger.info('[StructureCoordinator] Broadcasted status update', {
			structureId,
			clientCount: connections.length,
		})
	}

	async scanCorporations(): Promise<void> {
		const corporations = await this.repository.listTrackedCorporations()

		this.logger.info(`[StructureCoordinator] scanning ${corporations.length} corporation(s)`)

		for (const corporation of corporations) {
			await this.syncStructuresForCorp(corporation.corporationId)
		}
	}

	async syncStructuresForCorp(corporationId: string): Promise<void> {
		this.logger.withTags({ corporationId }).info(`[StructureCoordinator] syncing structures`)

		const corporationStub = getStub<EveCorporationData>(
			this.env.EVE_CORPORATION_DATA,
			corporationId
		)
		const structures = await corporationStub.getStructures(corporationId)
		this.logger
			.withTags({ corporationId })
			.info(`[StructureCoordinator] found ${structures.length} structure(s)`)

		for (const structure of structures) {
			await this.ensureMonitor(corporationId, structure.structureId)
			break
		}
	}

	async ensureMonitor(corporationId: string, structureId: string): Promise<void> {
		this.logger.withTags({ structureId }).info(`[StructureCoordinator] ensuring monitor`)

		const monitorStub = getStub<StructureMonitor>(this.env.STRUCTURE_MONITOR, structureId)
		const instance = await monitorStub.initialize(corporationId, structureId)
		if (!instance) {
			this.logger.error(`[StructureCoordinator] failed to initialize monitor`)
			return
		}
		await monitorStub.refreshStructureInventory()
	}

	/**
	 * Send initial status of all monitored structures to a WebSocket client.
	 */
	private async sendInitialStatus(ws: WebSocket): Promise<void> {
		try {
			const structures = await this.repository.listMonitoredStructures()
			this.logger.info('[StructureCoordinator] Sending initial status', {
				structureCount: structures.length,
			})

			// Resolve location names (solar system names) using EveTokenStore
			const systemIds = structures
				.map((s) => s.solarSystemId)
				.filter((id): id is string => id !== null && id !== undefined)
			const locationNames: Record<string, string | null> = {}

			if (systemIds.length > 0) {
				try {
					const tokenStore = await getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
					const resolvedNames = await tokenStore.resolveIds(systemIds)
					// Map resolved names to locationNames
					for (const systemId of systemIds) {
						locationNames[systemId] = resolvedNames[systemId] ?? null
					}
				} catch (error) {
					this.logger.error('[StructureCoordinator] Failed to resolve location names', {
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}

			const statusPromises = structures.map(async (structure) => {
				try {
					const monitorStub = getStub<StructureMonitor>(
						this.env.STRUCTURE_MONITOR,
						structure.structureId
					)
					const status = await monitorStub.getLatestStatus(structure.structureId)

					return {
						structureId: structure.structureId,
						status: status
							? {
									lastSnapshotAt: status.lastSnapshotAt,
									fuelExpiresAt: status.fuelExpiresAt,
									services: status.services ?? null,
									structureName: structure.name ?? null,
									locationName: structure.solarSystemId
										? (locationNames[structure.solarSystemId] ?? null)
										: null,
								}
							: {
									lastSnapshotAt: null,
									fuelExpiresAt: null,
									services: null,
									structureName: structure.name ?? null,
									locationName: structure.solarSystemId
										? (locationNames[structure.solarSystemId] ?? null)
										: null,
								},
					}
				} catch (error) {
					this.logger.error('[StructureCoordinator] Failed to get status for structure', {
						structureId: structure.structureId,
						error: error instanceof Error ? error.message : String(error),
					})
					return {
						structureId: structure.structureId,
						status: {
							lastSnapshotAt: null,
							fuelExpiresAt: null,
							services: null,
							structureName: structure.name ?? null,
							locationName: structure.solarSystemId
								? (locationNames[structure.solarSystemId] ?? null)
								: null,
						},
					}
				}
			})

			const statuses = await Promise.all(statusPromises)

			const message: ServerWebSocketMessage = {
				type: 'initial_status',
				structures: statuses,
				timestamp: new Date().toISOString(),
			}

			ws.send(JSON.stringify(message))
			this.logger.info('[StructureCoordinator] Sent initial status', {
				structureCount: statuses.length,
			})
		} catch (error) {
			this.logger.error('[StructureCoordinator] Failed to send initial status', {
				error: error instanceof Error ? error.message : String(error),
			})
			ws.send(
				JSON.stringify({
					type: 'error',
					payload: 'Failed to retrieve initial status',
				})
			)
		}
	}

	/**
	 * WebSocket message handler (Hibernation API)
	 * Called when a WebSocket message is received
	 */
	async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
		try {
			const data =
				typeof message === 'string'
					? JSON.parse(message)
					: JSON.parse(new TextDecoder().decode(message))

			this.logger.info('[StructureCoordinator] WebSocket message received', {
				messageType: data.type,
			})

			const clientMessage = data as ClientWebSocketMessage

			switch (clientMessage.type) {
				case 'ping':
					ws.send(JSON.stringify({ type: 'pong', payload: Date.now() }))
					break

				case 'subscribe':
					// Send initial status of all monitored structures
					await this.sendInitialStatus(ws)
					// Confirm subscription
					ws.send(JSON.stringify({ type: 'subscribed' }))
					break

				default:
					ws.send(JSON.stringify({ type: 'error', payload: 'Unknown message type' }))
			}
		} catch (error) {
			this.logger.error('[StructureCoordinator] Error processing WebSocket message', {
				error: error instanceof Error ? error.message : String(error),
			})
			ws.send(JSON.stringify({ type: 'error', payload: 'Invalid message format' }))
		}
	}

	/**
	 * WebSocket close handler (Hibernation API)
	 * Called when a WebSocket connection is closed
	 */
	async webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
		wasClean: boolean
	): Promise<void> {
		this.logger.info('[StructureCoordinator] WebSocket closed', {
			code,
			reason,
			wasClean,
		})
	}

	/**
	 * WebSocket error handler (Hibernation API)
	 * Called when a WebSocket error occurs
	 */
	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		this.logger.error('[StructureCoordinator] WebSocket error', {
			error: error instanceof Error ? error.message : String(error),
		})
	}

	/**
	 * Fetch handler for HTTP requests to the Durable Object
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)

		// WebSocket upgrade handling
		const upgradeHeader = request.headers.get('Upgrade')
		this.logger.info('[StructureCoordinator] Fetch request', {
			method: request.method,
			url: url.pathname,
			upgrade: upgradeHeader,
			connection: request.headers.get('Connection'),
		})

		if (upgradeHeader === 'websocket') {
			try {
				const pair = new WebSocketPair()
				const [client, server] = Object.values(pair)

				// Accept the WebSocket connection using hibernation API
				this.ctx.acceptWebSocket(server)

				this.logger.info('[StructureCoordinator] WebSocket connection accepted')

				return new Response(null, {
					status: 101,
					webSocket: client,
				})
			} catch (error) {
				this.logger.error('[StructureCoordinator] Failed to accept WebSocket', {
					error: error instanceof Error ? error.message : String(error),
				})
				return new Response('WebSocket upgrade failed', { status: 500 })
			}
		}

		return new Response('Structure Coordinator Durable Object', { status: 200 })
	}

	/**
	 * Scheduled handler - called from worker's scheduled event
	 */
	static async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
		const coordinatorStub = getStub<StructureCoordinator>(env.STRUCTURE_COORDINATOR, 'default')
		await coordinatorStub.scanCorporations()
	}
}
