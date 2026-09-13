export type MessageTree = {
	readonly [key: string]: string | MessageTree
}

export type MessageShape<T> = T extends string
	? string
	: { readonly [Key in keyof T]: MessageShape<T[Key]> }

export interface LocalizedCatalog<English extends MessageTree> {
	readonly en: English
	readonly de: MessageShape<English>
	readonly ko: MessageShape<English>
}

/**
 * English defines each feature catalog's shape. NoInfer makes missing or extra
 * German and Korean keys a compile-time error instead of widening the shape.
 */
export function defineCatalog<const English extends MessageTree>(
	en: English,
	de: MessageShape<NoInfer<English>>,
	ko: MessageShape<NoInfer<English>>
): LocalizedCatalog<English> {
	return { en, de, ko }
}
