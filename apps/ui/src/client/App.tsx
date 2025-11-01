import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import Layout from './components/layout'
import { LoadingPage } from './components/ui/loading'
import AdminActivityLogPage from './routes/admin/activity-log'
import AdminBillsDashboardPage from './routes/admin/bills-dashboard'
import AdminBillsNewPage from './routes/admin/bills-new'
import AdminBillsPage from './routes/admin/bills'
import AdminBillsSchedulesEditPage from './routes/admin/bills-schedules-edit'
import AdminBillsSchedulesNewPage from './routes/admin/bills-schedules-new'
import AdminBillsSchedulesPage from './routes/admin/bills-schedules'
import AdminBillsTemplatesEditPage from './routes/admin/bills-templates-edit'
import AdminBillsTemplatesNewPage from './routes/admin/bills-templates-new'
import AdminBillsTemplatesPage from './routes/admin/bills-templates'
import AdminCategoriesPage from './routes/admin/categories'
import AdminCorporationDetailPage from './routes/admin/corporation-detail'
import AdminCorporationsPage from './routes/admin/corporations'
import AdminDiscordServersPage from './routes/admin/discord-servers'
import AdminGroupDetailPage from './routes/admin/group-detail'
import AdminGroupsPage from './routes/admin/groups'
// Admin routes
import AdminLayout from './routes/admin/layout'
import AdminPermissionCategoriesPage from './routes/admin/permissions/categories'
import AdminGlobalPermissionsPage from './routes/admin/permissions/global'
import AdminUserDetailPage from './routes/admin/user-detail'
import AdminUsersPage from './routes/admin/users'
import AdminBroadcastsPage from './routes/admin/broadcasts'
import AdminBroadcastTargetsPage from './routes/admin/broadcasts-targets'
import AdminBroadcastTemplatesPage from './routes/admin/broadcasts-templates'
import AuthCallbackPage from './routes/auth-callback'
import BroadcastsPage from './routes/broadcasts'
import BroadcastsNewPage from './routes/broadcasts-new'
import CharacterDetailPage from './routes/character-detail'
import ClaimMainPage from './routes/claim-main'
import BrowseCorporations from './routes/browse-corporations'
import DashboardPage from './routes/dashboard'
import DiscordCallbackPage from './routes/discord-callback'
import GroupDetailPage from './routes/group-detail'
// User-facing group routes
import GroupsPage from './routes/groups'
import InvitationsPage from './routes/invitations'
import LandingPage from './routes/landing'
import MyGroupsPage from './routes/my-groups'

// Lazy load the My Corporations feature for code splitting
const MyCorporationsList = lazy(() => import('./features/my-corporations/routes/my-corporations-list'))
const CorporationMembers = lazy(() => import('./features/my-corporations/routes/corporation-members'))
const CorporationSettings = lazy(() => import('./features/my-corporations/routes/corporation-settings'))

// Lazy load public corporation pages
const CorporationDetail = lazy(() => import('./routes/corporation-detail'))

// Lazy load the Applications feature for code splitting
const MyApplicationsList = lazy(() => import('./features/applications/routes/my-applications-list'))
const ApplicationDetail = lazy(() => import('./features/applications/routes/application-detail'))
const HrDashboard = lazy(() => import('./features/applications/routes/hr-dashboard'))
const HrApplicationsList = lazy(() => import('./features/applications/routes/hr-applications-list'))
const HrApplicationReview = lazy(() => import('./features/applications/routes/hr-application-review'))
const HrRolesManagement = lazy(() => import('./features/applications/routes/hr-roles-management'))
const UserHrNotes = lazy(() => import('./features/applications/routes/user-hr-notes'))

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

export default function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<BrowserRouter>
				<Routes>
					{/* Public routes */}
					<Route path="/" element={<LandingPage />} />
					<Route path="/auth/callback" element={<AuthCallbackPage />} />
					<Route path="/discord/callback" element={<DiscordCallbackPage />} />
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

						{/* Broadcast routes */}
						<Route path="broadcasts" element={<AdminBroadcastsPage />} />
						<Route path="broadcasts-targets" element={<AdminBroadcastTargetsPage />} />
						<Route path="broadcasts-templates" element={<AdminBroadcastTemplatesPage />} />
					</Route>
				</Routes>
			</BrowserRouter>
		</QueryClientProvider>
	)
}
