import { createContext, useContext, useState } from 'react'

import type { ReactNode } from 'react'

export interface LayoutScrollContextValue {
	isPageScrollEnabled: boolean
	setIsPageScrollEnabled: (enabled: boolean) => void
}

const LayoutScrollContext = createContext<LayoutScrollContextValue | null>(null)

export function useLayoutScrollMode(): LayoutScrollContextValue {
	const context = useContext(LayoutScrollContext)
	if (!context) {
		throw new Error('useLayoutScrollMode must be used within LayoutScrollProvider')
	}
	return context
}

export function LayoutScrollProvider({
	children,
	value,
}: {
	children: ReactNode
	value?: LayoutScrollContextValue
}) {
	const [internalIsPageScrollEnabled, setInternalIsPageScrollEnabled] = useState(false)
	const contextValue =
		value ??
		({
			isPageScrollEnabled: internalIsPageScrollEnabled,
			setIsPageScrollEnabled: setInternalIsPageScrollEnabled,
		} satisfies LayoutScrollContextValue)

	return (
		<LayoutScrollContext.Provider value={contextValue}>{children}</LayoutScrollContext.Provider>
	)
}
