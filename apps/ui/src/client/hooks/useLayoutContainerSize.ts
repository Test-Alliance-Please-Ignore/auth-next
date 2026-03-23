import { useEffect, useState } from 'react'

export type LayoutContainerSize = 'default' | 'wide' | 'full'

export const LAYOUT_CONTAINER_SIZE_STORAGE_KEY = 'ui:layout-container-size'

const VALID_LAYOUT_CONTAINER_SIZES = new Set<LayoutContainerSize>(['default', 'wide', 'full'])

function parseLayoutContainerSize(value: string | null): LayoutContainerSize | null {
	if (!value) {
		return null
	}
	return VALID_LAYOUT_CONTAINER_SIZES.has(value as LayoutContainerSize)
		? (value as LayoutContainerSize)
		: null
}

export function useLayoutContainerSize(
	fallback: LayoutContainerSize | null = 'default'
): LayoutContainerSize | null {
	const [size, setSize] = useState<LayoutContainerSize | null>(fallback)

	useEffect(() => {
		const applyOverride = () => {
			const value = window.localStorage.getItem(LAYOUT_CONTAINER_SIZE_STORAGE_KEY)
			setSize(parseLayoutContainerSize(value) ?? fallback)
		}

		applyOverride()

		const onStorage = (event: StorageEvent) => {
			if (event.key !== null && event.key !== LAYOUT_CONTAINER_SIZE_STORAGE_KEY) {
				return
			}
			applyOverride()
		}

		window.addEventListener('storage', onStorage)
		return () => window.removeEventListener('storage', onStorage)
	}, [fallback])

	return size
}
