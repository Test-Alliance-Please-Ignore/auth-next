import { Hono } from 'hono'

import { createDb } from '../db'
import { requireAuth } from '../middleware/session'
import { ActivityService } from '../services/activity.service'
import { UserService } from '../services/user.service'

import type { App } from '../context'
import type { RequestMetadata, UserPreferencesDTO } from '../types/user'

/**
 * User management routes
 *
 * Handles user profile, preferences, and character management.
 * All routes require authentication.
 */
const users = new Hono<App>()

// Apply authentication to all routes
users.use('*', requireAuth())

/**
 * Helper to extract request metadata
 */
function getRequestMetadata(c: any): RequestMetadata {
	return {
		ip: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For'),
		userAgent: c.req.header('User-Agent'),
	}
}

/**
 * GET /users/me
 *
 * Get current user profile with all characters, roles, and preferences.
 */
users.get('/me', async (c) => {
	const user = c.get('user')!

	const db = c.get('db') || createDb(c.env.DATABASE_URL)
	const userService = new UserService(db)

	// Get full user profile
	const profile = await userService.getUserProfile(user.id)

	return c.json({
		id: profile.id,
		mainCharacterId: profile.mainCharacterId,
		characters: profile.characters,
		is_admin: profile.is_admin,
		preferences: profile.preferences,
		discord: user.discord || null,
		createdAt: profile.createdAt,
		updatedAt: profile.updatedAt,
	})
})

/**
 * PATCH /users/me/preferences
 *
 * Update user preferences.
 */
users.patch('/me/preferences', async (c) => {
	const user = c.get('user')!
	const body = await c.req.json()

	const db = c.get('db') || createDb(c.env.DATABASE_URL)
	const userService = new UserService(db)
	const activityService = new ActivityService(db)

	// Validate preferences
	const preferences: UserPreferencesDTO = body.preferences || body

	// Update preferences
	const updated = await userService.updatePreferences(user.id, preferences)

	await activityService.logPreferencesUpdated(user.id, getRequestMetadata(c))

	return c.json({
		preferences: updated,
	})
})

/**
 * GET /users/me/characters
 *
 * List all linked characters for current user.
 */
users.get('/me/characters', async (c) => {
	const user = c.get('user')!

	const db = c.get('db') || createDb(c.env.DATABASE_URL)
	const userService = new UserService(db)

	const profile = await userService.getUserProfile(user.id)

	return c.json({
		characters: profile.characters,
	})
})

/**
 * DELETE /users/me/characters/:characterId
 *
 * Unlink a character from the current user.
 * Cannot unlink primary character.
 */
users.delete('/me/characters/:characterId', async (c) => {
	const user = c.get('user')!
	const characterId = c.req.param('characterId')

	if (!characterId) {
		return c.json({ error: 'Missing character ID' }, 400)
	}

	// Validate user owns this character (defense in depth)
	const character = user.characters.find((char) => char.characterId === characterId)
	if (!character) {
		return c.json({ error: 'Character not found or not owned by user' }, 404)
	}

	const db = c.get('db') || createDb(c.env.DATABASE_URL)
	const userService = new UserService(db)
	const activityService = new ActivityService(db)

	try {
		// Unlink character
		const success = await userService.unlinkCharacter(user.id, characterId)

		if (!success) {
			return c.json({ error: 'Character not found or already unlinked' }, 404)
		}

		await activityService.logCharacterUnlinked(user.id, characterId, getRequestMetadata(c))

		return c.json({
			success: true,
		})
	} catch (error) {
		if (error instanceof Error && error.message.includes('Cannot unlink primary character')) {
			return c.json({ error: error.message }, 400)
		}
		throw error
	}
})

/**
 * POST /users/me/characters/:characterId/set-primary
 *
 * Set a character as the primary character for the user.
 */
users.post('/me/characters/:characterId/set-primary', async (c) => {
	const user = c.get('user')!
	const characterId = c.req.param('characterId')

	if (!characterId) {
		return c.json({ error: 'Missing character ID' }, 400)
	}

	// Validate user owns this character (defense in depth)
	const character = user.characters.find((char) => char.characterId === characterId)
	if (!character) {
		return c.json({ error: 'Character not found or not owned by user' }, 404)
	}

	const db = c.get('db') || createDb(c.env.DATABASE_URL)
	const userService = new UserService(db)
	const activityService = new ActivityService(db)

	try {
		// Set primary character
		const success = await userService.setPrimaryCharacter(user.id, characterId)

		if (!success) {
			return c.json({ error: 'Failed to set primary character' }, 500)
		}

		await activityService.logPrimaryCharacterChanged(
			user.id,
			user.mainCharacterId,
			characterId,
			getRequestMetadata(c)
		)

		return c.json({
			success: true,
		})
	} catch (error) {
		if (error instanceof Error && error.message.includes('Character not found')) {
			return c.json({ error: error.message }, 404)
		}
		throw error
	}
})

export default users
