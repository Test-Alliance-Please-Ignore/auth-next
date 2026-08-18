import type { SharedHonoEnv } from '@repo/hono-helpers/src/types'

/**
 * Structural shape of a Workers Analytics Engine binding.
 *
 * Declared locally rather than relying on the ambient `AnalyticsEngineDataset` global from
 * `worker-configuration.d.ts`: this module is consumed as raw TypeScript source by other
 * workspace packages, and ambient globals are scoped to the compilation that includes them --
 * they do not follow the import into a consumer's program.
 */
export interface AnalyticsEngineBinding {
	writeDataPoint(event?: {
		indexes?: ((ArrayBuffer | string) | null)[]
		doubles?: number[]
		blobs?: ((ArrayBuffer | string) | null)[]
	}): void
}

export interface AnalyticsContext extends SharedHonoEnv {
	ANALYTICS: AnalyticsEngineBinding
}

function sanitizeEventName(name: string): string {
	return name.toLowerCase().replace(/ /g, '-')
}

export function trackEvent(
	ctx: AnalyticsContext,
	event: { name: string; values?: string[] | undefined }
) {
	const analytics = ctx.ANALYTICS
	analytics.writeDataPoint({
		indexes: [ctx.NAME],
		blobs: [sanitizeEventName(event.name), ...(event.values ?? [])],
	})
}
