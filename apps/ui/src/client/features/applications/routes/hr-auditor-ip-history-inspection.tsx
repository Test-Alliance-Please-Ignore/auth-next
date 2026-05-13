import { useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

import { IpHashInspectionPage } from '@/components/ip-hash-inspection-page'
import { Container } from '@/components/ui/container'
import { apiClient } from '@/lib/api'
import { useAuditorIpHashMatches } from '@/hooks/useAuditorUsers'

export default function HrAuditorIpHistoryInspectionPage() {
	const { ipAddressHash = '' } = useParams<{ ipAddressHash: string }>()
	const [searchParams] = useSearchParams()
	const userId = searchParams.get('userId')

	const hash = useMemo(() => decodeURIComponent(ipAddressHash), [ipAddressHash])
	const { data: matchesData, isLoading } = useAuditorIpHashMatches(hash)

	return (
		<Container>
			<IpHashInspectionPage
				hash={hash}
				matches={matchesData?.matches ?? []}
				isLoading={isLoading}
				backTo={userId ? `/hr/users/${userId}` : '/hr/users'}
				backLabel={userId ? 'Back to User Profile' : 'Back to User Search'}
				buildUserLink={(targetUserId) => `/hr/users/${targetUserId}`}
				loadUserHashes={(targetUserId) => apiClient.getHrAuditorUserIpHistory(targetUserId)}
				buildHashLink={(targetHash) =>
					`/hr/ip-history/${encodeURIComponent(targetHash)}${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`
				}
			/>
		</Container>
	)
}
