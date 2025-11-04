/**
 * Type augmentation for cloudflare:test module
 * This makes the test env include our worker's bindings
 */

import type { Env } from '../context'

declare module 'cloudflare:test' {
	interface ProvidedEnv extends Env {}
}
