interface BuildReportViewUrlOptions {
	baseUrl: string
	reportId: string
	requestorCorporationId: string
	applicationId?: string | null
	targetUserId?: string | null
}

export function buildScopedReportViewUrl({
	baseUrl,
	reportId,
	requestorCorporationId,
	applicationId,
	targetUserId,
}: BuildReportViewUrlOptions): string {
	if (applicationId) {
		return `${baseUrl}/corporations/${requestorCorporationId}/applications/${applicationId}/reports/${reportId}`
	}

	if (targetUserId) {
		return `${baseUrl}/hr/users/${targetUserId}/reports/${reportId}`
	}

	return `${baseUrl}/fulcrum/reports/${reportId}`
}

