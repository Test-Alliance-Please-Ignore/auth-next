import type { SharedHonoEnv } from '@repo/hono-helpers/src/types'

export interface AnalyticsContext extends SharedHonoEnv {
	ANALYTICS: AnalyticsEngineDataset
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
