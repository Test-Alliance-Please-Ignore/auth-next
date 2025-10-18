import { defineConfig } from 'drizzle-kit'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: '../../../../.env' })

export default defineConfig({
	schema: './src/db/schema.ts',
	out: './src/db/migrations',
	dialect: 'postgresql',
	dbCredentials: {
		url: process.env.NEON_DATABASE_URL!,
	},
	// Only manage core_ prefixed tables
	tablesFilter: ['core_*'],
	verbose: true,
	strict: true
})