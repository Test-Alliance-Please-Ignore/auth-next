/**
 * Fulcrum Report Page
 *
 * Full-page view of a character report, rendered with tabbed sections.
 * Accessible from the HR application review's Fulcrum panel.
 */

import { ArrowLeft } from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'

import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { FulcrumReportViewer } from '../components/fulcrum-report-viewer'

export default function FulcrumReportPage() {
	const { reportId, userId: routeUserId, corporationId: routeCorporationId, applicationId: routeApplicationId } = useParams<{
		reportId: string
		userId?: string
		corporationId?: string
		applicationId?: string
	}>()
	const location = useLocation()
	const navigate = useNavigate()
	const { hasAnyPermission } = useUserPermissions()
	const isAuditor = hasAnyPermission('urn:hr:auditor')

	const state = location.state as
		| {
			characterName?: string
			returnTo?: string
			userId?: string
			corporationId?: string
			backLabel?: string
			breadcrumbParentLabel?: string
		}
		| null
	const query = new URLSearchParams(location.search)
	const characterName = state?.characterName ?? query.get('characterName') ?? undefined
	const returnTo = state?.returnTo ?? query.get('returnTo') ?? undefined
	const userId = routeUserId ?? state?.userId ?? query.get('userId') ?? undefined
	const corporationId = routeCorporationId ?? state?.corporationId ?? query.get('corporationId') ?? undefined
	const applicationId = routeApplicationId ?? query.get('applicationId') ?? undefined

	const routeScopedBackPath = applicationId && corporationId
		? `/corporations/${corporationId}/applications/${applicationId}`
		: userId
			? `/hr/users/${userId}`
			: undefined

	const roleBasedBackPath = isAuditor && userId
		? `/hr/users/${userId}`
		: corporationId && userId
			? `/corporations/${corporationId}/members/${userId}`
			: '/corporations'

	const backPath = returnTo ?? routeScopedBackPath ?? roleBasedBackPath
	const isUserProfileBackPath = backPath.includes('/members/')
		|| backPath.includes('/hr/users/')
		|| backPath.includes('/hr/auditor/users/')
	const isApplicationBackPath = backPath.includes('/applications/')
	const backLabel =
		state?.backLabel
		?? query.get('backLabel')
		?? (isApplicationBackPath
			? 'Back to Application'
			: isUserProfileBackPath
				? 'Back to User Profile'
				: 'Back to Corporations')
	const breadcrumbParentLabel =
		state?.breadcrumbParentLabel
		?? query.get('breadcrumbParentLabel')
		?? (isApplicationBackPath ? 'Application' : isUserProfileBackPath ? 'User Profile' : 'Reports')

	usePageTitle(characterName ? `Report - ${characterName}` : 'Character Report')

	if (!reportId) {
		return null
	}

	return (
		<Container>
			{/* Breadcrumb */}
			<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink to={backPath}>
								{breadcrumbParentLabel}
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{characterName ? `${characterName} Report` : 'Character Report'}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>

				<Button variant="ghost" onClick={() => navigate(backPath)}>
					<ArrowLeft className="h-4 w-4" />
					{backLabel}
				</Button>
			</div>

			{/* Report Viewer */}
			<FulcrumReportViewer reportId={reportId} />
		</Container>
	)
}
