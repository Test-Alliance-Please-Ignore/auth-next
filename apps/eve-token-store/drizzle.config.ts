import 'dotenv/config'

import { defineConfig } from 'drizzle-kit'

export default defineConfig({
	schema: './src/db/schema.ts',
	out: './.migrations',
	dialect: 'postgresql',
	dbCredentials: {
		url: process.env.DATABASE_URL_MIGRATIONS!,
	},
	verbose: true,
	strict: true,
})
