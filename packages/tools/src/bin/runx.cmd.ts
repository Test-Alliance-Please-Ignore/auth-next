import 'zx/globals'

import { program } from '@commander-js/extra-typings'
import { catchProcessError } from '@jahands/cli-tools/proc'

import { buildCmd } from '../cmd/build.cmd'
import { checkWorkersTypesCmd } from '../cmd/check-workers-types.cmd'
import { checkCmd } from '../cmd/check.cmd'
import { ciCmd } from '../cmd/ci.cmd'
import { devLocalCmd } from '../cmd/dev-local.cmd'
import { devCmd } from '../cmd/dev.cmd'
import { fixCmd } from '../cmd/fix.cmd'
import { shfmtCmd } from '../cmd/shfmt.cmd'
import { updateCmd } from '../cmd/update.cmd'
import { worktreeCmd } from '../cmd/worktree.cmd'

program
	.name('runx')
	.description('A CLI for scripts that automate this repo')

	// While `packages/tools/bin` scripts work well for simple tasks,
	// a typescript CLI is nicer for more complex things.

	.addCommand(checkWorkersTypesCmd)
	.addCommand(fixCmd)
	.addCommand(buildCmd)
	.addCommand(checkCmd)
	.addCommand(devCmd)
	.addCommand(devLocalCmd)
	.addCommand(ciCmd)
	.addCommand(updateCmd)
	.addCommand(shfmtCmd)
	.addCommand(worktreeCmd)

	// Don't hang for unresolved promises
	.hook('postAction', () => process.exit(0))
	.parseAsync()
	.catch(catchProcessError())
