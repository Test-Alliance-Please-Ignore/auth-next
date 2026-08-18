/**
 * Fulcrum Report Page
 *
 * Full-page view of a character report, rendered with tabbed sections.
 * Accessible from the HR application review's Fulcrum panel.
 */

import { ArrowLeft } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'

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
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'

import { useCorporationMemberAccount } from '../../corporations/hooks'
import { FulcrumReportViewer } from '../components/fulcrum-report-viewer'
import { useApplication, useHrUserCharacters, useReportSections } from '../hooks'

export default function FulcrumReportPage() {
	const {
		reportId,
		userId: routeUserId,
		corporationId: routeCorporationId,
		applicationId: routeApplicationId,
		accountId: routeAccountId,
	} = useParams<{
		reportId: string
		userId?: string
		corporationId?: string
		applicationId?: string
		accountId?: string
	}>()
	const navigate = useNavigate()
	const userId = routeUserId
	const corporationId = routeCorporationId
	const applicationId = routeApplicationId
	const accountId = routeAccountId

	const reportSource =
		applicationId && corporationId
			? 'application'
			: accountId && corporationId
				? 'member'
				: userId
					? 'user'
					: null
	const { data: application } = useApplication(applicationId ?? '', {
		enabled: reportSource === 'application',
	})
	const { data: memberAccount } = useCorporationMemberAccount(corporationId ?? '', accountId ?? '')
	const { data: userCharacters = [] } = useHrUserCharacters(userId ?? '', {
		enabled: reportSource === 'user',
	})
	const { data: manifest } = useReportSections(reportId ?? '', !!reportId)
	const { data: characterNames = {} } = useEntityNames(
		manifest?.characterId ? [manifest.characterId] : [],
		{ enabled: !!manifest?.characterId }
	)

	const characterName = manifest?.characterId ? characterNames[manifest.characterId] : undefined
	const sourceUserName =
		reportSource === 'application'
			? application?.characterName
			: reportSource === 'member'
				? memberAccount?.account.mainName
				: userCharacters[0]?.characterName
	const displaySourceUserName = sourceUserName ?? characterName
	const backPath =
		reportSource === 'application'
			? `/corporations/${corporationId}/applications/${applicationId}`
			: reportSource === 'member'
				? `/corporations/${corporationId}/members/${accountId}`
				: reportSource === 'user'
					? `/hr/users/${userId}`
					: null
	usePageTitle(characterName ? `Report - ${characterName}` : 'Character Report')

	if (!reportId || !backPath) {
		return null
	}

	const backLabel =
		reportSource === 'application'
			? 'Back to Application'
			: reportSource === 'member'
				? 'Back to Member Profile'
				: 'Back to User Profile'
	const breadcrumbParentLabel =
		reportSource === 'application'
			? 'Application'
			: reportSource === 'member'
				? 'Members'
				: 'User Profile'

	return (
		<Container>
			{/* Breadcrumb */}
			<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink to={backPath}>{breadcrumbParentLabel}</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{displaySourceUserName ?? breadcrumbParentLabel}</BreadcrumbPage>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>
								{characterName ? `${characterName} Report` : 'Character Report'}
							</BreadcrumbPage>
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
