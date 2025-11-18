import 'dotenv/config'

import { defineConfig } from 'drizzle-kit'

export default defineConfig({
	out: './src/structure-monitor/.migrations',
	schema: './src/structure-monitor/schema.ts',
	dialect: 'sqlite',
	driver: 'durable-sqlite',
	verbose: true,
	strict: true,
})
