import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { useFeatureFlags } from '@/hooks/useFeatureFlags'

import { mumbleKeys } from './query-keys'

export const MUMBLE_FEATURE_FLAG_KEY = 'mumble.enabled'

export function useMumbleFeatureEnabled(options?: { enabled?: boolean }) {
	const queryClient = useQueryClient()
	const { data, isLoading, isPlaceholderData } = useFeatureFlags(options)
	const isEnabled = data?.[MUMBLE_FEATURE_FLAG_KEY] === true
	const isResolving = isLoading || isPlaceholderData

	useEffect(() => {
		if (isResolving || isEnabled) return
		void queryClient.removeQueries({ queryKey: mumbleKeys.all })
	}, [isEnabled, isResolving, queryClient])

	return {
		isEnabled,
		isLoading: isResolving,
	}
}
