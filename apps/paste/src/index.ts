import { WorkerEntrypoint } from 'cloudflare:workers'

import { logger } from '@repo/hono-helpers'

import { PasteService } from './services/paste.service'

import type {
	CreatePasteInput,
	DecryptPasteInput,
	DeletePasteInput,
	ListAdminPastesInput,
	ListCreatorPastesInput,
	PasteWorker as IPasteWorker,
	PublicDecryptThrottleInput,
	RotatePasswordInput,
	UpdatePasteInput,
	UpdatePasteSettingsInput,
} from '@repo/paste'
import type { Env } from './context'

export class PasteWorkerEntrypoint extends WorkerEntrypoint<Env> implements IPasteWorker {
	private getService(): PasteService {
		return PasteService.fromEnv(this.env.DATABASE_URL, this.env.PASTE_BUCKET, this.env.PASTE_THROTTLE)
	}

	async createPaste(input: CreatePasteInput) {
		return this.getService().createPaste(input)
	}

	async getPasteForAllianceViewer(pasteId: string) {
		return this.getService().getPasteForAllianceViewer(pasteId)
	}

	async getPasteForPublicViewer(pasteId: string) {
		return this.getService().getPasteForPublicViewer(pasteId)
	}

	async decryptPaste(input: DecryptPasteInput) {
		return this.getService().decryptPaste(input)
	}

	async canAttemptPublicDecrypt(input: PublicDecryptThrottleInput) {
		return this.getService().canAttemptPublicDecrypt(input)
	}

	async listCreatorPastes(input: ListCreatorPastesInput) {
		return this.getService().listCreatorPastes(input)
	}

	async listAdminPastes(input: ListAdminPastesInput) {
		return this.getService().listAdminPastes(input)
	}

	async updatePaste(input: UpdatePasteInput) {
		return this.getService().updatePaste(input)
	}

	async rotatePastePassword(input: RotatePasswordInput) {
		return this.getService().rotatePastePassword(input)
	}

	async deletePaste(input: DeletePasteInput) {
		return this.getService().deletePaste(input)
	}

	async getPasteSettings() {
		return this.getService().getPasteSettings()
	}

	async updatePasteSettings(input: UpdatePasteSettingsInput) {
		return this.getService().updatePasteSettings(input)
	}

	async runExpirySweep(nowIso?: string) {
		return this.getService().runExpirySweep(nowIso)
	}

	override async fetch(_request: Request): Promise<Response> {
		return new Response('Paste Worker - RPC only, not accessible via HTTP', {
			status: 404,
			headers: { 'Content-Type': 'text/plain' },
		})
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const worker = new PasteWorkerEntrypoint(ctx, env)
		return worker.fetch(request)
	},
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		const worker = new PasteWorkerEntrypoint(ctx, env)
		const result = await worker.runExpirySweep(new Date(event.scheduledTime).toISOString())
		logger.info('[Paste] expiry sweep completed', {
			cron: event.cron,
			scanned: result.scanned,
			purged: result.purged,
			failed: result.failed,
		})
	},
}
