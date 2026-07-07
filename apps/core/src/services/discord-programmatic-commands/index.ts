import { EVETIME_PROGRAMMATIC_COMMAND } from './evetime'
import { HOW_PROGRAMMATIC_COMMAND } from './how'
import { MARKET_PROGRAMMATIC_COMMAND } from './market'
import { PING_SLOW_PROGRAMMATIC_COMMAND } from './ping-slow'

import type { ProgrammaticCommandDefinition } from './types'

export { EVETIME_PROGRAMMATIC_COMMAND } from './evetime'
export { HOW_PROGRAMMATIC_COMMAND } from './how'
export { MARKET_PROGRAMMATIC_COMMAND } from './market'
export { PING_SLOW_PROGRAMMATIC_COMMAND } from './ping-slow'
export type { DeferralMode, ProgrammaticCommandDefinition } from './types'

export const PROGRAMMATIC_COMMAND_DEFINITIONS: ProgrammaticCommandDefinition[] = [
	EVETIME_PROGRAMMATIC_COMMAND,
	HOW_PROGRAMMATIC_COMMAND,
	MARKET_PROGRAMMATIC_COMMAND,
	PING_SLOW_PROGRAMMATIC_COMMAND,
]

export const programmaticCommandDefinitionByName = new Map(
	PROGRAMMATIC_COMMAND_DEFINITIONS.map((definition) => [definition.name, definition])
)
