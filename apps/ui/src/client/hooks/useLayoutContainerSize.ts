export type LayoutContainerSize = 'default' | 'wide' | 'full'

export function useLayoutContainerSize(
	_fallback: LayoutContainerSize | null = 'default'
): LayoutContainerSize | null {
	return 'full'
}
