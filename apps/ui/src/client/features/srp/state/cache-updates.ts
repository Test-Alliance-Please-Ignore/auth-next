import type { SRPRequestResponse } from '../types'

export interface LossListEntry {
	killmailId: string
	hasSRPRequest: boolean
	srpRequestId?: string
	srpRequestStatus?: string
}

export interface MyRequestsQueryData {
	requests: SRPRequestResponse[]
	total: number
	limit: number
	offset: number
}

export function isSrpLossesQueryKey(queryKey: readonly unknown[]): boolean {
	return Array.isArray(queryKey) && queryKey[0] === 'srp' && queryKey[1] === 'losses'
}

export function isSrpMyRequestsQueryKey(queryKey: readonly unknown[]): boolean {
	return (
		Array.isArray(queryKey) &&
		queryKey[0] === 'srp' &&
		queryKey[1] === 'requests' &&
		queryKey[2] === 'my'
	)
}

export function patchLossesForRequest(
	losses: LossListEntry[] | undefined,
	request: { killmailId: string; requestId: string; requestStatus: string }
): LossListEntry[] | undefined {
	if (!losses) return losses
	return losses.map((loss) =>
		loss.killmailId === request.killmailId
			? {
					...loss,
					hasSRPRequest: true,
					srpRequestId: request.requestId,
					srpRequestStatus: request.requestStatus,
				}
			: loss
	)
}

export function patchLossesByRequestStatus(
	losses: LossListEntry[] | undefined,
	requestId: string,
	requestStatus: string
): LossListEntry[] | undefined {
	if (!losses) return losses
	return losses.map((loss) =>
		loss.srpRequestId === requestId
			? {
					...loss,
					srpRequestStatus: requestStatus,
				}
			: loss
	)
}

export function patchMyRequestsStatus(
	data: MyRequestsQueryData | undefined,
	request: SRPRequestResponse
): MyRequestsQueryData | undefined {
	if (!data) return data
	return {
		...data,
		requests: data.requests.map((row) =>
			row.id === request.id
				? {
						...row,
						requestStatus: request.requestStatus,
						approvedAmount: request.approvedAmount,
						reviewedAt: request.reviewedAt,
						reviewerId: request.reviewerId,
						reviewerCharacterName: request.reviewerCharacterName,
						paymentDate: request.paymentDate,
						paymentCharacterName: request.paymentCharacterName,
					}
				: row
		),
	}
}

export function prependMyRequest(
	data: MyRequestsQueryData | undefined,
	request: SRPRequestResponse
): MyRequestsQueryData | undefined {
	if (!data) return data
	const existing = data.requests.find((row) => row.id === request.id)
	if (existing) {
		return {
			...data,
			requests: data.requests.map((row) => (row.id === request.id ? request : row)),
		}
	}
	return {
		...data,
		requests: [request, ...data.requests],
		total: data.total + 1,
	}
}
