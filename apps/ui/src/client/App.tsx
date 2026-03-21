import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import Layout from './components/layout'
import { LoadingPage } from './components/ui/loading'
import { installTaxDemoWindow } from './dev/tax-demo-mode'
import { useAuth } from './hooks/useAuth'
import { useSessionSync } from './hooks/useSessionSync'
import AdminActivityLogPage from './routes/admin/activity-log'
import AdminBillsPage from './routes/admin/bills'
import AdminBillsDashboardPage from './routes/admin/bills-dashboard'
import AdminBillsDetailPage from './routes/admin/bills-detail'
import AdminBillsNewPage from './routes/admin/bills-new'
import AdminBillsSchedulesPage from './routes/admin/bills-schedules'
import AdminBillsSchedulesEditPage from './routes/admin/bills-schedules-edit'
import AdminBillsSchedulesNewPage from './routes/admin/bills-schedules-new'
import AdminBillsTemplatesPage from './routes/admin/bills-templates'
import AdminBillsTemplatesEditPage from './routes/admin/bills-templates-edit'
import AdminBillsTemplatesNewPage from './routes/admin/bills-templates-new'
import AdminBlacklistPage from './routes/admin/blacklist'
import AdminBroadcastsPage from './routes/admin/broadcasts'
import AdminBroadcastTargetsPage from './routes/admin/broadcasts-targets'
import AdminBroadcastTemplatesPage from './routes/admin/broadcasts-templates'
import AdminCategoriesPage from './routes/admin/categories'
import AdminCorporationDetailPage from './routes/admin/corporation-detail'
import AdminCorporationsPage from './routes/admin/corporations'
import AdminDiscordServersPage from './routes/admin/discord-servers'
import AdminDkpAwardsPage from './routes/admin/dkp-awards'
import AdminDkpDashboardPage from './routes/admin/dkp-dashboard'
import AdminDkpHistoryPage from './routes/admin/dkp-history'
import AdminDkpLeaderboardsPage from './routes/admin/dkp-leaderboards'
import AdminFreightRoutesPage from './routes/admin/freight-routes'
import AdminFreightRoutesEditPage from './routes/admin/freight-routes-edit'
import AdminFreightRoutesNewPage from './routes/admin/freight-routes-new'
import AdminGroupDetailPage from './routes/admin/group-detail'
import AdminGroupsPage from './routes/admin/groups'
// Admin routes
import AdminLayout from './routes/admin/layout'
import AdminPermissionCategoriesPage from './routes/admin/permissions/categories'
import AdminGlobalPermissionsPage from './routes/admin/permissions/global'
import AdminUserDetailPage from './routes/admin/user-detail'
import AdminUsersPage from './routes/admin/users'
import AuthCallbackPage from './routes/auth-callback'
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

// Lazy load the My Corporations feature for code splitting
const MyCorporationsList = lazy(
	() => import('./features/my-corporations/routes/my-corporations-list')
)
const CorporationMembers = lazy(
	() => import('./features/my-corporations/routes/corporation-members')
)
const CorporationSettings = lazy(
	() => import('./features/my-corporations/routes/corporation-settings')
)

// Lazy load public corporation pages
const CorporationDetail = lazy(() => import('./routes/corporation-detail'))

// Lazy load the Applications feature for code splitting
const MyApplicationsList = lazy(() => import('./features/applications/routes/my-applications-list'))
const ApplicationDetail = lazy(() => import('./features/applications/routes/application-detail'))
const HrDashboard = lazy(() => import('./features/applications/routes/hr-dashboard'))
const HrApplicationsList = lazy(() => import('./features/applications/routes/hr-applications-list'))
const HrApplicationReview = lazy(
	() => import('./features/applications/routes/hr-application-review')
)
const HrRolesManagement = lazy(() => import('./features/applications/routes/hr-roles-management'))
const UserHrNotes = lazy(() => import('./features/applications/routes/user-hr-notes'))

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
const TaxAlertsPage = lazy(() => import('./routes/tax-alerts'))
const TaxAuditLogPage = lazy(() => import('./routes/tax-audit-log'))
const TaxBillsPage = lazy(() => import('./routes/tax-bills'))
const TaxLedgerPage = lazy(() => import('./routes/tax-ledger'))
const TaxMemberSummaryPage = lazy(() => import('./routes/tax-member-summary'))
const TaxReportsPage = lazy(() => import('./routes/tax-reports'))
const TaxRulesPage = lazy(() => import('./routes/tax-settings'))

