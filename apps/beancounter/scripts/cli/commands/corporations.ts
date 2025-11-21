import { program } from '@commander-js/extra-typings'
import Table from 'cli-table3'

import { corpDb } from '../db'

export const corpCommand = program
	.createCommand('corp')
	.alias('corporation')
	.description('Manage corporations')

corpCommand
	.command('list')
	.alias('ls')
	.description('List all corporations')
	.option('-j, --json', 'Output as JSON')
	.action(async (options) => {
		try {
			const corps = await corpDb.list()

			if (options.json) {
				console.log(JSON.stringify(corps, null, 2))
				return
			}

			if (corps.length === 0) {
				console.log('No corporations found.')
				return
			}

			const table = new Table({
				head: ['ID', 'Corp ID', 'Name', 'Ticker', 'Tracking', 'Min Fuel Hours'],
				colWidths: [36, 15, 30, 10, 10, 15],
			})

			for (const corp of corps) {
				table.push([
					corp.corporationId,
					corp.corporationId,
					corp.name || '-',
					corp.ticker || '-',
					corp.trackingEnabled ? '✓' : '✗',
					corp.minimumFuelHours.toString(),
				])
			}

			console.log(table.toString())
		} catch (error) {
			console.error('Error listing corporations:', error instanceof Error ? error.message : String(error))
			process.exit(1)
		}
	})

corpCommand
	.command('add')
	.description('Add a new corporation')
	.requiredOption('-i, --id <id>', 'Corporation ID (EVE corporation ID)')
	.option('-n, --name <name>', 'Corporation name')
	.option('-t, --ticker <ticker>', 'Corporation ticker')
	.option('--min-fuel-hours <hours>', 'Minimum fuel hours (default: 48)', '48')
	.option('--no-tracking', 'Disable tracking by default')
	.action(async (options) => {
		try {
			const existing = await corpDb.getByCorporationId(options.id)
			if (existing) {
				console.error(`Corporation with ID ${options.id} already exists`)
				process.exit(1)
			}

			const corp = await corpDb.create({
				corporationId: options.id,
				name: options.name || null,
				ticker: options.ticker || null,
				trackingEnabled: options.tracking !== false,
				minimumFuelHours: parseInt(options.minFuelHours, 10),
			})

			console.log('Corporation added successfully:')
			console.log(JSON.stringify(corp, null, 2))
		} catch (error) {
			console.error('Error adding corporation:', error instanceof Error ? error.message : String(error))
			process.exit(1)
		}
	})

corpCommand
	.command('update')
	.description('Update a corporation')
	.requiredOption('--id <id>', 'Corporation UUID')
	.option('-n, --name <name>', 'Corporation name')
	.option('-t, --ticker <ticker>', 'Corporation ticker')
	.option('--min-fuel-hours <hours>', 'Minimum fuel hours')
	.action(async (options) => {
		try {
			const updateData: Record<string, unknown> = {}
			if (options.name !== undefined) updateData.name = options.name
			if (options.ticker !== undefined) updateData.ticker = options.ticker
			if (options.minFuelHours !== undefined) {
				updateData.minimumFuelHours = parseInt(options.minFuelHours, 10)
			}

			if (Object.keys(updateData).length === 0) {
				console.error('No fields to update')
				process.exit(1)
			}

			const corp = await corpDb.update(options.id, updateData)
			console.log('Corporation updated successfully:')
			console.log(JSON.stringify(corp, null, 2))
		} catch (error) {
			console.error('Error updating corporation:', error instanceof Error ? error.message : String(error))
			process.exit(1)
		}
	})

corpCommand
	.command('delete')
	.alias('rm')
	.description('Delete a corporation')
	.requiredOption('--id <id>', 'Corporation UUID')
	.action(async (options) => {
		try {
			await corpDb.delete(options.id)
			console.log('Corporation deleted successfully')
		} catch (error) {
			console.error('Error deleting corporation:', error instanceof Error ? error.message : String(error))
			process.exit(1)
		}
	})

corpCommand
	.command('toggle')
	.description('Toggle tracking for a corporation')
	.requiredOption('--id <id>', 'Corporation UUID')
	.action(async (options) => {
		try {
			const corp = await corpDb.toggleTracking(options.id)
			console.log(`Tracking ${corp.trackingEnabled ? 'enabled' : 'disabled'} for corporation`)
			console.log(JSON.stringify(corp, null, 2))
		} catch (error) {
			console.error('Error toggling tracking:', error instanceof Error ? error.message : String(error))
			process.exit(1)
		}
	})

