import { MAX_PERSONAL_BROADCAST_TEMPLATES } from '@repo/broadcasts'
import { and, eq, sql } from '@repo/db-utils'

import { schema } from '../db'

import type { PersonalBroadcastTemplate, PersonalBroadcastTemplateInput } from '@repo/broadcasts'
import type { createDb } from '../db'

const { userPreferences } = schema
const savedTemplates = sql`coalesce(${userPreferences.preferences}->'broadcastTemplates', '[]'::jsonb)`

/** Owner-scoped presets live alongside the user's other settings. */
export class PersonalBroadcastTemplatesService {
	constructor(private db: ReturnType<typeof createDb>) {}

	async list(userId: string): Promise<PersonalBroadcastTemplate[]> {
		const row = await this.db.query.userPreferences.findFirst({
			where: eq(userPreferences.userId, userId),
		})
		return (row?.preferences.broadcastTemplates as PersonalBroadcastTemplate[] | undefined) ?? []
	}

	async create(
		userId: string,
		input: PersonalBroadcastTemplateInput
	): Promise<PersonalBroadcastTemplate | null> {
		const template = { ...input, id: crypto.randomUUID() }
		// The conditional upsert locks the user's row, so concurrent saves cannot
		// exceed six or overwrite each other (including the very first save).
		const rows = await this.db
			.insert(userPreferences)
			.values({
				userId,
				preferences: { broadcastTemplates: [template] },
			})
			.onConflictDoUpdate({
				target: userPreferences.userId,
				set: {
					preferences: sql`jsonb_set(${userPreferences.preferences}, '{broadcastTemplates}', ${savedTemplates} || ${JSON.stringify([template])}::jsonb)`,
					updatedAt: new Date(),
				},
				setWhere: sql`jsonb_array_length(${savedTemplates}) < ${MAX_PERSONAL_BROADCAST_TEMPLATES}`,
			})
			.returning({ userId: userPreferences.userId })
		return rows.length > 0 ? template : null
	}

	async update(
		userId: string,
		id: string,
		input: PersonalBroadcastTemplateInput
	): Promise<PersonalBroadcastTemplate | null> {
		const template = { ...input, id }
		const rows = await this.db
			.update(userPreferences)
			.set({
				preferences: sql`jsonb_set(${userPreferences.preferences}, '{broadcastTemplates}', (
				select jsonb_agg(case when item->>'id' = ${id} then ${JSON.stringify(template)}::jsonb else item end order by position)
				from jsonb_array_elements(${savedTemplates}) with ordinality as entries(item, position)
			))`,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(userPreferences.userId, userId),
					sql`${savedTemplates} @> ${JSON.stringify([{ id }])}::jsonb`
				)
			)
			.returning({ userId: userPreferences.userId })
		return rows.length > 0 ? template : null
	}

	async delete(userId: string, id: string): Promise<boolean> {
		const rows = await this.db
			.update(userPreferences)
			.set({
				preferences: sql`jsonb_set(${userPreferences.preferences}, '{broadcastTemplates}', (
				select coalesce(jsonb_agg(item order by position), '[]'::jsonb)
				from jsonb_array_elements(${savedTemplates}) with ordinality as entries(item, position)
				where item->>'id' <> ${id}
			))`,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(userPreferences.userId, userId),
					sql`${savedTemplates} @> ${JSON.stringify([{ id }])}::jsonb`
				)
			)
			.returning({ userId: userPreferences.userId })
		return rows.length > 0
	}
}
