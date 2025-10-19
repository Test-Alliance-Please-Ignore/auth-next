import { NewDurableObjectAnswers, NewPackageAnswers, NewWorkerAnswers } from './answers'
import {
	pascalText,
	pascalTextPlural,
	pascalTextSingular,
	slugifyText,
	slugifyTextPlural,
	slugifyTextSingular,
} from './helpers/slugify'
import { nameValidator } from './helpers/validate'
import { fixAll } from './plugins/fix-all'
import { fixDepsAndFormat } from './plugins/fix-deps-and-format'
import { pnpmInstall } from './plugins/pnpm-install'
import { updateWorkerContextAction } from './plugins/update-worker-context'
import { updateWorkerIndexAction } from './plugins/update-worker-index'
import {
	addCrossWorkerBindingsAction,
	updateWranglerConfigAction,
} from './plugins/update-wrangler-config'

import type { PlopTypes } from '@turbo/gen'
import type { PnpmInstallData } from './plugins/pnpm-install'

export default function generator(plop: PlopTypes.NodePlopAPI): void {
	plop.setActionType('pnpmInstall', pnpmInstall as PlopTypes.CustomActionFunction)
	plop.setActionType('fixAll', fixAll as PlopTypes.CustomActionFunction)
	plop.setActionType('fixDepsAndFormat', fixDepsAndFormat as PlopTypes.CustomActionFunction)
	plop.setActionType('updateWranglerConfig', updateWranglerConfigAction)
	plop.setActionType('updateWorkerContext', updateWorkerContextAction)
	plop.setActionType('updateWorkerIndex', updateWorkerIndexAction)
	plop.setActionType('addCrossWorkerBindings', addCrossWorkerBindingsAction)

	plop.setHelper('slug', slugifyText)
	plop.setHelper('slug-s', slugifyTextSingular)
	plop.setHelper('slug-p', slugifyTextPlural)

	plop.setHelper('pascal', pascalText)
	plop.setHelper('pascal-s', pascalTextSingular)
	plop.setHelper('pascal-p', pascalTextPlural)

	plop.setGenerator('new-worker-vite', {
		description: 'Create a new Cloudflare Worker using Hono and Vite',
		// gather information from the user
		prompts: [
			{
				type: 'input',
				name: 'name',
				message: 'name of worker',
				validate: nameValidator,
			},
		],
		// perform actions based on the prompts
		actions: (data: unknown) => {
			const answers = NewWorkerAnswers.parse(data)
			process.chdir(answers.turbo.paths.root)
			const destination = `apps/${slugifyText(answers.name)}`

			const actions: PlopTypes.Actions = [
				{
					type: 'addMany',
					base: 'templates/fetch-worker-vite',
					destination,
					templateFiles: [
						'templates/fetch-worker-vite/**/**.hbs',
						'templates/fetch-worker-vite/.eslintrc.cjs.hbs',
					],
					data: answers,
				},
				{ type: 'pnpmInstall', data: { ...answers, destination } satisfies PnpmInstallData },
				{ type: 'fixAll' },
				{ type: 'pnpmInstall', data: { ...answers, destination } satisfies PnpmInstallData },
			]

			return actions
		},
	})

	plop.setGenerator('new-package', {
		description: 'Create a new shared package',
		prompts: [
			{
				type: 'input',
				name: 'name',
				message: 'name of package',
				validate: nameValidator,
			},
			{
				type: 'confirm',
				name: 'usedInWorkers',
				message: 'Will this package be used within Cloudflare Workers?',
				default: true,
			},
		],
		actions: (data: unknown) => {
			const answers = NewPackageAnswers.parse(data)
			process.chdir(answers.turbo.paths.root)
			const destination = `packages/${slugifyText(answers.name)}`

			const actions: PlopTypes.Actions = [
				{
					type: 'addMany',
					base: 'templates/package',
					destination,
					templateFiles: ['templates/package/**/**.hbs', 'templates/package/.eslintrc.cjs.hbs'],
					data: {
						...answers,
						tsconfigType: answers.usedInWorkers ? 'workers-lib.json' : 'lib.json',
					},
				},
				{ type: 'fixDepsAndFormat' },
				{ type: 'pnpmInstall', data: { ...answers, destination } satisfies PnpmInstallData },
			]

			return actions
		},
	})

	plop.setGenerator('new-durable-object', {
		description: 'Create a new SQLite-backed Durable Object in a new worker',
		prompts: [
			{
				type: 'input',
				name: 'name',
				message: 'Name (used for both worker and Durable Object)',
				validate: nameValidator,
			},
		],
		actions: (data: unknown) => {
			const answers = NewDurableObjectAnswers.parse(data)
			process.chdir(answers.turbo.paths.root)

			const className = pascalText(answers.name)
			const fileName = slugifyText(answers.name)
			const workerName = slugifyText(answers.name)
			const destination = `apps/${workerName}`
			const bindingName = className.toUpperCase().replace(/-/g, '_') + '_STORE'

			const actions: PlopTypes.Actions = [
				// Create new worker using the fetch-worker-vite template
				{
					type: 'addMany',
					base: 'templates/fetch-worker-vite',
					destination,
					templateFiles: [
						'templates/fetch-worker-vite/**/**.hbs',
						'templates/fetch-worker-vite/.eslintrc.cjs.hbs',
					],
					data: { name: answers.name, turbo: answers.turbo },
				},
				{
					type: 'pnpmInstall',
					data: {
						name: answers.name,
						destination,
						turbo: answers.turbo,
					} satisfies PnpmInstallData,
				},
				// Add the Durable Object class file
				{
					type: 'add',
					path: `${destination}/src/${fileName}.ts`,
					templateFile: 'templates/durable-object/durable-object.ts.hbs',
					data: { name: answers.name },
				},
				// Update worker files
				{
					type: 'updateWorkerIndex',
					data: {
						workerName,
						className,
						fileName,
						turbo: answers.turbo,
					},
				},
				{
					type: 'updateWorkerContext',
					data: {
						workerName,
						bindingName,
						turbo: answers.turbo,
					},
				},
				{
					type: 'updateWranglerConfig',
					data: {
						workerName,
						className,
						turbo: answers.turbo,
					},
				},
				// Fix and install
				{ type: 'fixAll' },
				{ type: 'pnpmInstall', data: { destination } satisfies PnpmInstallData },
			]

			return actions
		},
	})
}
