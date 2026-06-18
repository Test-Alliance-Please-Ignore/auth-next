import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { useFeatureFlags } from '@/hooks/useFeatureFlags'

import { mumbleKeys } from './query-keys'

export const MUMBLE_FEATURE_FLAG_KEY = 'mumble.enabled'

export function useMumbleFeatureEnabled() {
	const queryClient = useQueryClient()
	const { data, isLoading } = useFeatureFlags()
	const isEnabled = data?.[MUMBLE_FEATURE_FLAG_KEY] === true

	useEffect(() => {
		if (isLoading || isEnabled) return
		void queryClient.removeQueries({ queryKey: mumbleKeys.all })
	}, [isEnabled, isLoading, queryClient])

	return {
		isEnabled,
		isLoading,
	}
}
