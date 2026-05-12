/* eslint-disable @typescript-eslint/consistent-type-imports */
type LocalEnv = import('./src/context').Env

declare namespace Cloudflare {
	interface Env extends LocalEnv {}
}
