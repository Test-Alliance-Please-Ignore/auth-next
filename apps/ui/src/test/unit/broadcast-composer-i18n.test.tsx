import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BroadcastPreviewPane } from '@/features/broadcasts/components/broadcast-preview-pane'
import { TemplateFieldsEditor } from '@/features/broadcasts/components/template-fields-editor'
import { renderBroadcastTemplateMessage } from '@/features/broadcasts/message-template-renderer'
import { convertUnixTimestampsForPreview } from '@/features/broadcasts/preview-timestamps'
import { doctrineKeys, stagingSystemKeys } from '@/features/doctrines/query-keys'
import { broadcastKeys } from '@/hooks/useBroadcasts'
import { I18nProvider, setAppLocale } from '@/i18n'
import NewBroadcastPage from '@/routes/broadcasts-new'

import { applicant } from '../fixtures/applicant-workflows'
import { composerFields, composerTemplate } from '../fixtures/broadcast-composer'
import { broadcastTarget } from '../fixtures/broadcasts'

import type { ReactNode } from 'react'

const page = vi.hoisted(() => ({ title: '' }))
vi.mock('@/hooks/usePageTitle', () => ({
	usePageTitle: (title: string) => {
		page.title = title
	},
}))
let client: QueryClient
function renderUI(children: ReactNode, path = '/broadcasts/new') {
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<I18nProvider>
				<MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
			</I18nProvider>
		</QueryClientProvider>
	)
}
function fields(canCreateFleetTracking = true) {
	return (
		<TemplateFieldsEditor
			fields={composerTemplate.fieldSchema}
			templateFields={composerFields}
			templateFieldSelections={{
				doctrine: '__doctrine_read_motd',
				staging: '__custom',
				fleetCommander: '__custom__',
			}}
			doctrines={[]}
			stagingSystems={[]}
			userCharacters={applicant.characters}
			mainCharacterId={applicant.mainCharacterId}
			canCreateFleetTracking={canCreateFleetTracking}
			messageParts={{ prefix: 'Original before', suffix: 'Original after' }}
			onMessagePartsChange={() => {}}
			onUpdateTemplateField={() => {}}
			onUpdateTemplateFieldSelection={() => {}}
		/>
	)
}
beforeEach(() => {
	client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
	client.setQueryData(['auth', 'session'], { authenticated: true, user: applicant })
	client.setQueryData(broadcastKeys.targets(), [broadcastTarget])
	client.setQueryData(broadcastKeys.templatesFiltered(), [composerTemplate])
	client.setQueryData(doctrineKeys.list(), [])
	client.setQueryData(stagingSystemKeys.all, [])
})
afterEach(async () => {
	client.clear()
	await setAppLocale('en', { persistLocal: false })
})

