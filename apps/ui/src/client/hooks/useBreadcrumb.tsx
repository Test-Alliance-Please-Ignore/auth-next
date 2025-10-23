import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface BreadcrumbContextType {
	customLabels: Map<string, string>
	setCustomLabel: (path: string, label: string) => void
	clearCustomLabel: (path: string) => void
}

const BreadcrumbContext = createContext<BreadcrumbContextType | undefined>(undefined)

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
	const [customLabels, setCustomLabels] = useState<Map<string, string>>(new Map())

	const setCustomLabel = useCallback((path: string, label: string) => {
		setCustomLabels((prev) => {
			const next = new Map(prev)
			next.set(path, label)
			return next
		})
	}, [])

	const clearCustomLabel = useCallback((path: string) => {
		setCustomLabels((prev) => {
			const next = new Map(prev)
			next.delete(path)
			return next
		})
	}, [])

	return (
		<BreadcrumbContext.Provider value={{ customLabels, setCustomLabel, clearCustomLabel }}>
			{children}
		</BreadcrumbContext.Provider>
	)
}

export function useBreadcrumb() {
	const context = useContext(BreadcrumbContext)
	if (context === undefined) {
		throw new Error('useBreadcrumb must be used within a BreadcrumbProvider')
	}
	return context
}
