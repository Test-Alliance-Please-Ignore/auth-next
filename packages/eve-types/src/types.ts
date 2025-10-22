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
export type EveBrandedType<T, Brand extends string> = T & { readonly __brand: Brand };

/**
 * Utility function for creating branded types.
 * 
 * @template T - The type of the value to brand
 * @template Brand - The string literal type used as the brand identifier
 * 
 * @param value - The value to brand
 * @param brand - The brand identifier string
 * 
 * @returns A new object with the original value properties plus the brand property
 */
export const brand = <T, Brand extends string>(value: T, brand: Brand): EveBrandedType<T, Brand> => {
    return { ...value, __brand: brand };
};