describe('member broadcast composer localization', () => {
	it.each([
		[
			'en',
			'New Broadcast',
			'Edit Draft Broadcast',
			'Save as Draft',
			'Send Broadcast',
			'Rendered length: 0/2,000',
		],
		[
			'de',
			'Neuer Broadcast',
			'Broadcast-Entwurf bearbeiten',
			'Als Entwurf speichern',
			'Broadcast senden',
			'Nachrichtenlänge: 0/2.000',
		],
		['ko', '새 방송', '방송 초안 편집', '초안으로 저장', '방송 전송', '최종 메시지 길이: 0/2,000'],
	] as const)(
		'renders composer and draft page in %s',
		async (locale, title, editTitle, save, send, length) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderUI(<NewBroadcastPage />)
			for (const text of [title, save, send, length]) expect(html).toContain(text)
			expect(page.title).toBe(title)
			expect(html).not.toContain('broadcasts.composer.')
			const draft = renderUI(<NewBroadcastPage />, '/broadcasts/new?draftId=original-id')
			expect(draft).toContain(editTitle)
			expect(page.title).toBe(editTitle)
		}
	)
	it.each([
		[
			'en',
			'Text before (optional)',
			'Text after (optional)',
			'Military SRP',
			'Sound the Frogsiren',
			'Read MOTD',
			'Custom',
		],
		[
			'de',
			'Text davor (optional)',
			'Text danach (optional)',
			'Militärisches SRP',
			'Frogsiren auslösen',
			'MOTD lesen',
			'Eigene Angabe',
		],
		[
			'ko',
			'앞에 넣을 텍스트 (선택 사항)',
			'뒤에 넣을 텍스트 (선택 사항)',
			'군사 SRP',
			'Frogsiren 울리기',
			'MOTD 확인',
			'직접 입력',
		],
	] as const)(
		'translates template controls while preserving supplied content in %s',
		async (locale, before, after, srp, frogsiren, motd, custom) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderUI(fields())
			for (const text of [
				before,
				after,
				srp,
				frogsiren,
				motd,
				custom,
				'Original before',
				'Original after',
				'Original Doctrine',
				'Original Staging',
				'Original Commander',
				'Original System',
				'Original Other',
				'Original fleet — 원문',
			])
				expect(html).toContain(text)
			expect(html).toContain('id="fleet-tracking-toggle"')
			expect(renderUI(fields(false))).not.toContain('id="fleet-tracking-toggle"')
		}
	)
	it('preserves canonical SRP modes, MOTD text, and tokens in outbound previews across locales', async () => {
		const expected = renderBroadcastTemplateMessage(
			composerTemplate.messageTemplate,
			composerFields,
			true
		)
		expect(expected).toContain('Read MOTD')
		expect(expected).toContain('Military')
		expect(expected).toContain('ORIGINAL-TOKEN')
		for (const locale of ['en', 'de', 'ko'] as const) {
			await setAppLocale(locale, { persistLocal: false })
			expect(
				renderBroadcastTemplateMessage(composerTemplate.messageTemplate, composerFields, true)
			).toBe(expected)
			const html = renderUI(<BroadcastPreviewPane message={expected} />)
			expect(html).toContain('ORIGINAL-TOKEN')
			expect(html).not.toContain('&lt;t:1893456000:F&gt;')
		}
	})
	it.each([
		['en', 'Preview', 'Preview will appear here…'],
		['de', 'Vorschau', 'Hier erscheint die Vorschau…'],
		['ko', '미리 보기', '미리 보기가 여기에 표시됩니다…'],
	] as const)(
		'translates empty preview and timestamp content in %s',
		async (locale, preview, empty) => {
			await setAppLocale(locale, { persistLocal: false })
			expect(renderUI(<BroadcastPreviewPane message="" />)).toContain(empty)
			const html = renderUI(
				<BroadcastPreviewPane message={'Original text <t:1893456000:F>\n<script>raw</script>'} />
			)
			expect(html).toContain(preview)
			expect(html).toContain('Original text')
			expect(html).not.toContain('<script>raw</script>')
			if (locale === 'ko') expect(html).toContain('1월')
			if (locale === 'de') expect(html).toContain('Januar')
		}
	)
})

describe('composer timestamp previews', () => {
	it('preserves helper tokens and independently converts repeated bare epochs', () => {
		const tokens = ['t', 'T', 'd', 'D', 'f', 'F', 'R']
			.map((style) => `<t:1893456000:${style}>`)
			.join(' ')
		const message = `${tokens} <t:1893456000> 1893456000 1893456000000 1893456000`
		expect(convertUnixTimestampsForPreview(message)).toBe(
			`${tokens} <t:1893456000> <t:1893456000:f> <t:1893456000:f> <t:1893456000:f>`
		)
	})
	it('keeps unrelated long IDs and out-of-range numbers intact', () => {
		expect(convertUnixTimestampsForPreview('123456789012345678 9999999999')).toBe(
			'123456789012345678 9999999999'
		)
	})
})
