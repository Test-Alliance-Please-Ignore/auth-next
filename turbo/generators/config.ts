import type { PlopTypes } from '@turbo/gen'

export default function generator(plop: PlopTypes.NodePlopAPI): void {
	// Generator for creating a new worker based on the core worker template
	plop.setGenerator('new-worker', {
		description: 'Create a new Cloudflare Worker with database support',
		prompts: [
			{
				type: 'input',
				name: 'name',
				message: 'What is the name of the worker?',
				validate: (input: string) => {
					if (!input) {
						return 'Worker name is required'
					}
					if (!/^[a-z0-9-]+$/.test(input)) {
						return 'Worker name must be lowercase and can only contain letters, numbers, and hyphens'
					}
					return true
				},
			},
		],
		actions: [
			// Copy all template files
			{
				type: 'addMany',
				destination: '{{ turbo.paths.root }}/apps/{{ name }}',
				templateFiles: 'templates/worker/**/*',
				base: 'templates/worker',
				globOptions: {
					dot: true,
				},
			},
			// Update Justfile to include new worker in database commands
			{
				type: 'modify',
				path: '{{ turbo.paths.root }}/Justfile',
				pattern: /(db-generate-all:\n(?:\s+cd apps\/\w+ && bun run db:generate\n)+)/,
				template: '$1  cd apps/{{ name }} && bun run db:generate\n',
			},
			{
				type: 'modify',
				path: '{{ turbo.paths.root }}/Justfile',
				pattern: /(db-push-all:\n(?:\s+cd apps\/\w+ && bun run db:push\n)+)/,
				template: '$1  cd apps/{{ name }} && bun run db:push\n',
			},
			{
				type: 'modify',
				path: '{{ turbo.paths.root }}/Justfile',
				pattern: /(db-migrate-all:\n(?:\s+cd apps\/\w+ && bun run db:migrate\n)+)/,
				template: '$1  cd apps/{{ name }} && bun run db:migrate\n',
			},
			// Install dependencies
			{
				type: 'custom-exec',
				command: 'pnpm install',
			},
			// Generate wrangler types
			{
				type: 'custom-exec',
				command: 'pnpm turbo -F {{ name }} fix:workers-types',
			},
			// Success message
			(answers) => {
				return `
✅ Worker "${answers.name}" created successfully!

Next steps:
  1. Configure your DATABASE_URL in the root .env file
  2. Define your database schema in apps/${answers.name}/src/db/schema.ts
  3. Generate migrations: just db-generate ${answers.name}
  4. Run migrations: just db-migrate ${answers.name}
  5. Start development: just dev -F ${answers.name}

Happy coding! 🚀
				`.trim()
			},
		],
	})

	// Generator for creating a new Durable Object with its own worker and shared package
	plop.setGenerator('new-durable-object', {
		description: 'Create a new Cloudflare Worker with Durable Object and shared package',
		prompts: [
			{
				type: 'input',
				name: 'name',
				message: 'What is the name of the Durable Object?',
				validate: (input: string) => {
					if (!input) {
						return 'Durable Object name is required'
					}
					if (!/^[a-z0-9-]+$/.test(input)) {
						return 'Name must be lowercase and can only contain letters, numbers, and hyphens'
					}
					return true
				},
			},
		],
		actions: [
			// Copy worker template files
			{
				type: 'addMany',
				destination: '{{ turbo.paths.root }}/apps/{{ name }}',
				templateFiles: 'templates/durable-object-worker/**/*',
				base: 'templates/durable-object-worker',
				globOptions: {
					dot: true,
				},
			},
			// Copy package template files
			{
				type: 'addMany',
				destination: '{{ turbo.paths.root }}/packages/{{ name }}',
				templateFiles: 'templates/durable-object-package/**/*',
				base: 'templates/durable-object-package',
				globOptions: {
					dot: true,
				},
			},
			// Update Justfile to include new worker in database commands
			{
				type: 'modify',
				path: '{{ turbo.paths.root }}/Justfile',
				pattern: /(db-generate-all:\n(?:\s+cd apps\/\w+ && bun run db:generate\n)+)/,
				template: '$1  cd apps/{{ name }} && bun run db:generate\n',
			},
			{
				type: 'modify',
				path: '{{ turbo.paths.root }}/Justfile',
				pattern: /(db-push-all:\n(?:\s+cd apps\/\w+ && bun run db:push\n)+)/,
				template: '$1  cd apps/{{ name }} && bun run db:push\n',
			},
			{
				type: 'modify',
				path: '{{ turbo.paths.root }}/Justfile',
				pattern: /(db-migrate-all:\n(?:\s+cd apps\/\w+ && bun run db:migrate\n)+)/,
				template: '$1  cd apps/{{ name }} && bun run db:migrate\n',
			},
			// Install dependencies
			{
				type: 'custom-exec',
				command: 'pnpm install',
			},
			// Generate wrangler types for the worker
			{
				type: 'custom-exec',
				command: 'pnpm turbo -F {{ name }} fix:workers-types',
			},
			// Success message
			(answers) => {
				return `
✅ Durable Object "${answers.name}" created successfully!

Created:
  📦 Worker: apps/${answers.name}
  📦 Package: packages/${answers.name} (@repo/${answers.name})

The worker includes:
  - Durable Object class with SQLite storage
  - WebSocket hibernation API handlers
  - RPC method examples
  - Alarm handler
  - PostgreSQL database support (Drizzle ORM)
  - Example integration tests

The package provides:
  - TypeScript interfaces for RPC methods
  - Type definitions for state and messages
  - Exports for use in other workers

Next steps:
  1. Configure your DATABASE_URL in the root .env file
  2. Define your database schema in apps/${answers.name}/src/db/schema.ts
  3. Customize the Durable Object in apps/${answers.name}/src/durable-object.ts
  4. Update RPC interface in packages/${answers.name}/src/index.ts
  5. Generate migrations: just db-generate ${answers.name}
  6. Run migrations: just db-migrate ${answers.name}
  7. Start development: just dev -F ${answers.name}

To use this Durable Object in other workers:
  1. Add dependency: pnpm -F other-worker add '@repo/${answers.name}@workspace:*'
  2. Add binding in wrangler.jsonc (see apps/${answers.name}/README.md)
  3. Import types: import type { ${answers.name} } from '@repo/${answers.name}'

Happy coding! 🚀
				`.trim()
			},
		],
	})

	// Generator for creating a new shared package
	plop.setGenerator('new-package', {
		description: 'Create a new shared utility package',
		prompts: [
			{
				type: 'input',
				name: 'name',
				message: 'What is the name of the package?',
				validate: (input: string) => {
					if (!input) {
						return 'Package name is required'
					}
					if (!/^[a-z0-9-]+$/.test(input)) {
						return 'Package name must be lowercase and can only contain letters, numbers, and hyphens'
					}
					return true
				},
			},
			{
				type: 'confirm',
				name: 'needsWorkers',
				message: 'Does this package need Cloudflare Workers support?',
				default: false,
			},
		],
		actions: [
			// Copy all template files
			{
				type: 'addMany',
				destination: '{{ turbo.paths.root }}/packages/{{ name }}',
				templateFiles: 'templates/package/**/*',
				base: 'templates/package',
				globOptions: {
					dot: true,
				},
			},
			// Conditionally copy wrangler.jsonc if Workers support is needed
			{
				type: 'add',
				path: '{{ turbo.paths.root }}/packages/{{ name }}/wrangler.jsonc',
				templateFile: 'templates/package/wrangler.jsonc',
				skip: (answers) => {
					if (!answers.needsWorkers) {
						return 'Skipping wrangler.jsonc (Workers support not needed)'
					}
					return false
				},
			},
			// Install dependencies
			{
				type: 'custom-exec',
				command: 'pnpm install',
			},
			// Generate wrangler types if Workers support is needed
			{
				type: 'custom-exec',
				command: 'pnpm turbo -F @repo/{{ name }} fix:workers-types',
				skip: (answers) => {
					if (!answers.needsWorkers) {
						return 'Skipping type generation (Workers support not needed)'
					}
					return false
				},
			},
			// Success message
			(answers) => {
				const workersInfo = answers.needsWorkers
					? `
  - Cloudflare Workers configuration (wrangler.jsonc)
  - Workers TypeScript types (worker-configuration.d.ts)`
					: ''

				const workersSteps = answers.needsWorkers
					? `
  5. Use Workers types: import { DurableObjectState, etc. } from '@cloudflare/workers-types'`
					: ''

				return `
✅ Package "@repo/${answers.name}" created successfully!

Created:
  📦 Package: packages/${answers.name}

The package includes:
  - TypeScript configuration
  - ESLint configuration
  - Vitest test setup
  - Example function and tests
  - README with usage instructions${workersInfo}

Next steps:
  1. Implement your utilities in packages/${answers.name}/src/index.ts
  2. Add tests in packages/${answers.name}/src/test/
  3. Run tests: pnpm -F @repo/${answers.name} test
  4. Add to other packages: pnpm -F your-worker add '@repo/${answers.name}@workspace:*'${workersSteps}

Happy coding! 🚀
				`.trim()
			},
		],
	})

	// Register custom action for running shell commands
	plop.setActionType('custom-exec', (answers, config) => {
		const { execSync } = require('child_process')
		const command = plop.renderString(config.command, answers)

		try {
			execSync(command, { stdio: 'inherit' })
			return `Executed: ${command}`
		} catch (error) {
			throw new Error(`Failed to execute: ${command}`)
		}
	})
}
