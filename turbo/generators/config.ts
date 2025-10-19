import { NewDurableObjectAnswers, NewPackageAnswers, NewWorkerAnswers } from './answers'
import {
	pascalText,
	pascalTextPlural,
	pascalTextSingular,
	slugifyText,
	slugifyTextPlural,
	slugifyTextSingular,
} from './helpers/slugify'
import { getWorkerApps } from './helpers/get-worker-apps'
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
		description: 'Create a new SQLite-backed Durable Object',
		prompts: [
			{
				type: 'input',
				name: 'name',
				message: 'Name of Durable Object (e.g., "chat-room", "user-session")',
				validate: nameValidator,
			},
			{
				type: 'list',
				name: 'createNewWorker',
				message: 'Create a new worker or add to existing worker?',
				choices: [
					{ name: 'Create new worker', value: true },
					{ name: 'Add to existing worker', value: false },
				],
				default: true,
			},
			{
				type: 'list',
				name: 'workerName',
				message: 'Which worker?',
				choices: (answers: { turbo: { paths: { root: string } } }) => {
					const workers = getWorkerApps(answers.turbo.paths.root)
					return workers.map((w) => ({ name: w, value: w }))
				},
				when: (answers: { createNewWorker: boolean }) => !answers.createNewWorker,
			},
			{
				type: 'input',
				name: 'workerName',
				message: 'Name of new worker',
				validate: nameValidator,
				when: (answers: { createNewWorker: boolean }) => answers.createNewWorker,
			},
		],
		actions: (data: unknown) => {
			const answers = NewDurableObjectAnswers.parse(data)
			process.chdir(answers.turbo.paths.root)

			const className = pascalText(answers.name)
			const fileName = slugifyText(answers.name)
			const workerName = slugifyText(answers.workerName)
			const destination = `apps/${workerName}`
			const bindingName = className.toUpperCase().replace(/-/g, '_') + '_STORE'

			const actions: PlopTypes.Actions = []

			// If creating new worker, use the new-worker-vite generator
			if ((data as { createNewWorker: boolean }).createNewWorker) {
				actions.push(
					{
						type: 'addMany',
						base: 'templates/fetch-worker-vite',
						destination,
						templateFiles: [
							'templates/fetch-worker-vite/**/**.hbs',
							'templates/fetch-worker-vite/.eslintrc.cjs.hbs',
						],
						data: { name: answers.workerName, turbo: answers.turbo },
					},
					{
						type: 'pnpmInstall',
						data: { name: answers.workerName, destination, turbo: answers.turbo } satisfies PnpmInstallData,
					}
				)
			}

			// Add the Durable Object class file
			actions.push({
				type: 'add',
				path: `${destination}/src/${fileName}.ts`,
				templateFile: 'templates/durable-object/durable-object.ts.hbs',
				data: { name: answers.name },
			})

			// Update worker files
			actions.push(
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
						createNewWorker: (data as { createNewWorker: boolean }).createNewWorker,
						turbo: answers.turbo,
					},
				}
			)

			// Fix and install
			actions.push({ type: 'fixAll' }, { type: 'pnpmInstall', data: { destination } satisfies PnpmInstallData })

			return actions
		},
	})
}
