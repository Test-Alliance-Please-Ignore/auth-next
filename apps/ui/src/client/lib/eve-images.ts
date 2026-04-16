/**
 * EVE Online image URL utilities
 *
 * All EVE image assets are proxied through /images/... for 30-day Cloudflare edge caching.
 */

export type PortraitSize = 32 | 64 | 128 | 256 | 512
export type LogoSize = 32 | 64 | 128 | 256
export type TypeIconSize = 32 | 64

/**
 * Character portrait URL, routed through the local proxy for edge caching.
 */
export function characterPortraitUrl(characterId: string | number, size: PortraitSize): string {
	return `/images/characters/${characterId}/portrait?size=${size}`
}

/**
 * Corporation logo URL, routed through the local proxy for edge caching.
 */
export function corporationLogoUrl(corporationId: string | number, size: LogoSize): string {
	return `/images/corporations/${corporationId}/logo?size=${size}`
}

/**
 * Alliance logo URL, routed through the local proxy for edge caching.
 */
export function allianceLogoUrl(allianceId: string | number, size: LogoSize): string {
	return `/images/alliances/${allianceId}/logo?size=${size}`
}

/**
 * Type icon URL (modules, ships, items), routed through the local proxy for edge caching.
 */
export function typeIconUrl(typeId: string | number, size: TypeIconSize = 32): string {
	return `/images/types/${typeId}/icon?size=${size}`
}

/**
 * Type render URL (3D ship renders), routed through the local proxy for edge caching.
 */
export function typeRenderUrl(typeId: string | number, size: PortraitSize = 512): string {
	return `/images/types/${typeId}/render?size=${size}`
}

/**
 * Generic type image URL for dynamic variants (e.g. 'icon', 'render', 'bp', 'bpc'),
 * routed through the local proxy for edge caching.
 */
export function typeImageUrl(typeId: string | number, variant: string, size: number): string {
	return `/images/types/${typeId}/${variant}?size=${size}`
}
