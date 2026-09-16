import { useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router'

import { IpHashInspectionPage } from '@/components/ip-hash-inspection-page'
import { Container } from '@/components/ui/container'
import { useAuditorIpHashMatches } from '@/hooks/useAuditorUsers'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'
import { apiClient } from '@/lib/api'

export default function HrAuditorIpHistoryInspectionPage() {
	const { t } = useAppTranslation()

	usePageTitle(t('hrpages.hrIpHistoryInspection'))

	const { ipAddressHash = '' } = useParams<{ ipAddressHash: string }>()
	const [searchParams] = useSearchParams()
	const userId = searchParams.get('userId')

	const hash = useMemo(() => decodeURIComponent(ipAddressHash), [ipAddressHash, t])
	const { data: matchesData, isLoading } = useAuditorIpHashMatches(hash)

	return (
		<Container>
			<IpHashInspectionPage
				hash={hash}
				matches={matchesData?.matches ?? []}
				isLoading={isLoading}
				backTo={userId ? `/hr/users/${userId}` : '/hr/users'}
				backLabel={userId ? t('hrpages.backToUserProfile') : t('hrpages.backToUserSearch')}
				buildUserLink={(targetUserId) => `/hr/users/${targetUserId}`}
				loadUserHashes={(targetUserId) => apiClient.getHrAuditorUserIpHistory(targetUserId)}
				buildHashLink={(targetHash) =>
					`/hr/ip-history/${encodeURIComponent(targetHash)}${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`
				}
			/>
		</Container>
	)
}
