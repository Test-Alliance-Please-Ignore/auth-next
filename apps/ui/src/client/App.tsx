import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import Layout from './components/layout'
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
import CreateGroupPage from './routes/create-group'
import DashboardPage from './routes/dashboard'
import DiscordCallbackPage from './routes/discord-callback'
import GroupDetailPage from './routes/group-detail'
// User-facing group routes
import GroupsPage from './routes/groups'
import InvitationsPage from './routes/invitations'
import LandingPage from './routes/landing'
import MyGroupsPage from './routes/my-groups'

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
						<Route path="/groups/create" element={<CreateGroupPage />} />
						<Route path="/groups/:groupId" element={<GroupDetailPage />} />
						<Route path="/my-groups" element={<MyGroupsPage />} />
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
