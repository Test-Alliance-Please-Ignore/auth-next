import { EVETIME_PROGRAMMATIC_COMMAND } from './evetime'
import { HOW_PROGRAMMATIC_COMMAND } from './how'

import type { ProgrammaticCommandDefinition } from './types'

export { EVETIME_PROGRAMMATIC_COMMAND } from './evetime'
export { HOW_PROGRAMMATIC_COMMAND } from './how'
export type { ProgrammaticCommandDefinition } from './types'

export const PROGRAMMATIC_COMMAND_DEFINITIONS: ProgrammaticCommandDefinition[] = [
	EVETIME_PROGRAMMATIC_COMMAND,
	HOW_PROGRAMMATIC_COMMAND,
]

export const programmaticCommandDefinitionByName = new Map(
	PROGRAMMATIC_COMMAND_DEFINITIONS.map((definition) => [definition.name, definition])
)