// Lazy load the SRP (Ship Replacement Program) feature for code splitting
const SRPIndex = lazy(() => import('./features/srp/routes/index'))
const SRPMyRequests = lazy(() => import('./features/srp/routes/my-requests'))
const SRPCreate = lazy(() => import('./features/srp/routes/create'))
const SRPRequestDetails = lazy(() => import('./features/srp/routes/request.$id'))
const SRPReview = lazy(() => import('./features/srp/routes/review'))
const SRPPayments = lazy(() => import('./features/srp/routes/payments'))

// Lazy load the Doctrines feature for code splitting
const DoctrinesIndex = lazy(() => import('./features/doctrines/routes/index'))
const DoctrineDetail = lazy(() => import('./features/doctrines/routes/doctrine-detail'))
const DoctrineCreate = lazy(() => import('./features/doctrines/routes/doctrine-create'))
const DoctrineEdit = lazy(() => import('./features/doctrines/routes/doctrine-edit'))
const FittingCreate = lazy(() => import('./features/doctrines/routes/fitting-create'))
const FittingDetail = lazy(() => import('./features/doctrines/routes/fitting-detail'))
const FittingEdit = lazy(() => import('./features/doctrines/routes/fitting-edit'))

// Lazy load the Industry Providers feature for code splitting
const IndustryProvidersPage = lazy(() => import('./features/industry/routes/industry-providers'))
const IndustryProviderDetailPage = lazy(
	() => import('./features/industry/routes/industry-provider-detail')
)
const IndustryProviderEditPage = lazy(
	() => import('./features/industry/routes/industry-provider-edit')
)
const IndustryProviderNewPage = lazy(
	() => import('./features/industry/routes/industry-provider-new')
)

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

							{/* My Corporations routes (lazy loaded) */}
							<Route
								path="/my-corporations"
								element={
									<Suspense fallback={<LoadingPage />}>
										<MyCorporationsList />
									</Suspense>
								}
							/>
							<Route
								path="/my-corporations/:corporationId/members"
								element={
									<Suspense fallback={<LoadingPage />}>
										<CorporationMembers />
									</Suspense>
								}
							/>
							<Route
								path="/my-corporations/:corporationId/settings"
								element={
									<Suspense fallback={<LoadingPage />}>
										<CorporationSettings />
									</Suspense>
								}
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

							{/* Application routes - HR views (lazy loaded) */}
							<Route
								path="/corporations/:corporationId/hr/dashboard"
								element={
									<Suspense fallback={<LoadingPage />}>
										<HrDashboard />
									</Suspense>
								}
							/>
							<Route
								path="/corporations/:corporationId/hr/applications"
								element={
									<Suspense fallback={<LoadingPage />}>
										<HrApplicationsList />
									</Suspense>
								}
							/>
							<Route
								path="/corporations/:corporationId/hr/applications/:applicationId"
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

							<Route path="/invitations" element={<InvitationsPage />} />
							<Route path="/broadcasts" element={<BroadcastsPage />} />
							<Route path="/broadcasts/new" element={<BroadcastsNewPage />} />

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
							<Route path="/tax" element={<Navigate to="/tax/member-summary" replace />} />
							<Route
								path="/tax/alerts"
								element={
									<Suspense fallback={<LoadingPage />}>
										<TaxAlertsPage />
									</Suspense>
								}
							/>
							<Route
								path="/tax/member-summary"
								element={
									<Suspense fallback={<LoadingPage />}>
										<TaxMemberSummaryPage />
									</Suspense>
								}
							/>
							<Route path="/tax/settings" element={<Navigate to="/tax/rules" replace />} />
							<Route
								path="/tax/rules"
								element={
									<Suspense fallback={<LoadingPage />}>
										<TaxRulesPage />
									</Suspense>
								}
							/>
							<Route
								path="/tax/audit-log"
								element={
									<Suspense fallback={<LoadingPage />}>
										<TaxAuditLogPage />
									</Suspense>
								}
							/>
							<Route
								path="/tax/bills"
								element={
									<Suspense fallback={<LoadingPage />}>
										<TaxBillsPage />
									</Suspense>
								}
							/>
							<Route
								path="/tax/ledger"
								element={
									<Suspense fallback={<LoadingPage />}>
										<TaxLedgerPage />
									</Suspense>
								}
							/>
							<Route
								path="/tax/reports"
								element={
									<Suspense fallback={<LoadingPage />}>
										<TaxReportsPage />
									</Suspense>
								}
							/>

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
						</Route>

						{/* Admin routes */}
						<Route path="/admin" element={<AdminLayout />}>
							<Route index element={<Navigate to="/admin/categories" replace />} />
							<Route path="categories" element={<AdminCategoriesPage />} />
							<Route path="groups" element={<AdminGroupsPage />} />
							<Route path="groups/:groupId" element={<AdminGroupDetailPage />} />
							<Route path="corporations" element={<AdminCorporationsPage />} />
							<Route path="corporations/:corporationId" element={<AdminCorporationDetailPage />} />
							<Route path="discord-servers" element={<AdminDiscordServersPage />} />
							<Route path="permissions/categories" element={<AdminPermissionCategoriesPage />} />
							<Route path="permissions/global" element={<AdminGlobalPermissionsPage />} />
							<Route path="users" element={<AdminUsersPage />} />
							<Route path="users/:userId" element={<AdminUserDetailPage />} />
							<Route
								path="users/:userId/hr-notes"
								element={
									<Suspense fallback={<LoadingPage />}>
										<UserHrNotes />
									</Suspense>
								}
							/>
							<Route path="blacklist" element={<AdminBlacklistPage />} />
							<Route path="activity-log" element={<AdminActivityLogPage />} />

							{/* Bills routes */}
							<Route path="bills" element={<AdminBillsPage />} />
							<Route path="bills/new" element={<AdminBillsNewPage />} />
							<Route path="bills/dashboard" element={<AdminBillsDashboardPage />} />
							<Route path="bills/templates" element={<AdminBillsTemplatesPage />} />
							<Route path="bills/templates/new" element={<AdminBillsTemplatesNewPage />} />
							<Route path="bills/templates/:id" element={<AdminBillsTemplatesEditPage />} />
							<Route path="bills/schedules" element={<AdminBillsSchedulesPage />} />
							<Route path="bills/schedules/new" element={<AdminBillsSchedulesNewPage />} />
							<Route path="bills/schedules/:id" element={<AdminBillsSchedulesEditPage />} />
							<Route path="bills/:billId" element={<AdminBillsDetailPage />} />

							{/* Broadcast routes */}
							<Route path="broadcasts" element={<AdminBroadcastsPage />} />
							<Route path="broadcasts-targets" element={<AdminBroadcastTargetsPage />} />
							<Route path="broadcasts-templates" element={<AdminBroadcastTemplatesPage />} />

							{/* DKP routes */}
							<Route path="dkp" element={<AdminDkpDashboardPage />} />
							<Route path="dkp/awards" element={<AdminDkpAwardsPage />} />
							<Route path="dkp/leaderboards" element={<AdminDkpLeaderboardsPage />} />
							<Route path="dkp/history" element={<AdminDkpHistoryPage />} />

							{/* Freight routes */}
							<Route path="freight-routes" element={<AdminFreightRoutesPage />} />
							<Route path="freight-routes/new" element={<AdminFreightRoutesNewPage />} />
							<Route path="freight-routes/:id/edit" element={<AdminFreightRoutesEditPage />} />

							{/* Industry Providers routes */}
							<Route
								path="industry-providers"
								element={
									<Suspense fallback={<LoadingPage />}>
										<IndustryProvidersPage />
									</Suspense>
								}
							/>
							<Route
								path="industry-providers/new"
								element={
									<Suspense fallback={<LoadingPage />}>
										<IndustryProviderNewPage />
									</Suspense>
								}
							/>
							<Route
								path="industry-providers/:providerId"
								element={
									<Suspense fallback={<LoadingPage />}>
										<IndustryProviderDetailPage />
									</Suspense>
								}
							/>
							<Route
								path="industry-providers/:providerId/edit"
								element={
									<Suspense fallback={<LoadingPage />}>
										<IndustryProviderEditPage />
									</Suspense>
								}
							/>
						</Route>
					</Routes>
				</BrowserRouter>
			</SessionSyncWrapper>
		</QueryClientProvider>
	)
}
