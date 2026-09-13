import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DiscordCard } from '@/components/discord-card'
import { ServicesCard } from '@/components/services-card'
import { formatNumber, i18n, I18nProvider, setAppLocale } from '@/i18n'

import type { ReactNode } from 'react'
import type { User } from '@/hooks/useAuth'

const state = vi.hoisted(() => ({
	linkPending: false,
	linkError: null as Error | null,
	mumbleEnabled: false,
	mumbleFeatureLoading: false,
	mumbleLoading: false,
	mumbleError: null as Error | null,
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
vi.mock('@/features/mumble/feature', () => ({
	useMumbleFeatureEnabled: () => ({
		isEnabled: state.mumbleEnabled,
		isLoading: state.mumbleFeatureLoading,
	}),
}))
vi.mock('@/features/mumble/hooks', () => ({
	useMumbleAccount: () => ({
		data: {
			account: { enabled: true, loginName: 'pilot.voice' },
			connection: { host: 'voice.example.test', port: 64738 },
		},
		isLoading: state.mumbleLoading,
		error: state.mumbleError,
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
		state.linkPending = false
		state.linkError = null
		state.mumbleEnabled = false
		state.mumbleFeatureLoading = false
		state.mumbleLoading = false
		state.mumbleError = null
	})

	afterEach(async () => {
		await setAppLocale('en', { persistLocal: false })
	})

	it.each([
		['en', 'Connected account', 'Refresh Discord Access', 'Services'],
		[
			'de',
			'Verknüpftes Konto',
			'Discord-Zugriff aktualisieren',
			'Dienste',
		],
		['ko', '연결된 계정', 'Discord 접근 권한 갱신', '서비스'],
	] as const)(
		'renders dashboard card copy in %s without changing account data',
		async (locale, connected, refresh, services) => {
			await setAppLocale(locale, { persistLocal: false })
			state.mumbleEnabled = true
			const html = renderCards(
				<>
					<DiscordCard user={user} />
					<ServicesCard />
				</>
			)

			for (const message of [connected, refresh, services, 'pilot.voice', 'voice.example.test']) {
				expect(html).toContain(message)
			}
			if (locale !== 'en') {
				expect(html).not.toContain('Connected account')
				expect(html).not.toContain('Refresh Discord Access')
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
		state.mumbleEnabled = true
		state.mumbleFeatureLoading = true
		const loading = renderCards(<ServicesCard />)
		expect(loading).toContain('서비스')
		expect(loading).toContain('연결된 서비스 관리')

		state.mumbleFeatureLoading = false
		state.mumbleError = new Error('Unavailable')
		const failed = renderCards(<ServicesCard />)
		expect(failed).toContain('서비스')
	})

	it('localizes service statuses and accessible copy without changing service data or links', async () => {
		await setAppLocale('de', { persistLocal: false })
		state.mumbleEnabled = true
		const html = renderCards(<ServicesCard />)
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
