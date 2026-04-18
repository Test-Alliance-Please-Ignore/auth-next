import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'

import Layout from './components/layout'
import { LoadingPage } from './components/ui/loading'
import { installTaxDemoWindow } from './dev/tax-demo-mode'
import { useAuth } from './hooks/useAuth'
import { useSessionSync } from './hooks/useSessionSync'
import AuthCallbackPage from './routes/auth-callback'
import BroadcastDetailPage from './routes/broadcast-detail'
import BroadcastsPage from './routes/broadcasts'
import BroadcastsNewPage from './routes/broadcasts-new'
import BrowseCorporations from './routes/browse-corporations'
import CharacterDetailPage from './routes/character-detail'
import ClaimMainPage from './routes/claim-main'
import DashboardPage from './routes/dashboard'
import DiscordCallbackPage from './routes/discord-callback'
import GroupDetailPage from './routes/group-detail'
// User-facing group routes
import GroupsPage from './routes/groups'
import InventoryParserPage from './routes/inventory-parser'
import InvitationsPage from './routes/invitations'
import LandingPage from './routes/landing'
import LegacyAuthCallbackPage from './routes/legacy-auth-callback'
import MyGroupsPage from './routes/my-groups'
import { adminRouteElements } from './routes/route-groups/admin-routes'
import { taxRouteElements } from './routes/route-groups/tax-routes'

const CorporationMembers = lazy(() => import('./features/corporations/routes/corporation-members'))
const CorporationSettings = lazy(
	() => import('./features/corporations/routes/corporation-settings')
)

// Lazy load public corporation pages
const CorporationDetail = lazy(() => import('./routes/corporation-detail'))

// Lazy load the Applications feature for code splitting
const MyApplicationsList = lazy(() => import('./features/applications/routes/my-applications-list'))
const ApplicationDetail = lazy(() => import('./features/applications/routes/application-detail'))
const HrApplicationsList = lazy(() => import('./features/applications/routes/hr-applications-list'))
const HrApplicationReview = lazy(
	() => import('./features/applications/routes/hr-application-review')
)
const CorporationsPage = lazy(() => import('./features/applications/routes/corporations'))
const HrRolesManagement = lazy(() => import('./features/applications/routes/hr-roles-management'))
const HrMemberProfile = lazy(() => import('./features/applications/routes/hr-member-profile'))
const FulcrumReport = lazy(() => import('./features/applications/routes/fulcrum-report'))
const RecommendationsList = lazy(
	() => import('./features/applications/routes/recommendations-list')
)
const HrAuditorUsersPage = lazy(() => import('./features/applications/routes/hr-auditor-users'))
const HrAuditorUserProfilePage = lazy(
	() => import('./features/applications/routes/hr-auditor-user-profile')
)
const HrAuditorUserGroupsPage = lazy(
	() => import('./features/applications/routes/hr-auditor-user-groups')
)

// Lazy load the Skill Plans feature for code splitting
const SkillPlansList = lazy(() => import('./features/skill-plans/routes/skill-plans-list'))
const SkillPlanDetail = lazy(() => import('./features/skill-plans/routes/skill-plan-detail'))
const SkillPlanCreate = lazy(() => import('./features/skill-plans/routes/skill-plan-create'))
const SkillPlanEdit = lazy(() => import('./features/skill-plans/routes/skill-plan-edit'))
const SkillPlanProgress = lazy(() => import('./features/skill-plans/routes/skill-plan-progress'))
const MySkillPlans = lazy(() => import('./features/skill-plans/routes/my-skill-plans'))
const CategoriesManagement = lazy(
	() => import('./features/skill-plans/routes/categories-management')
)

// Lazy load the User Bills feature for code splitting
const MyBillsPage = lazy(() => import('./features/bills/routes/my-bills'))
const BillDetailPage = lazy(() => import('./features/bills/routes/bill-detail'))

// Lazy load the SRP (Ship Replacement Program) feature for code splitting
const SRPIndex = lazy(() => import('./features/srp/routes/index'))
const SRPMyRequests = lazy(() => import('./features/srp/routes/my-requests'))
const SRPCreate = lazy(() => import('./features/srp/routes/create'))
const SRPRequestDetails = lazy(() => import('./features/srp/routes/request-detail'))
const SRPReview = lazy(() => import('./features/srp/routes/review'))
const SRPReviewDetail = lazy(() => import('./features/srp/routes/review-detail'))
const SRPPayments = lazy(() => import('./features/srp/routes/payments'))
const SRPPolicies = lazy(() => import('./features/srp/routes/policies'))

