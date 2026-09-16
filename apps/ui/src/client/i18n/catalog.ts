export type MessageTree = {
	readonly [key: string]: string | MessageTree
}

export type MessageShape<T, ExtraPluralCategory extends string = never> = T extends string
	? string
	: {
			readonly [Key in keyof T as Key extends `${infer Base}_other`
				? Key | `${Base}_${ExtraPluralCategory}`
				: Key]: MessageShape<T[Key], ExtraPluralCategory>
		}

export interface LocalizedCatalog<English extends MessageTree> {
	readonly en: English
	readonly de: MessageShape<English>
	readonly ko: MessageShape<English>
	// Spanish uses "many" for exact millions in addition to "one" and "other".
	readonly 'es-MX': MessageShape<English, 'many'>
}

/**
 * English defines each feature catalog's shape. NoInfer makes missing or extra
 * translated keys a compile-time error instead of widening the shape.
 */
export function defineCatalog<const English extends MessageTree>(
	en: English,
	de: MessageShape<NoInfer<English>>,
	ko: MessageShape<NoInfer<English>>,
	esMX: MessageShape<NoInfer<English>, 'many'>
): LocalizedCatalog<English> {
	return { en, de, ko, 'es-MX': esMX }
}
