import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import {
	createCorporationAlertDestination,
	deleteCorporationAlertDestination,
	dispatchCorporationAlert,
	listCorporationAlertDestinations,
	listCorporationAlertTypes,
	updateCorporationAlertDestination,
} from '../corporation-alerts.service'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

const alertDestinationMocks = vi.hoisted(() => ({
	listAlertDestinations: vi.fn(),
	createAlertDestination: vi.fn(),
	updateAlertDestination: vi.fn(),
	deleteAlertDestination: vi.fn(),
}))

vi.mock('../alert-destinations.service', () => alertDestinationMocks)

const getStubMock = vi.mocked(getStub)

function makeDb() {
	return {
		query: {
			alertDestinations: {
				findMany: vi.fn(),
				findFirst: vi.fn(),
			},
			managedCorporations: {
				findFirst: vi.fn(),
			},
			discordServers: {
				findFirst: vi.fn(),
			},
		},
	}
}

describe('corporation-alerts service', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		getStubMock.mockReturnValue({
			sendMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }),
			sendDirectMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'dm-1' }),
		} as any)
		alertDestinationMocks.listAlertDestinations.mockResolvedValue([])
		alertDestinationMocks.createAlertDestination.mockResolvedValue({
			id: 'dest-1',
			scopeType: 'corporation',
			scopeId: 'corp-1',
		})
		alertDestinationMocks.updateAlertDestination.mockResolvedValue({
			id: 'dest-1',
			scopeType: 'corporation',
			scopeId: 'corp-1',
		})
		alertDestinationMocks.deleteAlertDestination.mockResolvedValue(undefined)
	})

	it('exposes the registered alert types', () => {
		expect(listCorporationAlertTypes()).toEqual([
			expect.objectContaining({
				type: 'corp_application_submitted',
				label: 'Corporation Application Submitted',
			}),
			expect.objectContaining({
				type: 'corp_application_first_time_accepted',
				label: 'Corporation Application Accepted',
			}),
		])
	})

	it('lists alert destinations with attached discord server data', async () => {
		const db = makeDb()
		alertDestinationMocks.listAlertDestinations.mockResolvedValue([
			{
				id: 'dest-1',
				scopeType: 'corporation',
				scopeId: 'corp-1',
				alertType: 'corp_application_submitted',
				destinationType: 'discord_channel',
				discordServerId: 'server-1',
				channelId: 'channel-1',
				coreUserId: null,
				groupId: null,
				destinationConfig: {},
				isEnabled: true,
				createdBy: null,
				updatedBy: null,
				createdAt: new Date('2026-06-11T00:00:00.000Z'),
				updatedAt: new Date('2026-06-11T00:00:00.000Z'),
				discordServer: {
					id: 'server-1',
					guildId: 'guild-1',
					guildName: 'Alpha',
				},
			},
		])

		const items = await listCorporationAlertDestinations(db as any, 'corp-1')

		expect(alertDestinationMocks.listAlertDestinations).toHaveBeenCalledWith(db, expect.anything(), 'corp-1')
		expect(items).toEqual([
			expect.objectContaining({
				id: 'dest-1',
				discordServer: {
					id: 'server-1',
					guildId: 'guild-1',
					guildName: 'Alpha',
				},
			}),
		])
	})

	it('creates alert destinations and normalizes payload defaults', async () => {
		const db = makeDb()
		const result = await createCorporationAlertDestination(db as any, {
			corporationId: 'corp-1',
			alertType: 'corp_application_submitted',
			destinationType: 'discord_channel',
			discordServerId: 'server-1',
			channelId: 'channel-1',
			createdBy: 'user-1',
		})

		expect(alertDestinationMocks.createAlertDestination).toHaveBeenCalledWith(
			db,
			expect.objectContaining({
				scopeType: 'corporation',
				scopeId: 'corp-1',
				alertType: 'corp_application_submitted',
				destinationType: 'discord_channel',
				discordServerId: 'server-1',
				channelId: 'channel-1',
				coreUserId: null,
				groupId: null,
				destinationConfig: undefined,
				isEnabled: undefined,
				createdBy: 'user-1',
				updatedBy: undefined,
			})
		)
		expect(result).toEqual(
			expect.objectContaining({
				id: 'dest-1',
				corporationId: 'corp-1',
			})
		)
	})

	it('updates alert destinations in place', async () => {
		const db = makeDb()
		alertDestinationMocks.updateAlertDestination.mockResolvedValue({
			id: 'dest-1',
			scopeType: 'corporation',
			scopeId: 'corp-1',
			alertType: 'corp_application_submitted',
			destinationType: 'discord_channel',
			discordServerId: 'server-1',
			channelId: 'channel-1',
			coreUserId: null,
			groupId: null,
			destinationConfig: {},
			isEnabled: false,
			createdBy: null,
			updatedBy: 'user-1',
			createdAt: new Date('2026-06-11T00:00:00.000Z'),
			updatedAt: new Date('2026-06-11T00:00:00.000Z'),
		})

		const result = await updateCorporationAlertDestination(db as any, 'corp-1', 'dest-1', {
			isEnabled: false,
		})

		expect(alertDestinationMocks.updateAlertDestination).toHaveBeenCalledWith(
			db,
			'corporation',
			'corp-1',
			'dest-1',
			expect.objectContaining({
				alertType: undefined,
				destinationType: undefined,
				discordServerId: undefined,
				channelId: undefined,
				coreUserId: undefined,
				groupId: undefined,
				destinationConfig: undefined,
				isEnabled: false,
				updatedBy: undefined,
			})
		)
		expect(result).toEqual(
			expect.objectContaining({
				id: 'dest-1',
				corporationId: 'corp-1',
				isEnabled: false,
			})
		)
	})

	it('deletes alert destinations for the requested corporation', async () => {
		const db = makeDb()

		await deleteCorporationAlertDestination(db as any, 'corp-1', 'dest-1')

		expect(alertDestinationMocks.deleteAlertDestination).toHaveBeenCalledWith(
			db,
			'corporation',
			'corp-1',
			'dest-1'
		)
	})

	it('dispatches application alerts to configured discord destinations', async () => {
		const db = makeDb()
		db.query.managedCorporations.findFirst.mockResolvedValue({
			corporationId: 'corp-1',
			name: 'Test Corporation',
		})
		db.query.alertDestinations.findMany.mockResolvedValue([
			{
				id: 'dest-1',
				scopeType: 'corporation',
				scopeId: 'corp-1',
				alertType: 'corp_application_submitted',
				destinationType: 'discord_channel',
				discordServerId: 'server-1',
				channelId: 'channel-1',
				coreUserId: null,
				groupId: null,
				destinationConfig: {},
				isEnabled: true,
				createdBy: null,
				updatedBy: null,
				createdAt: new Date('2026-06-11T00:00:00.000Z'),
				updatedAt: new Date('2026-06-11T00:00:00.000Z'),
			},
		])
		db.query.discordServers.findFirst.mockResolvedValue({
			id: 'server-1',
			guildId: 'guild-1',
			guildName: 'Alpha',
		})

		const discordStub = {
			sendMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }),
			sendDirectMessage: vi.fn(),
		}
		getStubMock.mockReturnValue(discordStub as any)

		const result = await dispatchCorporationAlert(
			{
				DISCORD: { name: 'DISCORD' },
			} as any,
			db as any,
			{
				corporationId: 'corp-1',
				alertType: 'corp_application_submitted',
				payload: {
					applicationId: 'app-1',
					corporationId: 'corp-1',
					corporationName: 'Placeholder',
					applicantCharacterId: 'char-1',
					applicantCharacterName: 'Pilot One',
					altCharacterCount: 2,
					isFirstApplication: true,
					submittedAt: '2026-06-11T12:00:00.000Z',
				},
			}
		)

		expect(discordStub.sendMessage).toHaveBeenCalledWith(
			'guild-1',
			'channel-1',
			expect.objectContaining({
				embeds: [
					expect.objectContaining({
						title: 'New application to Test Corporation submitted',
						description: '[View Application](https://pleaseignore.app/corporations/corp-1/applications/app-1)',
						fields: [
							{
								name: 'Applicant',
								value: 'Pilot One (+2 alts)',
								inline: true,
							},
							{
								name: 'Application Type',
								value: 'First application',
								inline: true,
							},
						],
					}),
				],
			})
		)
		expect(result).toEqual({
			alertType: 'corp_application_submitted',
			destinationCount: 1,
			sentCount: 1,
			failedCount: 0,
		})
	})

	it('dispatches first-time acceptance alerts to configured discord destinations', async () => {
		const db = makeDb()
		db.query.managedCorporations.findFirst.mockResolvedValue({
			corporationId: 'corp-1',
			name: 'Test Corporation',
		})
		db.query.alertDestinations.findMany.mockResolvedValue([
			{
				id: 'dest-1',
				scopeType: 'corporation',
				scopeId: 'corp-1',
				alertType: 'corp_application_first_time_accepted',
				destinationType: 'discord_channel',
				discordServerId: 'server-1',
				channelId: 'channel-1',
				coreUserId: null,
				groupId: null,
				destinationConfig: {},
				isEnabled: true,
				createdBy: null,
				updatedBy: null,
				createdAt: new Date('2026-06-11T00:00:00.000Z'),
				updatedAt: new Date('2026-06-11T00:00:00.000Z'),
			},
		])
		db.query.discordServers.findFirst.mockResolvedValue({
			id: 'server-1',
			guildId: 'guild-1',
			guildName: 'Alpha',
		})

		const discordStub = {
			sendMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }),
			sendDirectMessage: vi.fn(),
		}
		getStubMock.mockReturnValue(discordStub as any)

		const result = await dispatchCorporationAlert(
			{
				DISCORD: { name: 'DISCORD' },
			} as any,
			db as any,
			{
				corporationId: 'corp-1',
				alertType: 'corp_application_first_time_accepted',
				payload: {
					applicationId: 'app-1',
					corporationId: 'corp-1',
					corporationName: 'Placeholder',
					applicantCharacterId: 'char-1',
					applicantCharacterName: 'Pilot One',
					altCharacterCount: 0,
					isFirstApplication: true,
					acceptedAt: '2026-06-11T12:30:00.000Z',
				},
			}
		)

		expect(discordStub.sendMessage).toHaveBeenCalledWith(
			'guild-1',
			'channel-1',
			expect.objectContaining({
				embeds: [
					expect.objectContaining({
						title: 'First application to Test Corporation accepted',
						description: '[View Application](https://pleaseignore.app/corporations/corp-1/applications/app-1)',
						fields: [
							{
								name: 'Applicant',
								value: 'Pilot One',
								inline: true,
							},
							{
								name: 'Application Type',
								value: 'First application',
								inline: true,
							},
						],
					}),
				],
			})
		)
		expect(result).toEqual({
			alertType: 'corp_application_first_time_accepted',
			destinationCount: 1,
			sentCount: 1,
			failedCount: 0,
		})
	})
})
