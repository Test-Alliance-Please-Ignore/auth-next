import { useQueryClient } from '@tanstack/react-query'

import { i18n } from '@/i18n'
import { api } from '@/lib/api'

import { useApiMutation } from './useApiMutation'

/**
 * Refresh character data by ID
 * Fetches latest data from EVE Online API and updates the character cache
 */
export function useRefreshCharacter() {
	const queryClient = useQueryClient()

	return useApiMutation({
		mutationFn: (characterId: string) => api.refreshCharacterById(characterId),
		successMessage: () => i18n.t('characterDetail.refreshed'),
		onSuccess: (_, characterId) => {
			// Invalidate the character detail query to trigger a refetch
			void queryClient.invalidateQueries({ queryKey: ['character', characterId] })
		},
	})
}
