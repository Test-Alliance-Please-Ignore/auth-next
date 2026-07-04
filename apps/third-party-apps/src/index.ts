import { OAuthProvider } from '@cloudflare/workers-oauth-provider'

import { THIRD_PARTY_APPS_OAUTH_PROVIDER_OPTIONS } from './oauth-api-handler'
import { ThirdPartyAppsWorkerEntrypoint } from './worker'

const oauthProvider = new OAuthProvider(THIRD_PARTY_APPS_OAUTH_PROVIDER_OPTIONS)

export { ThirdPartyAppsWorkerEntrypoint }
export { ThirdPartyAppQuota } from './quota'

export default oauthProvider
