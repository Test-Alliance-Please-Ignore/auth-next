import { lazy, Suspense } from 'react'
import { Navigate, Route } from 'react-router-dom'

import { LoadingPage } from '@/components/ui/loading'
import AdminActivityLogPage from '@/routes/admin/activity-log'
import DevComponentsPage from '@/routes/admin/dev-components'
import AdminBillsPage from '@/routes/admin/bills'
import AdminBillsDashboardPage from '@/routes/admin/bills-dashboard'
import AdminBillsDetailPage from '@/routes/admin/bills-detail'
import AdminBillsEditPage from '@/routes/admin/bills-edit'
import AdminBillsGroupEditPage from '@/routes/admin/bills-group-edit'
import AdminBillsNewPage from '@/routes/admin/bills-new'
import AdminBillsSchedulesPage from '@/routes/admin/bills-schedules'
import AdminBillsSchedulesEditPage from '@/routes/admin/bills-schedules-edit'
import AdminBillsSchedulesNewPage from '@/routes/admin/bills-schedules-new'
import AdminBillsTemplatesPage from '@/routes/admin/bills-templates'
import AdminBillsTemplatesEditPage from '@/routes/admin/bills-templates-edit'
import AdminBillsTemplatesNewPage from '@/routes/admin/bills-templates-new'
import AdminBlacklistPage from '@/routes/admin/blacklist'
import AdminBroadcastDetailPage from '@/routes/admin/broadcast-detail'
import AdminBroadcastsPage from '@/routes/admin/broadcasts'
import AdminBroadcastTargetsPage from '@/routes/admin/broadcasts-targets'
import AdminBroadcastTemplatesPage from '@/routes/admin/broadcasts-templates'
import AdminCategoriesPage from '@/routes/admin/categories'
import AdminCorporationDetailPage from '@/routes/admin/corporation-detail'
import AdminCorporationsPage from '@/routes/admin/corporations'
import AdminDiscordCommandCategoriesPage from '@/routes/admin/discord-command-categories'
import AdminDiscordCommandsPage from '@/routes/admin/discord-commands'
import AdminDiscordServerCommandsPage from '@/routes/admin/discord-server-commands'
import AdminDiscordServerRolesPage from '@/routes/admin/discord-server-roles'
import AdminDiscordServersPage from '@/routes/admin/discord-servers'
import AdminDkpAwardsPage from '@/routes/admin/dkp-awards'
import AdminDkpDashboardPage from '@/routes/admin/dkp-dashboard'
import AdminDkpHistoryPage from '@/routes/admin/dkp-history'
import AdminDkpLeaderboardsPage from '@/routes/admin/dkp-leaderboards'
import AdminGroupDetailPage from '@/routes/admin/group-detail'
import AdminGroupsPage from '@/routes/admin/groups'
import AdminLayout from '@/routes/admin/layout'
import AdminPermissionCategoriesPage from '@/routes/admin/permissions/categories'
import AdminGlobalPermissionsPage from '@/routes/admin/permissions/global'
import AdminUserActivityPage from '@/routes/admin/user-activity'
import AdminUserDetailPage from '@/routes/admin/user-detail'
import AdminUserDiscordAccessPage from '@/routes/admin/user-discord-access'
import AdminUserGroupsPage from '@/routes/admin/user-groups'
import AdminUsersPage from '@/routes/admin/users'

const UserHrNotes = lazy(() => import('@/features/applications/routes/user-hr-notes'))
const IndustryProvidersPage = lazy(() => import('@/features/industry/routes/industry-providers'))
const IndustryProviderDetailPage = lazy(
	() => import('@/features/industry/routes/industry-provider-detail')
)
const IndustryProviderEditPage = lazy(
	() => import('@/features/industry/routes/industry-provider-edit')
)
const IndustryProviderNewPage = lazy(
	() => import('@/features/industry/routes/industry-provider-new')
)

export const adminRouteElements = (
	<Route path="/admin" element={<AdminLayout />}>
		<Route index element={<Navigate to="/admin/categories" replace />} />
		<Route path="categories" element={<AdminCategoriesPage />} />
		<Route path="groups" element={<AdminGroupsPage />} />
		<Route path="groups/:groupId" element={<AdminGroupDetailPage />} />
		<Route path="corporations" element={<AdminCorporationsPage />} />
		<Route path="corporations/:corporationId" element={<AdminCorporationDetailPage />} />
		<Route path="discord-servers" element={<AdminDiscordServersPage />} />
		<Route path="discord-servers/:serverId/roles" element={<AdminDiscordServerRolesPage />} />
		<Route path="discord-servers/:serverId/commands" element={<AdminDiscordServerCommandsPage />} />
		<Route path="discord-commands" element={<AdminDiscordCommandsPage />} />
		<Route path="discord-commands/categories" element={<AdminDiscordCommandCategoriesPage />} />
		<Route path="permissions/categories" element={<AdminPermissionCategoriesPage />} />
		<Route path="permissions/global" element={<AdminGlobalPermissionsPage />} />
		<Route path="users" element={<AdminUsersPage />} />
		<Route path="users/:userId" element={<AdminUserDetailPage />} />
		<Route path="users/:userId/discord-access" element={<AdminUserDiscordAccessPage />} />
		<Route path="users/:userId/groups" element={<AdminUserGroupsPage />} />
		<Route path="users/:userId/activity" element={<AdminUserActivityPage />} />
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
		<Route path="dev/components" element={<DevComponentsPage />} />

		<Route path="bills" element={<AdminBillsPage />} />
		<Route path="bills/new" element={<AdminBillsNewPage />} />
		<Route path="bills/dashboard" element={<AdminBillsDashboardPage />} />
		<Route path="bills/templates" element={<AdminBillsTemplatesPage />} />
		<Route path="bills/templates/new" element={<AdminBillsTemplatesNewPage />} />
		<Route path="bills/templates/:id" element={<AdminBillsTemplatesEditPage />} />
		<Route path="bills/schedules" element={<AdminBillsSchedulesPage />} />
		<Route path="bills/schedules/new" element={<AdminBillsSchedulesNewPage />} />
		<Route path="bills/schedules/:id" element={<AdminBillsSchedulesEditPage />} />
		<Route path="bills/group/:groupBillId/edit" element={<AdminBillsGroupEditPage />} />
		<Route path="bills/:billId/edit" element={<AdminBillsEditPage />} />
		<Route path="bills/:billId" element={<AdminBillsDetailPage />} />

		<Route path="broadcasts" element={<AdminBroadcastsPage />} />
		<Route path="broadcasts/:broadcastId" element={<AdminBroadcastDetailPage />} />
		<Route path="broadcasts-targets" element={<AdminBroadcastTargetsPage />} />
		<Route path="broadcasts-templates" element={<AdminBroadcastTemplatesPage />} />

		<Route path="dkp" element={<AdminDkpDashboardPage />} />
		<Route path="dkp/awards" element={<AdminDkpAwardsPage />} />
		<Route path="dkp/leaderboards" element={<AdminDkpLeaderboardsPage />} />
		<Route path="dkp/history" element={<AdminDkpHistoryPage />} />

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
)
