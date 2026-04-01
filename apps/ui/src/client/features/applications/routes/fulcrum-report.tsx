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
import { GhostButton } from '@/components/ui/ghost-button'
import { usePageTitle } from '@/hooks/usePageTitle'

import { FulcrumReportViewer } from '../components/fulcrum-report-viewer'

export default function FulcrumReportPage() {
	const { corporationId, applicationId, reportId } = useParams<{
		corporationId: string
		applicationId: string
		reportId: string
	}>()
	const navigate = useNavigate()
	const [searchParams] = useSearchParams()
	const characterName = searchParams.get('char')

	usePageTitle(characterName ? `Report - ${characterName}` : 'Character Report')

	if (!corporationId || !applicationId || !reportId) {
		return null
	}

	const backPath = `/corporations/${corporationId}/hr/applications/${applicationId}?tab=fulcrum`

	return (
		<div className="container mx-auto max-w-6xl px-4 py-8">
			{/* Breadcrumb */}
			<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink to={`/corporations/${corporationId}/hr/applications`}>
								Applications
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbLink to={backPath}>Review</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{characterName ? `${characterName} Report` : 'Character Report'}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>

				<GhostButton onClick={() => navigate(backPath)}>
					<ArrowLeft className="mr-2 h-4 w-4" />
					Back to Application
				</GhostButton>
			</div>

			{/* Report Viewer */}
			<FulcrumReportViewer reportId={reportId} />
		</div>
	)
}
