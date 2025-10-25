/**
 * A generic branded type that adds a readonly brand property to any type T.
 * This pattern helps prevent accidental mixing of different ID types by making
 * them structurally different at the type level while maintaining the same runtime value.
 *
 * @template T - The underlying type to brand
 * @template Brand - The string literal type used as the brand identifier
 *
 * @example
 * ```typescript
 * type UserId = EveBrandedType<string, 'UserId'>;
 * type ProductId = EveBrandedType<string, 'ProductId'>;
 *
 * // These are incompatible even though both are strings:
 * const userId: UserId = '123' as UserId;
 * const productId: ProductId = '123' as ProductId;
 * // userId = productId; // TypeScript error: Type 'ProductId' is not assignable to type 'UserId'
 * ```
 */
export type EveBrandedType<T, Brand extends string> = T & { readonly __brand: Brand }

/**
 * Utility function for creating branded types.
 *
 * For primitives (string, number), this provides compile-time type safety without runtime overhead.
 * The __brand property exists only at the type level.
 *
 * @template T - The type of the value to brand
 * @template Brand - The string literal type used as the brand identifier
 *
 * @param value - The value to brand
 * @param _brand - The brand identifier string (used only for type inference)
 *
 * @returns The value cast to the branded type (no runtime transformation for primitives)
 */
export const brand = <T, Brand extends string>(
	value: T,
	_brand: Brand
): EveBrandedType<T, Brand> => {
	// For primitives like strings and numbers, we just cast at compile time
	// The __brand property is a type-level construct only
	return value as EveBrandedType<T, Brand>
}

/**
 * Utility function for extracting the underlying value from a branded type.
 *
 * This is primarily for documentation purposes and type narrowing.
 * Since branded primitives have no runtime overhead, this simply returns the value as-is.
 *
 * @template T - The underlying type
 * @template Brand - The brand identifier
 *
 * @param value - The branded value
 *
 * @returns The underlying primitive value
 *
 * @example
 * ```typescript
 * const branded: EveCorporationId = createEveCorporationId('123456');
 * const raw: string = unbrand(branded); // '123456'
 * ```
 */
export const unbrand = <T, Brand extends string>(value: EveBrandedType<T, Brand>): T => {
	return value as T
}
