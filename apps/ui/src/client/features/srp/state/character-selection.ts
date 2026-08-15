import { useCallback, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY_PREFIX = 'srp.losses.selected-character-ids'

function normalizeCharacterIds(characterIds: string[]): string[] {
	return [...new Set(characterIds.map((characterId) => characterId.trim()).filter(Boolean))].sort()
}

function readStoredCharacterIds(storageKey: string): string[] {
	try {
		const value = window.localStorage.getItem(storageKey)
		if (!value) return []
		const parsed: unknown = JSON.parse(value)
		return Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')
			? normalizeCharacterIds(parsed)
			: []
	} catch {
		return []
	}
}

export function useSrpCharacterSelection(
	userId: string | undefined,
	availableCharacterIds: string[]
) {
	const storageKey = userId ? `${STORAGE_KEY_PREFIX}:${userId}` : null
	const availableCharacterIdsKey = availableCharacterIds.join(',')
	const availableIds = useMemo(
		() => normalizeCharacterIds(availableCharacterIds),
		[availableCharacterIdsKey]
	)
	const availableIdSet = useMemo(() => new Set(availableIds), [availableIds])
	const [selectedCharacterIds, setSelectedCharacterIdsState] = useState<string[]>([])
	const [isLoaded, setIsLoaded] = useState(false)
	const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null)

	useEffect(() => {
		if (!storageKey) {
			setSelectedCharacterIdsState([])
			setIsLoaded(true)
			setLoadedStorageKey(null)
			return
		}

		setIsLoaded(false)
		setSelectedCharacterIdsState(
			readStoredCharacterIds(storageKey).filter((id) => availableIdSet.has(id))
		)
		setIsLoaded(true)
		setLoadedStorageKey(storageKey)
	}, [availableIdSet, storageKey])

	useEffect(() => {
		if (!isLoaded || !storageKey || loadedStorageKey !== storageKey) return
		const validSelection = selectedCharacterIds.filter((id) => availableIdSet.has(id))
		if (validSelection.length !== selectedCharacterIds.length) {
			setSelectedCharacterIdsState(validSelection)
			return
		}
		try {
			window.localStorage.setItem(storageKey, JSON.stringify(validSelection))
		} catch {
			// Browser storage is optional; the in-memory selection remains usable.
		}
	}, [availableIdSet, isLoaded, loadedStorageKey, selectedCharacterIds, storageKey])

	const setSelectedCharacterIds = useCallback(
		(nextCharacterIds: string[]) => {
			setSelectedCharacterIdsState(
				normalizeCharacterIds(nextCharacterIds).filter((id) => availableIdSet.has(id))
			)
		},
		[availableIdSet]
	)

	return {
		selectedCharacterIds,
		setSelectedCharacterIds,
		isLoaded: isLoaded && loadedStorageKey === storageKey,
	}
}
