import { defineConfig } from 'vitest/config'

import { glob } from '@repo/workspace-dependencies/zx'

export default defineConfig(async () => {
	// All vitest projects
	const projectConfigPaths = await glob(['{apps,packages}/*/vitest.config{,.node}.ts'])
	const hasCloudflareAccountId = Boolean(process.env.CLOUDFLARE_ACCOUNT_ID?.trim())
	const filteredProjects = hasCloudflareAccountId
		? projectConfigPaths
		: projectConfigPaths.filter((projectPath) => !projectPath.includes('apps/fulcrum/'))

	return {
		test: {
			projects: filteredProjects,
		},
	}
})
