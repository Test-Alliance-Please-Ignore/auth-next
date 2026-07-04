export const OAUTH_DISCOVERY_PATH = '/.well-known/oauth-authorization-server'
export const OAUTH_AUTHORIZE_PATH = '/authorize'
export const OAUTH_TOKEN_PATH = '/oauth/token'
export const OAUTH_API_PATH_PREFIX = '/oauth/api/'

export const OAUTH_INTERNAL_AUTHORIZE_PREVIEW_PATH = '/__internal/oauth/authorize/preview'
export const OAUTH_INTERNAL_AUTHORIZE_RESOLVE_PATH = '/__internal/oauth/authorize/resolve'

export function isOAuthHttpRoute(pathname: string): boolean {
	return (
		pathname === OAUTH_DISCOVERY_PATH ||
		pathname === OAUTH_AUTHORIZE_PATH ||
		pathname === OAUTH_TOKEN_PATH ||
		pathname.startsWith(OAUTH_API_PATH_PREFIX) ||
		pathname === OAUTH_INTERNAL_AUTHORIZE_PREVIEW_PATH ||
		pathname === OAUTH_INTERNAL_AUTHORIZE_RESOLVE_PATH
	)
}
