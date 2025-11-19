import 'dotenv/config'

import { defineConfig } from 'drizzle-kit'

export default defineConfig({
	out: './src/storage/migrations',
	schema: './src/storage/schema.ts',
	dialect: 'sqlite',
	driver: 'durable-sqlite',
	verbose: true,
	strict: true,
})
