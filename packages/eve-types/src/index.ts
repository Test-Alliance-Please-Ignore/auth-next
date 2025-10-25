/**
 * @fileoverview EVE Online Type Definitions
 * 
 * This module provides branded type definitions for EVE Online entities to ensure
 * type safety and prevent mixing of different ID types throughout the application.
 * 
 * @packageDocumentation
 */

import { brand, unbrand } from './types';
import type { EveBrandedType } from './types';

export { unbrand };


/**
 * Branded type for EVE Online Corporation IDs.
 * These are typically numeric strings representing unique corporation identifiers.
 * 
 * @example
 * ```typescript
 * const corpId: EveCorporationId = '1234567890' as EveCorporationId;
 * ```
 */
export type EveCorporationId = EveBrandedType<string, 'EveCorporationId'>;

/**
 * Branded type for EVE Online Alliance IDs.
 * These are typically numeric strings representing unique alliance identifiers.
 * 
 * @example
 * ```typescript
 * const allianceId: EveAllianceId = '9876543210' as EveAllianceId;
 * ```
 */
export type EveAllianceId = EveBrandedType<string, 'EveAllianceId'>;

/**
 * Branded type for EVE Online Character IDs.
 * These are typically numeric strings representing unique character identifiers.
 * 
 * @example
 * ```typescript
 * const charId: EveCharacterId = '555666777' as EveCharacterId;
 * ```
 */
export type EveCharacterId = EveBrandedType<string, 'EveCharacterId'>;


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
    brand(id, 'EveCorporationId');

export const createEveCharacterId = (id: string): EveCharacterId => 
    brand(id, 'EveCharacterId');

export const createEveAllianceId = (id: string): EveAllianceId => 
    brand(id, 'EveAllianceId');

