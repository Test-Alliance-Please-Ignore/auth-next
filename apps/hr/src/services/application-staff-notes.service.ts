import { and, desc, eq } from '@repo/db-utils'

import { applicationActivityLog, applicationStaffNotes } from '../db/schema'
import { touchApplicationStaffInteraction } from './application-interaction'

import type { ApplicationStaffNote } from '@repo/hr'
import type { ServiceContext } from './context'

export class ApplicationStaffNotesService {
	constructor(private ctx: ServiceContext) { }

	async listByApplication(applicationId: string): Promise<ApplicationStaffNote[]> {
		const rows = await this.ctx.db.query.applicationStaffNotes.findMany({
			where: eq(applicationStaffNotes.applicationId, applicationId),
			orderBy: [desc(applicationStaffNotes.createdAt)],
		})

		return rows.map((row) => this.mapToDto(row))
	}

	async create(
		applicationId: string,
		authorId: string,
		authorCharacterId: string | null,
		authorCharacterName: string | null,
		noteText: string
	): Promise<ApplicationStaffNote> {
		const now = new Date()
		const [created] = await this.ctx.db
			.insert(applicationStaffNotes)
			.values({
				applicationId,
				authorId,
				authorCharacterId,
				authorCharacterName,
				noteText,
				createdAt: now,
				updatedAt: now,
			})
			.returning()

		if (!created) {
			throw new Error('Failed to create application staff note')
		}

		await this.ctx.db.insert(applicationActivityLog).values({
			applicationId,
			userId: authorId,
			characterId: authorCharacterId ?? 'unknown',
			characterName: authorCharacterName ?? null,
			action: 'staff_note_added',
			metadata: { staffNoteId: created.id },
		})

		await touchApplicationStaffInteraction(this.ctx.db, applicationId, now)
		return this.mapToDto(created)
	}

	async update(
		noteId: string,
		noteText: string,
		actorId: string,
		actorCharacterId: string | null,
		actorCharacterName: string | null
	): Promise<ApplicationStaffNote> {
		const existing = await this.ctx.db.query.applicationStaffNotes.findFirst({
			where: eq(applicationStaffNotes.id, noteId),
		})
		if (!existing) {
			throw new Error('Application staff note not found')
		}

		const now = new Date()
		const [updated] = await this.ctx.db
			.update(applicationStaffNotes)
			.set({ noteText, updatedAt: now })
			.where(eq(applicationStaffNotes.id, noteId))
			.returning()

		if (!updated) {
			throw new Error('Failed to update application staff note')
		}

		await this.ctx.db.insert(applicationActivityLog).values({
			applicationId: existing.applicationId,
			userId: actorId,
			characterId: actorCharacterId ?? 'unknown',
			characterName: actorCharacterName ?? null,
			action: 'staff_note_updated',
			metadata: { staffNoteId: noteId },
		})

		await touchApplicationStaffInteraction(this.ctx.db, existing.applicationId, now)
		return this.mapToDto(updated)
	}

	async delete(
		noteId: string,
		actorId: string,
		actorCharacterId: string | null,
		actorCharacterName: string | null
	): Promise<void> {
		const existing = await this.ctx.db.query.applicationStaffNotes.findFirst({
			where: eq(applicationStaffNotes.id, noteId),
		})
		if (!existing) {
			throw new Error('Application staff note not found')
		}

		await this.ctx.db.delete(applicationStaffNotes).where(eq(applicationStaffNotes.id, noteId))

		const now = new Date()
		await this.ctx.db.insert(applicationActivityLog).values({
			applicationId: existing.applicationId,
			userId: actorId,
			characterId: actorCharacterId ?? 'unknown',
			characterName: actorCharacterName ?? null,
			action: 'staff_note_deleted',
			metadata: { staffNoteId: noteId },
		})
		await touchApplicationStaffInteraction(this.ctx.db, existing.applicationId, now)
	}

	async getById(noteId: string): Promise<ApplicationStaffNote | null> {
		const row = await this.ctx.db.query.applicationStaffNotes.findFirst({
			where: eq(applicationStaffNotes.id, noteId),
		})
		return row ? this.mapToDto(row) : null
	}

	async ensureNoteBelongsToApplication(noteId: string, applicationId: string): Promise<void> {
		const row = await this.ctx.db.query.applicationStaffNotes.findFirst({
			where: and(
				eq(applicationStaffNotes.id, noteId),
				eq(applicationStaffNotes.applicationId, applicationId)
			),
		})
		if (!row) {
			throw new Error('Application staff note not found')
		}
	}

	private mapToDto(row: typeof applicationStaffNotes.$inferSelect): ApplicationStaffNote {
		return {
			id: row.id,
			applicationId: row.applicationId,
			authorId: row.authorId,
			authorCharacterId: row.authorCharacterId,
			authorCharacterName: row.authorCharacterName,
			noteText: row.noteText,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}
	}
}
