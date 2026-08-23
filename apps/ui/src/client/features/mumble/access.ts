import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'

type RoleAwareUser = {
	is_admin?: boolean
	roles?: string[] | null
}

export const MUMBLE_ALLIANCE_MEMBER_ROLE = ROLE_CORE_ALLIANCE_MEMBER

export function canAccessMumble(user: RoleAwareUser | null | undefined): boolean {
	return user?.is_admin === true || !!user?.roles?.includes(MUMBLE_ALLIANCE_MEMBER_ROLE)
}
