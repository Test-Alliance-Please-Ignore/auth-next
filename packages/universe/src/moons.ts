import { z } from 'zod'

/**
 * Represents a moon identifier (EVE Online moon ID).
 * Stored as text to avoid bigint serialization issues.
 */
export type EveMoonId = string

/**
 * Moon resource composition schema.
 * Quantities are strings to preserve precision.
 */
export const UniverseMoonResourceSchema = z.object({
	id: z.number().int(),
	moonId: z.string(),
	productName: z.string(),
	quantity: z.string(),
	oreTypeId: z.string(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
})

export type UniverseMoonResource = z.infer<typeof UniverseMoonResourceSchema>

/**
 * Moon metadata schema.
 */
export const UniverseMoonSchema = z.object({
	id: z.number().int(),
	moonId: z.string(),
	name: z.string(),
	planetId: z.string(),
	solarSystemId: z.string(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
})

export type UniverseMoon = z.infer<typeof UniverseMoonSchema>

/**
 * Moon metadata with resource composition.
 */
export const UniverseMoonWithResourcesSchema = UniverseMoonSchema.extend({
	resources: z.array(UniverseMoonResourceSchema),
})

export type UniverseMoonWithResources = z.infer<typeof UniverseMoonWithResourcesSchema>
