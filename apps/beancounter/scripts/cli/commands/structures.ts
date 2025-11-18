import { program } from '@commander-js/extra-typings'
import Table from 'cli-table3'

import { structDb, corpDb } from '../db'

export const structCommand = program
	.createCommand('struct')
	.alias('structure')
	.description('Manage structures')

structCommand
	.command('list')
	.alias('ls')
	.description('List structures')
	.option('-c, --corp <corpId>', 'Filter by corporation ID (EVE corporation ID)')
	.option('-j, --json', 'Output as JSON')
	.action(async (options) => {
		try {
			const structs = await structDb.list(options.corp)

			if (options.json) {
				console.log(JSON.stringify(structs, null, 2))
				return
			}

			if (structs.length === 0) {
				console.log('No structures found.')
				return
			}

			const table = new Table({
				head: ['ID', 'Structure ID', 'Name', 'Type ID', 'System ID', 'Monitoring', 'Fuel Expires'],
				colWidths: [36, 15, 30, 12, 12, 12, 20],
			})

			for (const struct of structs) {
				table.push([
					struct.id,
					struct.structureId,
					struct.name || '-',
					struct.typeId || '-',
					struct.solarSystemId || '-',
					struct.monitoringEnabled ? '✓' : '✗',
					struct.fuelExpiresAt ? new Date(struct.fuelExpiresAt).toISOString() : '-',
				])
			}

			console.log(table.toString())
		} catch (error) {
			console.error('Error listing structures:', error instanceof Error ? error.message : String(error))
			process.exit(1)
		}
	})

structCommand
	.command('add')
	.description('Add a new structure')
	.requiredOption('--corp-id <corpId>', 'Corporation ID (EVE corporation ID)')
	.requiredOption('-i, --id <id>', 'Structure ID (EVE structure ID)')
	.option('-n, --name <name>', 'Structure name')
	.option('--type-id <typeId>', 'Structure type ID')
	.option('--system-id <systemId>', 'Solar system ID')
	.option('--profile-id <profileId>', 'Profile ID')
	.option('--no-monitoring', 'Disable monitoring by default')
	.action(async (options) => {
		try {
			const corp = await corpDb.getByCorporationId(options.corpId)
			if (!corp) {
				console.error(`Corporation with ID ${options.corpId} not found`)
				process.exit(1)
			}

			const existing = await structDb.getByStructureId(options.id)
			if (existing) {
				console.error(`Structure with ID ${options.id} already exists`)
				process.exit(1)
			}

			const struct = await structDb.create({
				corporationId: corp.id,
				structureId: options.id,
				name: options.name || null,
				typeId: options.typeId || null,
				solarSystemId: options.systemId || null,
				profileId: options.profileId || null,
				monitoringEnabled: options.monitoring !== false,
			})

			console.log('Structure added successfully:')
			console.log(JSON.stringify(struct, null, 2))
		} catch (error) {
			console.error('Error adding structure:', error instanceof Error ? error.message : String(error))
			process.exit(1)
		}
	})

structCommand
	.command('update')
	.description('Update a structure')
	.requiredOption('--id <id>', 'Structure UUID')
	.option('-n, --name <name>', 'Structure name')
	.option('--type-id <typeId>', 'Structure type ID')
	.option('--system-id <systemId>', 'Solar system ID')
	.option('--profile-id <profileId>', 'Profile ID')
	.action(async (options) => {
		try {
			const updateData: Record<string, unknown> = {}
			if (options.name !== undefined) updateData.name = options.name
			if (options.typeId !== undefined) updateData.typeId = options.typeId
			if (options.systemId !== undefined) updateData.solarSystemId = options.systemId
			if (options.profileId !== undefined) updateData.profileId = options.profileId

			if (Object.keys(updateData).length === 0) {
				console.error('No fields to update')
				process.exit(1)
			}

			const struct = await structDb.update(options.id, updateData)
			console.log('Structure updated successfully:')
			console.log(JSON.stringify(struct, null, 2))
		} catch (error) {
			console.error('Error updating structure:', error instanceof Error ? error.message : String(error))
			process.exit(1)
		}
	})

structCommand
	.command('delete')
	.alias('rm')
	.description('Delete a structure')
	.requiredOption('--id <id>', 'Structure UUID')
	.action(async (options) => {
		try {
			await structDb.delete(options.id)
			console.log('Structure deleted successfully')
		} catch (error) {
			console.error('Error deleting structure:', error instanceof Error ? error.message : String(error))
			process.exit(1)
		}
	})

structCommand
	.command('toggle')
	.description('Toggle monitoring for a structure')
	.requiredOption('--id <id>', 'Structure UUID')
	.action(async (options) => {
		try {
			const struct = await structDb.toggleMonitoring(options.id)
			console.log(`Monitoring ${struct.monitoringEnabled ? 'enabled' : 'disabled'} for structure`)
			console.log(JSON.stringify(struct, null, 2))
		} catch (error) {
			console.error('Error toggling monitoring:', error instanceof Error ? error.message : String(error))
			process.exit(1)
		}
	})

