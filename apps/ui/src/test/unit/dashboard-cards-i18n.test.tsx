import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DiscordCard } from '@/components/discord-card'
import { ServicesCard } from '@/components/services-card'
import { formatNumber, i18n, I18nProvider, setAppLocale } from '@/i18n'

import type { ReactNode } from 'react'
import type { User } from '@/hooks/useAuth'
import type { UserService } from '@/lib/api'

const state = vi.hoisted(() => ({
	isLoading: false,
	error: null as Error | null,
	services: [] as UserService[],
	linkPending: false,
	linkError: null as Error | null,
	mumbleEnabled: false,
}))

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { is_admin: true } }) }))
vi.mock('@/hooks/useDiscord', () => ({
	useDiscordLink: () => ({
		mutate: vi.fn(),
		reset: vi.fn(),
		isPending: state.linkPending,
		error: state.linkError,
	}),
}))
vi.mock('@/hooks/useServices', () => ({
	serviceKeys: { user: () => ['services', 'user'] },
	useUserServices: () => ({
		data: state.services,
		isLoading: state.isLoading,
		error: state.error,
	}),
}))
vi.mock('@/features/mumble/feature', () => ({
	useMumbleFeatureEnabled: () => ({ isEnabled: state.mumbleEnabled, isLoading: false }),
}))
vi.mock('@/features/mumble/hooks', () => ({
	useMumbleAccount: () => ({
		data: {
			account: { enabled: true, loginName: 'pilot.voice' },
			connection: { host: 'voice.example.test', port: 64738 },
		},
		isLoading: false,
		error: null,
	}),
}))

const user: User = {
	id: 'user-1',
	mainCharacterId: '123',
	characters: [],
	is_admin: true,
	discord: {
		userId: '987654321',
		username: 'Pilot Name',
		discriminator: '0',
		authRevoked: false,
		authRevokedAt: null,
		lastSuccessfulAuth: null,
	},
}

function renderCards(children: ReactNode) {
	return renderToStaticMarkup(
		<QueryClientProvider client={new QueryClient()}>
			<I18nProvider>
				<MemoryRouter>{children}</MemoryRouter>
			</I18nProvider>
		</QueryClientProvider>
	)
}

describe('localized dashboard cards', () => {
	beforeEach(() => {
		state.isLoading = false
		state.error = null
		state.services = []
		state.linkPending = false
		state.linkError = null
		state.mumbleEnabled = false
	})

	afterEach(async () => {
		await setAppLocale('en', { persistLocal: false })
	})

	it.each([
		['en', 'Connected account', 'Refresh Discord Access', 'Services', 'No services configured'],
		[
			'de',
			'Verknüpftes Konto',
			'Discord-Zugriff aktualisieren',
			'Dienste',
			'Keine Dienste eingerichtet',
		],
		['ko', '연결된 계정', 'Discord 접근 권한 갱신', '서비스', '설정된 서비스 없음'],
	] as const)(
		'renders dashboard card copy in %s without changing account data',
		async (locale, connected, refresh, services, empty) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderCards(
				<>
					<DiscordCard user={user} />
					<ServicesCard isLegacyAuthLinked={false} />
				</>
			)

			for (const message of [connected, refresh, services, empty, 'Pilot Name', '987654321']) {
				expect(html).toContain(message)
			}
			if (locale !== 'en') {
				expect(html).not.toContain('Connected account')
				expect(html).not.toContain('Refresh Discord Access')
				expect(html).not.toContain('Manage your linked services')
			}
		}
	)

	it('localizes revoked authorization and linking states while preserving API errors', async () => {
		await setAppLocale('ko', { persistLocal: false })
		const revoked = renderCards(
			<DiscordCard user={{ ...user, discord: { ...user.discord!, authRevoked: true } }} />
		)
		expect(revoked).toContain('인증 권한 취소됨')
		expect(revoked).toContain('Discord 계정 다시 연결')
		expect(revoked).not.toContain('Discord 접근 권한 갱신')

		state.linkPending = true
		state.linkError = new Error('Upstream diagnostic')
		const unlinked = renderCards(<DiscordCard user={{ ...user, discord: undefined }} />)
		expect(unlinked).toContain('Discord로 이동 중…')
		expect(unlinked).toContain('연결 실패')
		expect(unlinked).toContain('Upstream diagnostic')
	})

	it('keeps loading and failed service states localized', async () => {
		await setAppLocale('ko', { persistLocal: false })
		state.isLoading = true
		const loading = renderCards(<ServicesCard isLegacyAuthLinked />)
		expect(loading).toContain('연결된 서비스 관리')
		expect(loading).not.toContain('Manage your linked services')

		state.isLoading = false
		state.error = new Error('Unavailable')
		const failed = renderCards(<ServicesCard isLegacyAuthLinked />)
		expect(failed).toContain('서비스를 불러오지 못했습니다. 나중에 다시 시도해 주세요.')
	})

	it('localizes service statuses and accessible copy without changing service data or links', async () => {
		await setAppLocale('de', { persistLocal: false })
		state.mumbleEnabled = true
		state.services = [
			{
				id: 'user-service-1',
				serviceId: 'service-1',
				enabled: false,
				createdAt: '2026-09-10T00:00:00Z',
				updatedAt: '2026-09-10T00:00:00Z',
				service: {
					id: 'service-1',
					name: 'Community Forum',
					slug: 'forum',
					icon: '/forum.svg',
					description: null,
					enabled: true,
				},
			},
		]
		const html = renderCards(<ServicesCard isLegacyAuthLinked />)
		expect(html).toContain('title="Community Forum verwalten"')
		expect(html).toContain('alt="Symbol für Community Forum"')
		expect(html).toContain('>Deaktiviert</')
		expect(html).toContain('>Aktiv</')
		expect(html).toContain('>Öffnen</')
		expect(html).toContain('href="/mumble"')
		expect(html).toContain('pilot.voice')
		expect(html).toContain('voice.example.test')
	})

	it('uses locale plural rules and formatted server counts for Discord feedback', async () => {
		await setAppLocale('en', { persistLocal: false })
		expect(i18n.t('discordCard.joined', { count: 1, formattedCount: formatNumber(1) })).toBe(
			'Successfully joined 1 Discord server!'
		)
		expect(i18n.t('discordCard.joined', { count: 2, formattedCount: formatNumber(2) })).toBe(
			'Successfully joined 2 Discord servers!'
		)

		await setAppLocale('de', { persistLocal: false })
		expect(i18n.t('discordCard.joined', { count: 1000, formattedCount: formatNumber(1000) })).toBe(
			'1.000 Discord-Servern erfolgreich beigetreten!'
		)

		await setAppLocale('ko', { persistLocal: false })
		expect(
			i18n.t('discordCard.partialRefreshErrors.unknown', {
				count: 2,
				formattedCount: formatNumber(2),
			})
		).toBe('서버 2개의 Discord 접근 권한을 갱신하지 못했습니다.')
	})
})
