import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import Layout from './components/layout'
import AdminActivityLogPage from './routes/admin/activity-log'
import AdminCategoriesPage from './routes/admin/categories'
import AdminCorporationDetailPage from './routes/admin/corporation-detail'
import AdminCorporationsPage from './routes/admin/corporations'
import AdminDiscordServersPage from './routes/admin/discord-servers'
import AdminGroupDetailPage from './routes/admin/group-detail'
import AdminGroupsPage from './routes/admin/groups'
// Admin routes
import AdminLayout from './routes/admin/layout'
import AdminUserDetailPage from './routes/admin/user-detail'
import AdminUsersPage from './routes/admin/users'
import AuthCallbackPage from './routes/auth-callback'
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
						<Route path="users" element={<AdminUsersPage />} />
						<Route path="users/:userId" element={<AdminUserDetailPage />} />
						<Route path="activity-log" element={<AdminActivityLogPage />} />
					</Route>
				</Routes>
			</BrowserRouter>
		</QueryClientProvider>
	)
}
