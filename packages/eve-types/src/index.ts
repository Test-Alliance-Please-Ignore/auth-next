/**
 * @fileoverview EVE Online Type Definitions
 *
 * This module provides branded type definitions for EVE Online entities to ensure
 * type safety and prevent mixing of different ID types throughout the application.
 *
 * @packageDocumentation
 */

import { brand, unbrand } from './types'

import type { EveBrandedType } from './types'

export { unbrand }

/**
 * Branded type for EVE Online Corporation IDs.
 * These are typically numeric strings representing unique corporation identifiers.
 *
 * @example
 * ```typescript
 * const corpId: EveCorporationId = '1234567890' as EveCorporationId;
 * ```
 */
export type EveCorporationId = EveBrandedType<string, 'EveCorporationId'>

/**
 * Branded type for EVE Online Alliance IDs.
 * These are typically numeric strings representing unique alliance identifiers.
 *
 * @example
 * ```typescript
 * const allianceId: EveAllianceId = '9876543210' as EveAllianceId;
 * ```
 */
export type EveAllianceId = EveBrandedType<string, 'EveAllianceId'>

/**
 * Branded type for EVE Online Character IDs.
 * These are typically numeric strings representing unique character identifiers.
 *
 * @example
 * ```typescript
 * const charId: EveCharacterId = '555666777' as EveCharacterId;
 * ```
 */
export type EveCharacterId = EveBrandedType<string, 'EveCharacterId'>

/**
 * Branded type for EVE Online Fleet IDs.
 * These are typically numeric strings representing unique fleet identifiers.
 *
 * @example
 * ```typescript
 * const fleetId: EveFleetId = '1234567890' as EveFleetId;
 * ```
 */
export type EveFleetId = EveBrandedType<string, 'EveFleetId'>

/**
 * Branded type for EVE Online Skill IDs.
 * These are typically numeric strings representing unique skill identifiers.
 *
 * @example
 * ```typescript
 * const skillId: EveSkillId = '1234567890' as EveSkillId;
 * ```
 */
export type EveSkillId = EveBrandedType<string, 'EveSkillId'>

/**
 * Branded type for EVE Online Group IDs.
 * These are typically numeric strings representing unique group identifiers.
 *
 * @example
 * ```typescript
 * const groupId: EveGroupId = '1234567890' as EveGroupId;
 * ```
 */
export type EveGroupId = EveBrandedType<string, 'EveGroupId'>

/**
 * Branded type for EVE Online System IDs.
 * These are typically numeric strings representing unique system identifiers.
 *
 * @example
 * ```typescript
 * const systemId: EveSystemId = '1234567890' as EveSystemId;
 * ```
 */
export type EveSystemId = EveBrandedType<string, 'EveSystemId'>

/**
 * Branded type for EVE Online Type IDs.
 * These are typically numeric strings representing unique type identifiers.
 *
 * @example
 * ```typescript
 * const typeId: EveTypeId = '1234567890' as EveTypeId;
 * ```
 */
export type EveTypeId = EveBrandedType<string, 'EveTypeId'>

/**
 * Branded type for EVE Online Region IDs.
 * These are typically numeric strings representing unique region identifiers.
 *
 * @example
 * ```typescript
 * const regionId: EveRegionId = '1234567890' as EveRegionId;
 * ```
 */
export type EveRegionId = EveBrandedType<string, 'EveRegionId'>

/**
 * Branded type for EVE Online Constellation IDs.
 * These are typically numeric strings representing unique constellation identifiers.
 *
 * @example
 * ```typescript
 * const constellationId: EveConstellationId = '1234567890' as EveConstellationId;
 * ```
 */
export type EveConstellationId = EveBrandedType<string, 'EveConstellationId'>

/**
 * Branded type for EVE Online Structure IDs.
 * These are typically numeric strings representing unique structure identifiers.
 *
 * @example
 * ```typescript
 * const structureId: EveStructureId = '1234567890' as EveStructureId;
 * ```
 */
export type EveStructureId = EveBrandedType<string, 'EveStructureId'>

/**
 * Branded type for EVE Online Category IDs.
 * These are typically numeric strings representing unique category identifiers for items.
 *
 * @example
 * ```typescript
 * const categoryId: EveCategoryId = '6' as EveCategoryId; // Ship category
 * ```
 */
export type EveCategoryId = EveBrandedType<string, 'EveCategoryId'>

/**
 * Branded type for EVE Online Market Group IDs.
 * These are typically numeric strings representing unique market group identifiers.
 *
 * @example
 * ```typescript
 * const marketGroupId: EveMarketGroupId = '157' as EveMarketGroupId;
 * ```
 */
export type EveMarketGroupId = EveBrandedType<string, 'EveMarketGroupId'>

/**
 * Helper functions for creating specific EVE branded types.
 * These provide the most convenient syntax for common use cases.
 *
 * @example
 * ```typescript
 * // Clean, simple syntax
 * const corpId = createEveCorporationId('1234567890');
 * const charId = createEveCharacterId('555666777');
 * const allianceId = createEveAllianceId('9876543210');
 *
 * // Type-safe usage
 * function processCorporation(id: EveCorporationId) {
 *   console.log('Processing corporation:', id);
 * }
 *
 * processCorporation(corpId); // Works correctly
 * // processCorporation(charId); // TypeScript error: incompatible types
 * ```
 */
export const createEveCorporationId = (id: string): EveCorporationId =>
	brand(id, 'EveCorporationId')

export const createEveCharacterId = (id: string): EveCharacterId => brand(id, 'EveCharacterId')

export const createEveAllianceId = (id: string): EveAllianceId => brand(id, 'EveAllianceId')

export const createEveTypeId = (id: string): EveTypeId => brand(id, 'EveTypeId')

export const createEveGroupId = (id: string): EveGroupId => brand(id, 'EveGroupId')

export const createEveCategoryId = (id: string): EveCategoryId => brand(id, 'EveCategoryId')

export const createEveMarketGroupId = (id: string): EveMarketGroupId =>
	brand(id, 'EveMarketGroupId')

export const createEveSystemId = (id: string): EveSystemId => brand(id, 'EveSystemId')

export const createEveRegionId = (id: string): EveRegionId => brand(id, 'EveRegionId')

export const createEveConstellationId = (id: string): EveConstellationId =>
	brand(id, 'EveConstellationId')

export const createEveStructureId = (id: string): EveStructureId => brand(id, 'EveStructureId')

export const assertEveCharacterId = (id: string | number): string => {
	if (typeof id !== 'string' && typeof id !== 'number') {
		throw new Error(`Invalid character ID: ${id} type: ${typeof id}`)
	}
	return typeof id === 'string' ? id : id.toString()
}

// Re-export skill types and utilities
export * from './skills'

// Re-export inventory types and utilities
export * from './inventory'
