import { eq } from '@repo/db-utils'

import { applications } from '../db/schema'

import type { DbClient } from '@repo/db-utils'
import type * as schema from '../db/schema'

export async function touchApplicationStaffInteraction(
	db: DbClient<typeof schema>,
	applicationId: string,
	at = new Date()
): Promise<void> {
	await db
		.update(applications)
		.set({
			lastStaffInteractionAt: at,
			updatedAt: at,
		})
		.where(eq(applications.id, applicationId))
}
