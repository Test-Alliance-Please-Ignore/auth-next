import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { discordKeys } from '@/hooks/useDiscord'
import { discordCommandKeys } from '@/hooks/useDiscordCommands'
import { I18nProvider, setAppLocale } from '@/i18n'
import Audit from '@/routes/admin/discord-audit'
import Categories from '@/routes/admin/discord-command-categories'
import Commands from '@/routes/admin/discord-commands'
import ServerCommands from '@/routes/admin/discord-server-commands'
import Roles from '@/routes/admin/discord-server-roles'
import Servers from '@/routes/admin/discord-servers'

import {
	discordAudit,
	discordAuditCache,
	discordAuditMember,
	discordCategory,
	discordCommand,
	discordProgrammaticCommand,
	discordSelfRole,
	discordServer,
} from '../fixtures/admin-discord'

import type { ReactNode } from 'react'

const clients: QueryClient[] = []
function createClient() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	clients.push(client)
	client.setQueryData(discordKeys.servers(), [discordServer])
	client.setQueryData(discordKeys.selfAssignableRoles(discordServer.id), [discordSelfRole])
	client.setQueryData(discordCommandKeys.categories(), [discordCategory])
	client.setQueryData(discordCommandKeys.list(), [discordCommand, discordProgrammaticCommand])
	return client
}
function render(children: ReactNode, client = createClient()) {
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<I18nProvider>
				<MemoryRouter initialEntries={['/servers/server-original']}>
					<Routes>
						<Route path="/servers/:serverId" element={children} />
					</Routes>
				</MemoryRouter>
			</I18nProvider>
		</QueryClientProvider>
	)
}
function cacheAudit(data = discordAudit, selected: Record<string, boolean> = {}) {
	vi.stubGlobal('sessionStorage', {
		getItem: () => JSON.stringify(discordAuditCache(data, selected)),
	})
}

describe('admin Discord localization', () => {
	afterEach(async () => {
		await setAppLocale('en', { persistLocal: false })
		clients.splice(0).forEach((client) => client.clear())
		vi.unstubAllGlobals()
	})

	it.each([
		['en', 'Discord Servers', 'Discord Server Roles', 'Nicknames Enabled'],
		['de', 'Discord-Server', 'Discord-Serverrollen', 'Spitznamen aktiviert'],
		['ko', 'Discord 서버', 'Discord 서버 역할', '별명 관리 활성화'],
	] as const)(
		'renders server and role management in %s with raw identifiers',
		async (locale, servers, roles, nickname) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = render(
				<>
					<Servers />
					<Roles />
				</>
			)
			for (const text of [
				servers,
				roles,
				nickname,
				'Guild &lt;Original&gt;',
				'Role &lt;Original&gt;',
				discordServer.guildId,
				discordServer.roles[0].roleId,
			])
				expect(html.includes(text), text).toBe(true)
			expect(html).toContain('href="/admin/discord-servers/server-original/commands"')
			expect(html).not.toContain('<Original>')
			expect(html).not.toContain('admin.discord.')
		}
	)

	it.each([
		[
			'en',
			'Discord Command Categories',
			'Programmatic',
			'Static Response',
			'Delete Slash Command',
			'Order 1,234',
		],
		[
			'de',
			'Discord-Befehlskategorien',
			'Programmgesteuert',
			'Statische Antwort',
			'Slash-Befehl löschen',
			'Reihenfolge 1.234',
		],
		['ko', 'Discord 명령어 카테고리', '코드 기반', '고정 응답', '슬래시 명령어 삭제', '순서 1,234'],
	] as const)(
		'localizes commands and categories in %s and preserves the programmatic deletion gate',
		async (locale, categories, programmatic, staticResponse, remove, order) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = render(
				<>
					<Commands />
					<Categories />
					<ServerCommands />
				</>
			)
			for (const text of [
				categories,
				programmatic,
				staticResponse,
				order,
				'/original_command',
				'/original_programmatic',
				'Original code-defined requirement',
				'Category &lt;Original&gt;',
				'Original command description',
			])
				expect(html.includes(text), text).toBe(true)
			expect(html.split(`aria-label="${remove}"`)).toHaveLength(2)
			expect(html).not.toContain('admin.discord.')
		}
	)

	it.each([
		['en', 'Discord Member Audit', 'Completed', '1 role assigned', '1,234 unmanaged'],
		[
			'de',
			'Discord-Mitgliederprüfung',
			'Abgeschlossen',
			'1 Rolle zugewiesen',
			'1.234 nicht verwaltet',
		],
		['ko', 'Discord 멤버 감사', '완료', '역할 1개 할당됨', '1,234개 관리되지 않음'],
	] as const)(
		'localizes a cached linked audit in %s and preserves inspection links and supplied error text',
		async (locale, title, status, roles, unmanaged) => {
			await setAppLocale(locale, { persistLocal: false })
			cacheAudit({ ...discordAudit, runError: 'Original server <detail>' })
			const html = render(<Audit />)
			for (const text of [
				title,
				status,
				roles,
				unmanaged,
				'Display &lt;Original&gt;',
				'Original server &lt;detail&gt;',
				discordAuditMember.discordUserId,
			])
				expect(html.includes(text), text).toBe(true)
			expect(html).toContain('href="/admin/users/user-original/discord-access"')
			expect(html).not.toContain('admin.discord.')
		}
	)

	it.each([
		['en', '1 user selected for bulk strip.', 'Kick User', 'No linked users found on this page.'],
		[
			'de',
			'1 Benutzer für den gesammelten Rollenentzug ausgewählt.',
			'Benutzer vom Server entfernen',
			'Keine verknüpften Benutzer auf dieser Seite gefunden.',
		],
		[
			'ko',
			'일괄 역할 제거 대상으로 사용자 1명을 선택했습니다.',
			'사용자 추방',
			'이 페이지에 연결된 사용자가 없습니다.',
		],
	] as const)(
		'preserves unlinked selection gates and localizes empty audit pages in %s',
		async (locale, selected, kick, empty) => {
			await setAppLocale(locale, { persistLocal: false })
			cacheAudit(
				{
					...discordAudit,
					tab: 'unlinked',
					items: [{ ...discordAuditMember, linked: false, coreUserId: null }],
				},
				{ [discordAuditMember.discordUserId]: true }
			)
			const html = render(<Audit />)
			expect(html.includes(selected)).toBe(true)
			expect(html.includes(kick)).toBe(true)
			expect(html).toContain('data-state="checked"')
			expect(html).not.toContain('/discord-access')
			cacheAudit({ ...discordAudit, items: [] })
			expect(render(<Audit />).includes(empty)).toBe(true)
		}
	)

	it.each([
		['idle', 'Inaktiv'],
		['pending', 'Ausstehend'],
		['processing', 'In Bearbeitung'],
		['completed', 'Abgeschlossen'],
		['failed', 'Fehlgeschlagen'],
		['cancelled', 'Abgebrochen'],
	] as const)('shows the %s run status in German', async (runStatus, label) => {
		await setAppLocale('de', { persistLocal: false })
		cacheAudit({ ...discordAudit, runStatus })
		expect(render(<Audit />).includes(label)).toBe(true)
	})
})
