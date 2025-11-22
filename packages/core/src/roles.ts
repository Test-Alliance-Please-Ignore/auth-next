export const SERVICE_CORE = 'urn:service:core'

export const ROLE_CORE_ADMIN = `${SERVICE_CORE}:role:admin`
export const ROLE_CORE_CORP_MEMBER = `${SERVICE_CORE}:role:corp-member`
export const ROLE_CORE_CORP_CEO = `${SERVICE_CORE}:role:corp-ceo`
export const ROLE_CORE_ALLIANCE_MEMBER = `${SERVICE_CORE}:role:alliance-member`

export const CORE_ROLES = [
	ROLE_CORE_ADMIN,
	ROLE_CORE_CORP_MEMBER,
	ROLE_CORE_CORP_CEO,
	ROLE_CORE_ALLIANCE_MEMBER,
] as const
export type CoreRoleUrn = (typeof CORE_ROLES)[number]
