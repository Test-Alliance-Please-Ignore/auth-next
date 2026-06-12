/** Mumble account status as returned by the core API. */
export interface MumbleAccountStatus {
	subjectId: string
	loginName: string
	displayName: string
	enabled: boolean
	groups: string[]
	hasPassword: boolean
	lastAuthenticatedAt: string | null
}

/** Mumble server connection info. */
export interface MumbleConnectionInfo {
	host: string
	port: number
}

/** One-time credentials shown after provisioning or a password reset. */
export interface MumbleOneTimeCredentials {
	loginName: string
	password: string
	connection: MumbleConnectionInfo
}
