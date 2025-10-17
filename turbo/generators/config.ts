import { NewDurableObjectAnswers, NewPackageAnswers, NewWorkerAnswers } from './answers'
import { getWorkerApps } from './helpers/get-worker-apps'
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

	plop.setGenerator('new-worker', {
		description: 'Create a new Cloudflare Worker using Hono',
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
					base: 'templates/fetch-worker',
					destination,
					templateFiles: [
						'templates/fetch-worker/**/**.hbs',
						'templates/fetch-worker/.eslintrc.cjs.hbs',
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
		description: 'Create a new Durable Object with interface package and implementation',
		prompts: [
			{
				type: 'input',
				name: 'name',
				message: 'name of Durable Object (e.g., "audit-log-store")',
				validate: nameValidator,
			},
			{
				type: 'input',
				name: 'description',
				message: 'brief description of what this Durable Object does',
			},
			{
				type: 'confirm',
				name: 'createNewWorker',
				message: 'Create a new worker for this Durable Object?',
				default: false,
			},
			{
				type: 'input',
				name: 'workerName',
				message: (answers: { createNewWorker: boolean }) =>
					answers.createNewWorker ? 'name of the new worker' : 'name of existing worker to use',
				when: (answers: { createNewWorker: boolean }) => {
					if (answers.createNewWorker) {
						return true
					}
					// Get list of existing workers
					const existingWorkers = getWorkerApps(
						(answers as { turbo: { paths: { root: string } } }).turbo.paths.root
					)
					if (existingWorkers.length === 0) {
						throw new Error('No existing workers found. Please create a worker first.')
					}
					return true
				},
				validate: (
					input: string,
					answers?: { createNewWorker: boolean; turbo: { paths: { root: string } } }
				) => {
					if (!input || input.trim().length === 0) {
						return 'Worker name is required'
					}
					if (answers && !answers.createNewWorker) {
						const existingWorkers = getWorkerApps(answers.turbo.paths.root)
						if (!existingWorkers.includes(input.trim())) {
							return `Worker "${input}" does not exist. Available workers: ${existingWorkers.join(', ')}`
						}
					}
					return true
				},
			},
			{
				type: 'confirm',
				name: 'addCrossWorkerBindings',
				message: 'Add bindings to other workers for cross-worker access?',
				default: false,
			},
			{
				type: 'checkbox',
				name: 'targetWorkers',
				message: 'Select workers to add bindings to',
				when: (answers: {
					addCrossWorkerBindings: boolean
					turbo: { paths: { root: string } }
					workerName: string
				}) => answers.addCrossWorkerBindings,
				choices: (answers: { turbo: { paths: { root: string } }; workerName: string }) => {
					const allWorkers = getWorkerApps(answers.turbo.paths.root)
					// Exclude the source worker
					return allWorkers.filter((w) => w !== answers.workerName)
				},
			},
		],
		actions: (data: unknown) => {
			const answers = NewDurableObjectAnswers.parse(data)
			process.chdir(answers.turbo.paths.root)

			const className = pascalText(answers.name)
			const fileName = slugifyText(answers.name)
			const packageDestination = `packages/${fileName}`
			const bindingName = `${className.toUpperCase().replace(/-/g, '_')}_STORE`

			const actions: PlopTypes.Actions = []

			// 1. Create interface package
			actions.push({
				type: 'addMany',
				base: 'templates/durable-object',
				destination: packageDestination,
				templateFiles: ['templates/durable-object/**/**.hbs'],
				data: { ...answers, workerName: answers.workerName },
			})

			// 2. Create DO implementation file
			actions.push({
				type: 'add',
				path: `apps/${answers.workerName}/src/${fileName}.ts`,
				templateFile: 'templates/durable-object-impl/do-name.ts.hbs',
				data: answers,
			})

			// 3. Update wrangler.jsonc with DO binding and migration
			actions.push({
				type: 'updateWranglerConfig',
				data: {
					workerName: answers.workerName,
					className,
					createNewWorker: answers.createNewWorker,
					turbo: answers.turbo,
				},
			})

			// 4. Update worker context.ts with DO namespace binding
			actions.push({
				type: 'updateWorkerContext',
				data: {
					workerName: answers.workerName,
					bindingName,
					turbo: answers.turbo,
				},
			})

			// 5. Update worker index.ts to export DO class
			actions.push({
				type: 'updateWorkerIndex',
				data: {
					workerName: answers.workerName,
					className,
					fileName,
					turbo: answers.turbo,
				},
			})

			// 6. Add cross-worker bindings if requested
			if (
				answers.addCrossWorkerBindings &&
				answers.targetWorkers &&
				answers.targetWorkers.length > 0
			) {
				actions.push({
					type: 'addCrossWorkerBindings',
					data: {
						workerName: answers.workerName,
						className,
						targetWorkers: answers.targetWorkers,
						bindingName,
						scriptName: answers.workerName,
						turbo: answers.turbo,
					},
				})
			}

			// 7. Fix deps and format
			actions.push({ type: 'fixDepsAndFormat' })

			// 8. Install dependencies
			actions.push({
				type: 'pnpmInstall',
				data: { ...answers, destination: packageDestination } satisfies PnpmInstallData,
			})

			return actions
		},
	})
}
