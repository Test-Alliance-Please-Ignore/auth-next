import { useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

import { IpHashInspectionPage } from '@/components/ip-hash-inspection-page'
import { Container } from '@/components/ui/container'
import { useAdminIpHashMatches } from '@/hooks/useAdminUsers'
import { api } from '@/lib/api'

export default function AdminIpHistoryInspectionPage() {
	const { ipAddressHash = '' } = useParams<{ ipAddressHash: string }>()
	const [searchParams] = useSearchParams()
	const userId = searchParams.get('userId')

	const hash = useMemo(() => decodeURIComponent(ipAddressHash), [ipAddressHash])
	const { data: matchesData, isLoading } = useAdminIpHashMatches(hash)

	return (
		<Container>
			<IpHashInspectionPage
				hash={hash}
				matches={matchesData?.matches ?? []}
				isLoading={isLoading}
				backTo={userId ? `/admin/users/${userId}` : '/admin/users'}
				backLabel={userId ? 'Back to User Details' : 'Back to Users'}
				buildUserLink={(targetUserId) => `/admin/users/${targetUserId}`}
				loadUserHashes={(targetUserId) => api.getAdminUserIpHistory(targetUserId)}
				buildHashLink={(targetHash) =>
					`/admin/ip-history/${encodeURIComponent(targetHash)}${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`
				}
			/>
		</Container>
	)
}