// Lazy load the Doctrines feature for code splitting
const DoctrinesIndex = lazy(() => import('./features/doctrines/routes/index'))
const DoctrineDetail = lazy(() => import('./features/doctrines/routes/doctrine-detail'))
const DoctrineCreate = lazy(() => import('./features/doctrines/routes/doctrine-create'))
const DoctrineEdit = lazy(() => import('./features/doctrines/routes/doctrine-edit'))
const FittingCreate = lazy(() => import('./features/doctrines/routes/fitting-create'))
const FittingDetail = lazy(() => import('./features/doctrines/routes/fitting-detail'))
const FittingEdit = lazy(() => import('./features/doctrines/routes/fitting-edit'))
const DoctrinesAdmin = lazy(() => import('./features/doctrines/routes/admin'))

// Lazy load the Freight Calculator feature for code splitting
const FreightCalculator = lazy(() => import('./features/freight/routes/index'))
const FreightManage = lazy(() => import('./features/freight/routes/manage'))
const FreightManageNew = lazy(() => import('./features/freight/routes/manage-new'))
const FreightManageEdit = lazy(() => import('./features/freight/routes/manage-edit'))
const FreightContracts = lazy(() => import('./features/freight/routes/contracts'))
const FreightLeaderboard = lazy(() => import('./features/freight/routes/leaderboard'))

// Create a client
const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 1000 * 60 * 5, // 5 minutes
			retry: 1,
			refetchOnWindowFocus: false,
		},
	},
})

// Component to handle session sync (fingerprinting)
function SessionSyncWrapper({ children }: { children: React.ReactNode }) {
	const { isAuthenticated } = useAuth()
	useSessionSync(isAuthenticated)
	useEffect(() => {
		installTaxDemoWindow(queryClient)
	}, [])
	return <>{children}</>
}

/**
 * Redirect old HR dashboard URLs to the new members page
 */
function HrDashboardRedirect() {
	const { corporationId } = useParams<{ corporationId: string }>()
	return <Navigate to={`/corporations/${corporationId}/members`} replace />
}

function NavigateToCorporationMembers() {
	const { corporationId } = useParams<{ corporationId: string }>()
	return <Navigate to={`/corporations/${corporationId}/members`} replace />
}

function NavigateToCorporationSettings() {
	const { corporationId } = useParams<{ corporationId: string }>()
	return <Navigate to={`/corporations/${corporationId}/settings`} replace />
}

