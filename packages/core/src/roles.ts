export const SERVICE_CORE = 'urn:service:core'

export const ROLE_CORE_ADMIN = `${SERVICE_CORE}:role:admin`

export const CORE_ROLES = [ROLE_CORE_ADMIN] as const
export type CoreRoleUrn = (typeof CORE_ROLES)[number]
