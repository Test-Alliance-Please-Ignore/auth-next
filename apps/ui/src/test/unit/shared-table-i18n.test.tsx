import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'

import { DataTable } from '@/components/data-table'
import { TableLayoutToggle } from '@/components/table-layout-toggle'
import { I18nProvider, setAppLocale } from '@/i18n'

describe('localized shared table controls', () => {
	afterEach(async () => {
		await setAppLocale('en', { persistLocal: false })
	})

	it.each([
		['en', 'Expand row', 'Failed to load data', 'Clamp grid', 'Page scroll'],
		[
			'de',
			'Zeile aufklappen',
			'Daten konnten nicht geladen werden',
			'Tabelle einpassen',
			'Seite scrollen',
		],
		['ko', '행 펼치기', '데이터를 불러오지 못했습니다', '표 높이 맞추기', '페이지 스크롤'],
	] as const)(
		'renders table controls in %s without changing row data or links',
		async (locale, expand, error, clamp, scroll) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderToStaticMarkup(
				<I18nProvider>
					<MemoryRouter>
						<DataTable
							columns={[{ id: 'name', header: 'Name', cell: (row) => row.name }]}
							rows={[{ id: 'original-id', name: 'Original Name' }]}
							emptyMessage="Original empty message"
							getRowKey={(row) => row.id}
							rowInteraction={{ type: 'link', getHref: (row) => `/rows/${row.id}` }}
							renderExpandedRow={(row) => <div>{row.name}</div>}
							error={true}
						/>
						<TableLayoutToggle isClamped={false} onToggle={() => undefined} />
						<TableLayoutToggle isClamped onToggle={() => undefined} />
					</MemoryRouter>
				</I18nProvider>
			)
			expect(html).toContain(`aria-label="${expand}"`)
			expect(html).toContain(error)
			expect(html).toContain(clamp)
			expect(html).toContain(scroll)
			expect(html).toContain('Original Name')
			expect(html).toContain('href="/rows/original-id"')
		}
	)

	it('preserves raw API errors', async () => {
		await setAppLocale('de', { persistLocal: false })
		const html = renderToStaticMarkup(
			<DataTable
				columns={[]}
				rows={[]}
				getRowKey={() => 'row'}
				emptyMessage="Empty"
				error={new Error('Original API error')}
			/>
		)
		expect(html).toContain('Original API error')
	})
})