export default function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<SessionSyncWrapper>
				<BrowserRouter>
					<Routes>
						{/* Public routes */}
						<Route path="/" element={<LandingPage />} />
						<Route path="/auth/callback" element={<AuthCallbackPage />} />
						<Route path="/discord/callback" element={<DiscordCallbackPage />} />
						<Route path="/legacy-auth/callback" element={<LegacyAuthCallbackPage />} />
						<Route path="/claim-main" element={<ClaimMainPage />} />

						{/* Protected routes with layout */}
						<Route element={<Layout />}>
							<Route path="/dashboard" element={<DashboardPage />} />
							<Route path="/character/:characterId" element={<CharacterDetailPage />} />
							<Route path="/groups" element={<GroupsPage />} />
							<Route path="/groups/:groupId" element={<GroupDetailPage />} />
							<Route path="/my-groups" element={<MyGroupsPage />} />

							{/* Join Corporations */}
							<Route
								path="/join"
								element={
									<Suspense fallback={<LoadingPage />}>
										<BrowseCorporations />
									</Suspense>
								}
							/>
							<Route
								path="/join/:corporationId"
								element={
									<Suspense fallback={<LoadingPage />}>
										<CorporationDetail />
									</Suspense>
								}
							/>

							{/* Corporations routes (canonical + management detail routes) */}
							<Route
								path="/corporations"
								element={
									<Suspense fallback={<LoadingPage />}>
										<CorporationsPage />
									</Suspense>
								}
							/>
							<Route
								path="/corporations/:corporationId/members"
								element={
									<Suspense fallback={<LoadingPage />}>
										<CorporationMembers />
									</Suspense>
								}
							/>
							<Route
								path="/corporations/:corporationId/settings"
								element={
									<Suspense fallback={<LoadingPage />}>
										<CorporationSettings />
									</Suspense>
								}
							/>
							{/* Legacy route redirects */}
							<Route path="/my-corporations" element={<Navigate to="/corporations" replace />} />
							<Route
								path="/my-corporations/:corporationId/members"
								element={<NavigateToCorporationMembers />}
							/>
							<Route
								path="/my-corporations/:corporationId/settings"
								element={<NavigateToCorporationSettings />}
							/>

							{/* Application routes - User views (lazy loaded) */}
							<Route
								path="/my-applications"
								element={
									<Suspense fallback={<LoadingPage />}>
										<MyApplicationsList />
									</Suspense>
								}
							/>
							<Route
								path="/my-applications/:applicationId"
								element={
									<Suspense fallback={<LoadingPage />}>
										<ApplicationDetail />
									</Suspense>
								}
							/>

							{/* Recommendations routes (corp members) */}
							<Route
								path="/recommendations"
								element={
									<Suspense fallback={<LoadingPage />}>
										<RecommendationsList />
									</Suspense>
								}
							/>

							{/* Application routes - HR views (lazy loaded) */}
							<Route
								path="/corporations/:corporationId/hr/dashboard"
								element={<HrDashboardRedirect />}
							/>
							<Route
								path="/corporations/:corporationId/applications"
								element={
									<Suspense fallback={<LoadingPage />}>
										<HrApplicationsList />
									</Suspense>
								}
							/>
							<Route
								path="/corporations/:corporationId/applications/:applicationId"
								element={
									<Suspense fallback={<LoadingPage />}>
										<HrApplicationReview />
									</Suspense>
								}
							/>
							<Route
								path="/corporations/:corporationId/hr/roles"
								element={
									<Suspense fallback={<LoadingPage />}>
										<HrRolesManagement />
									</Suspense>
								}
							/>
							<Route
								path="/corporations/:corporationId/members/:accountId"
								element={
									<Suspense fallback={<LoadingPage />}>
										<HrMemberProfile />
									</Suspense>
								}
							/>
							<Route
								path="/fulcrum/reports/:reportId"
								element={
									<Suspense fallback={<LoadingPage />}>
										<FulcrumReport />
									</Suspense>
								}
							/>
							<Route
								path="/hr/auditor/users"
								element={
									<Suspense fallback={<LoadingPage />}>
										<HrAuditorUsersPage />
									</Suspense>
								}
							/>
							<Route
								path="/hr/auditor/users/:userId"
								element={
									<Suspense fallback={<LoadingPage />}>
										<HrAuditorUserProfilePage />
									</Suspense>
								}
							/>
							<Route
								path="/hr/auditor/users/:userId/groups"
								element={
									<Suspense fallback={<LoadingPage />}>
										<HrAuditorUserGroupsPage />
									</Suspense>
								}
							/>
							<Route path="/invitations" element={<InvitationsPage />} />
							<Route path="/broadcasts" element={<BroadcastsPage />} />
							<Route path="/broadcasts/new" element={<BroadcastsNewPage />} />
							<Route path="/broadcasts/:broadcastId" element={<BroadcastDetailPage />} />

							{/* Utilities routes */}
							<Route path="/inventory-parser" element={<InventoryParserPage />} />

							{/* Skill Plans routes (lazy loaded) */}
							<Route
								path="/skill-plans"
								element={
									<Suspense fallback={<LoadingPage />}>
										<SkillPlansList />
									</Suspense>
								}
							/>
							<Route
								path="/skill-plans/my"
								element={
									<Suspense fallback={<LoadingPage />}>
										<MySkillPlans />
									</Suspense>
								}
							/>
							<Route
								path="/skill-plans/create"
								element={
									<Suspense fallback={<LoadingPage />}>
										<SkillPlanCreate />
									</Suspense>
								}
							/>
							<Route
								path="/skill-plans/categories/manage"
								element={
									<Suspense fallback={<LoadingPage />}>
										<CategoriesManagement />
									</Suspense>
								}
							/>
							<Route
								path="/skill-plans/:id/edit"
								element={
									<Suspense fallback={<LoadingPage />}>
										<SkillPlanEdit />
									</Suspense>
								}
							/>
							<Route
								path="/skill-plans/:id/progress/character/:characterId"
								element={
									<Suspense fallback={<LoadingPage />}>
										<SkillPlanProgress />
									</Suspense>
								}
							/>
							<Route
								path="/skill-plans/:id/progress"
								element={
									<Suspense fallback={<LoadingPage />}>
										<SkillPlanProgress />
									</Suspense>
								}
							/>
							<Route
								path="/skill-plans/:id"
								element={
									<Suspense fallback={<LoadingPage />}>
										<SkillPlanDetail />
									</Suspense>
								}
							/>

							{/* SRP (Ship Replacement Program) routes (lazy loaded) */}
							<Route
								path="/srp"
								element={
									<Suspense fallback={<LoadingPage />}>
										<SRPIndex />
									</Suspense>
								}
							/>
							<Route
								path="/srp/my-requests"
								element={
									<Suspense fallback={<LoadingPage />}>
										<SRPMyRequests />
									</Suspense>
								}
							/>
							<Route
								path="/srp/create"
								element={
									<Suspense fallback={<LoadingPage />}>
										<SRPCreate />
									</Suspense>
								}
							/>
							<Route
								path="/srp/request/:id"
								element={
									<Suspense fallback={<LoadingPage />}>
										<SRPRequestDetails />
									</Suspense>
								}
							/>
							<Route
								path="/srp/review"
								element={
									<Suspense fallback={<LoadingPage />}>
										<SRPReview />
									</Suspense>
								}
							/>
							<Route
								path="/srp/payments"
								element={
									<Suspense fallback={<LoadingPage />}>
										<SRPPayments />
									</Suspense>
								}
							/>
							<Route
								path="/srp/review/:id"
								element={
									<Suspense fallback={<LoadingPage />}>
										<SRPReviewDetail />
									</Suspense>
								}
							/>
							<Route
								path="/srp/policies"
								element={
									<Suspense fallback={<LoadingPage />}>
										<SRPPolicies />
									</Suspense>
								}
							/>

							{/* User Bills routes (lazy loaded) */}
							<Route
								path="/my-bills"
								element={
									<Suspense fallback={<LoadingPage />}>
										<MyBillsPage />
									</Suspense>
								}
							/>
							<Route
								path="/my-bills/:billId"
								element={
									<Suspense fallback={<LoadingPage />}>
										<BillDetailPage />
									</Suspense>
								}
							/>
							{taxRouteElements}

							{/* Doctrines routes (lazy loaded) */}
							<Route
								path="/doctrines"
								element={
									<Suspense fallback={<LoadingPage />}>
										<DoctrinesIndex />
									</Suspense>
								}
							/>
							<Route
								path="/doctrines/admin"
								element={
									<Suspense fallback={<LoadingPage />}>
										<DoctrinesAdmin />
									</Suspense>
								}
							/>
							<Route
								path="/doctrines/create"
								element={
									<Suspense fallback={<LoadingPage />}>
										<DoctrineCreate />
									</Suspense>
								}
							/>
							<Route
								path="/doctrines/:id"
								element={
									<Suspense fallback={<LoadingPage />}>
										<DoctrineDetail />
									</Suspense>
								}
							/>
							<Route
								path="/doctrines/:id/edit"
								element={
									<Suspense fallback={<LoadingPage />}>
										<DoctrineEdit />
									</Suspense>
								}
							/>
							<Route
								path="/doctrines/fittings/create"
								element={
									<Suspense fallback={<LoadingPage />}>
										<FittingCreate />
									</Suspense>
								}
							/>
							<Route
								path="/doctrines/fittings/:id"
								element={
									<Suspense fallback={<LoadingPage />}>
										<FittingDetail />
									</Suspense>
								}
							/>
							<Route
								path="/doctrines/fittings/:id/edit"
								element={
									<Suspense fallback={<LoadingPage />}>
										<FittingEdit />
									</Suspense>
								}
							/>

							{/* Freight Calculator route (lazy loaded) */}
							<Route
								path="/freight"
								element={
									<Suspense fallback={<LoadingPage />}>
										<FreightCalculator />
									</Suspense>
								}
							/>
							<Route
								path="/freight/manage"
								element={
									<Suspense fallback={<LoadingPage />}>
										<FreightManage />
									</Suspense>
								}
							/>
							<Route
								path="/freight/manage/new"
								element={
									<Suspense fallback={<LoadingPage />}>
										<FreightManageNew />
									</Suspense>
								}
							/>
							<Route
								path="/freight/manage/:id/edit"
								element={
									<Suspense fallback={<LoadingPage />}>
										<FreightManageEdit />
									</Suspense>
								}
							/>
							<Route
								path="/freight/contracts"
								element={
									<Suspense fallback={<LoadingPage />}>
										<FreightContracts />
									</Suspense>
								}
							/>
							<Route
								path="/freight/leaderboard"
								element={
									<Suspense fallback={<LoadingPage />}>
										<FreightLeaderboard />
									</Suspense>
								}
							/>
						</Route>

						{adminRouteElements}
					</Routes>
				</BrowserRouter>
			</SessionSyncWrapper>
		</QueryClientProvider>
	)
}
