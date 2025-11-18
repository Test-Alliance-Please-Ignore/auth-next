#!/usr/bin/env node

import { program } from '@commander-js/extra-typings'

import { corpCommand } from './commands/corporations'
import { structCommand } from './commands/structures'

program
	.name('beancounter-cli')
	.description('CLI tool for managing beancounter corporations and structures')
	.version('0.1.0')

	.addCommand(corpCommand)
	.addCommand(structCommand)

	// Don't hang for unresolved promises
	.hook('postAction', () => process.exit(0))
	.parseAsync()
	.catch((error) => {
		console.error('Error:', error instanceof Error ? error.message : String(error))
		process.exit(1)
	})

