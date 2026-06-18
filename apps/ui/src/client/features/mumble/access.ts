import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'

type RoleAwareUser = {
	roles?: string[] | null
}

export const MUMBLE_ALLIANCE_MEMBER_ROLE = ROLE_CORE_ALLIANCE_MEMBER

export function canAccessMumble(user: RoleAwareUser | null | undefined): boolean {
	return !!user?.roles?.includes(MUMBLE_ALLIANCE_MEMBER_ROLE)
}
