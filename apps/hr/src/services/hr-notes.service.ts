import { and, desc, eq, inArray } from '@repo/db-utils'

import { hrNotes } from '../db/schema'

import type { HrNote, HrNoteType, HrNotePriority, NoteFilters } from '@repo/hr'
import type { DbClient } from '@repo/db-utils'
import type * as schema from '../db/schema'

/**
 * HR Notes Service
 *
 * STRICTLY ADMIN-ONLY: All operations require admin privileges.
 * Manages private notes about users for HR/admin purposes.
 */
export class HrNotesService {
	constructor(private db: DbClient<typeof schema>) {}

	/**
	 * Create an HR note about a user (admin only)
	 */
	async createNote(
		subjectUserId: string,
		subjectCharacterId: string | null,
		authorId: string,
		authorCharacterId: string | null,
		authorCharacterName: string | null,
		noteText: string,
		noteType: HrNoteType,
		priority: HrNotePriority,
		metadata?: Record<string, unknown>
	): Promise<HrNote> {
		const [note] = await this.db
			.insert(hrNotes)
			.values({
				subjectUserId,
				subjectCharacterId,
				authorId,
				authorCharacterId,
				authorCharacterName,
				noteText,
				noteType,
				priority,
				metadata,
			})
			.returning()

		if (!note) {
			throw new Error('Failed to create HR note')
		}

		return this.mapToHrNote(note)
	}

	/**
	 * List HR notes with optional filters (admin only)
	 */
	async listNotes(filters: NoteFilters): Promise<HrNote[]> {
		const conditions: ReturnType<typeof and>[] = []

		// Apply filters
		if (filters.subjectUserId) {
			conditions.push(eq(hrNotes.subjectUserId, filters.subjectUserId))
		}

		if (filters.noteType) {
			conditions.push(eq(hrNotes.noteType, filters.noteType))
		}

		if (filters.priority) {
			conditions.push(eq(hrNotes.priority, filters.priority))
		}

		// Build query
		const results = await this.db.query.hrNotes.findMany({
			where: conditions.length > 0 ? and(...conditions) : undefined,
			orderBy: [desc(hrNotes.createdAt)],
			limit: filters.limit || 50,
			offset: filters.offset || 0,
		})

		return results.map((note) => this.mapToHrNote(note))
	}

	/**
	 * Get all HR notes for a specific user (admin only)
	 */
	async getUserNotes(subjectUserId: string): Promise<HrNote[]> {
		const results = await this.db.query.hrNotes.findMany({
			where: eq(hrNotes.subjectUserId, subjectUserId),
			orderBy: [desc(hrNotes.createdAt)],
		})

		return results.map((note) => this.mapToHrNote(note))
	}

	/**
	 * Get a single HR note (admin only)
	 */
	async getNote(noteId: string): Promise<HrNote> {
		const note = await this.db.query.hrNotes.findFirst({
			where: eq(hrNotes.id, noteId),
		})

		if (!note) {
			throw new Error('HR note not found')
		}

		return this.mapToHrNote(note)
	}

	/**
	 * Update an HR note (admin only)
	 */
	async updateNote(noteId: string, updates: Partial<HrNote>): Promise<void> {
		// Get the note to verify it exists
		const note = await this.db.query.hrNotes.findFirst({
			where: eq(hrNotes.id, noteId),
		})

		if (!note) {
			throw new Error('HR note not found')
		}

		// Build update object (only allow certain fields to be updated)
		const updateData: Partial<typeof hrNotes.$inferInsert> = {
			updatedAt: new Date(),
		}

		if (updates.noteText !== undefined) {
			updateData.noteText = updates.noteText
		}

		if (updates.noteType !== undefined) {
			updateData.noteType = updates.noteType
		}

		if (updates.priority !== undefined) {
			updateData.priority = updates.priority
		}

		if (updates.metadata !== undefined) {
			updateData.metadata = updates.metadata
		}

		// Update the note
		await this.db.update(hrNotes).set(updateData).where(eq(hrNotes.id, noteId))
	}

	/**
	 * Delete an HR note (admin only)
	 */
	async deleteNote(noteId: string): Promise<void> {
		await this.db.delete(hrNotes).where(eq(hrNotes.id, noteId))
	}

	/**
	 * Get notes by character (admin only)
	 */
	async getCharacterNotes(subjectCharacterId: string): Promise<HrNote[]> {
		const results = await this.db.query.hrNotes.findMany({
			where: eq(hrNotes.subjectCharacterId, subjectCharacterId),
			orderBy: [desc(hrNotes.createdAt)],
		})

		return results.map((note) => this.mapToHrNote(note))
	}

	/**
	 * Get high priority notes (admin dashboard)
	 */
	async getHighPriorityNotes(limit = 20): Promise<HrNote[]> {
		const results = await this.db.query.hrNotes.findMany({
			where: inArray(hrNotes.priority, ['high', 'critical']),
			orderBy: [desc(hrNotes.createdAt)],
			limit,
		})

		return results.map((note) => this.mapToHrNote(note))
	}

	/**
	 * Map database record to HrNote DTO
	 */
	private mapToHrNote(note: typeof hrNotes.$inferSelect): HrNote {
		return {
			id: note.id,
			subjectUserId: note.subjectUserId,
			subjectCharacterId: note.subjectCharacterId,
			authorId: note.authorId,
			authorCharacterId: note.authorCharacterId,
			authorCharacterName: note.authorCharacterName,
			noteText: note.noteText,
			noteType: note.noteType as HrNoteType,
			priority: note.priority as HrNotePriority,
			metadata: note.metadata,
			createdAt: note.createdAt,
			updatedAt: note.updatedAt,
		}
	}
}
