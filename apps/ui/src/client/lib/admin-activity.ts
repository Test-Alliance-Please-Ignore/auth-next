import type { AppTranslationKey, AppTranslator } from '@/i18n'

const activityActionKeys: Partial<Record<string, AppTranslationKey>> = {
	login: 'admin.users.activity.actions.login',
	logout: 'admin.users.activity.actions.logout',
	character_linked: 'admin.users.activity.actions.character_linked',
	character_unlinked: 'admin.users.activity.actions.character_unlinked',
	character_primary_changed: 'admin.users.activity.actions.character_primary_changed',
	session_created: 'admin.users.activity.actions.session_created',
	session_expired: 'admin.users.activity.actions.session_expired',
	role_granted: 'admin.users.activity.actions.role_granted',
	role_revoked: 'admin.users.activity.actions.role_revoked',
	admin_user_deleted: 'admin.users.activity.actions.admin_user_deleted',
	admin_character_deleted: 'admin.users.activity.actions.admin_character_deleted',
	admin_character_transferred: 'admin.users.activity.actions.admin_character_transferred',
	admin_user_viewed: 'admin.users.activity.actions.admin_user_viewed',
	admin_character_viewed: 'admin.users.activity.actions.admin_character_viewed',
}

export function getActivityActionLabel(action: string, t: AppTranslator): string {
	return Object.hasOwn(activityActionKeys, action) ? t(activityActionKeys[action]!) : action
}
