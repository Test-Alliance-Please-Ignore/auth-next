import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import Layout from './components/layout'
import AuthCallbackPage from './routes/auth-callback'
import CharacterDetailPage from './routes/character-detail'
import ClaimMainPage from './routes/claim-main'
import DashboardPage from './routes/dashboard'
import DiscordCallbackPage from './routes/discord-callback'
import LandingPage from './routes/landing'

// User-facing group routes
import GroupsPage from './routes/groups'
import CreateGroupPage from './routes/create-group'
import GroupDetailPage from './routes/group-detail'
import MyGroupsPage from './routes/my-groups'
import InvitationsPage from './routes/invitations'

// Admin routes
import AdminLayout from './routes/admin/layout'
import AdminCategoriesPage from './routes/admin/categories'
import AdminGroupsPage from './routes/admin/groups'
import AdminGroupDetailPage from './routes/admin/group-detail'

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
					</Route>
				</Routes>
			</BrowserRouter>
		</QueryClientProvider>
	)
}
