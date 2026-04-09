/**
 * Fulcrum Report Page
 *
 * Full-page view of a character report, rendered with tabbed sections.
 * Accessible from the HR application review's Fulcrum panel.
 */

import { ArrowLeft } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { usePageTitle } from '@/hooks/usePageTitle'

import { FulcrumReportViewer } from '../components/fulcrum-report-viewer'

export default function FulcrumReportPage() {
	const { corporationId, applicationId, reportId } = useParams<{
		corporationId: string
		applicationId?: string
		reportId: string
	}>()
	const navigate = useNavigate()
	const [searchParams] = useSearchParams()
	const characterName = searchParams.get('char') ?? searchParams.get('name')

	usePageTitle(characterName ? `Report - ${characterName}` : 'Character Report')

	if (!corporationId || !reportId) {
		return null
	}

	// When coming from an application review, link back to that application.
	// When coming from the HR dashboard, link back to the dashboard.
	const fromApplication = !!applicationId
	const backPath = fromApplication
		? `/corporations/${corporationId}/hr/applications/${applicationId}?tab=fulcrum`
		: `/my-corporations/${corporationId}/members`
	const backLabel = fromApplication ? 'Back to Application' : 'Back to HR Dashboard'

	return (
		<div className="container mx-auto max-w-6xl px-4 py-8">
			{/* Breadcrumb */}
			<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<Breadcrumb>
					<BreadcrumbList>
						{fromApplication ? (
							<>
								<BreadcrumbItem>
									<BreadcrumbLink to={`/corporations/${corporationId}/hr/applications`}>
										Applications
									</BreadcrumbLink>
								</BreadcrumbItem>
								<BreadcrumbSeparator />
								<BreadcrumbItem>
									<BreadcrumbLink to={backPath}>Review</BreadcrumbLink>
								</BreadcrumbItem>
							</>
						) : (
							<BreadcrumbItem>
								<BreadcrumbLink to={backPath}>
									HR Dashboard
								</BreadcrumbLink>
							</BreadcrumbItem>
						)}
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{characterName ? `${characterName} Report` : 'Character Report'}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>

				<Button variant="ghost" onClick={() => navigate(backPath)}>
					<ArrowLeft className="mr-2 h-4 w-4" />
					{backLabel}
				</Button>
			</div>

			{/* Report Viewer */}
			<FulcrumReportViewer reportId={reportId} />
		</div>
	)
}
