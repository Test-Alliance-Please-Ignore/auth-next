import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { DataTable, getNextDataTableSorting } from '@/components/data-table'
import { ApplicationsTable } from '@/features/applications/components/applications-table'

import type { Application } from '@/features/applications/api'

type TestRow = {
	id: string
	name: string
}

const rows: TestRow[] = [
	{ id: 'row-1', name: 'Alpha' },
	{ id: 'row-2', name: 'Bravo' },
]

const application: Application = {
	id: 'application-1',
	corporationId: 'corporation-1',
	corporationName: 'Test Corporation',
	userId: 'user-1',
	characterId: 'character-1',
	characterName: 'Test Character',
	applicationText: 'Application text',
	status: 'pending',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
}

const columns = [
	{
		id: 'name',
		header: 'Name',
		sortable: true,
		cell: (row: TestRow) => row.name,
	},
	{
		id: 'actions',
		header: 'Actions',
		sticky: 'right' as const,
		cell: () => <button type="button">Action</button>,
	},
]

function renderTable(
	rowInteraction?:
		| { type: 'link'; getHref: (row: TestRow) => string }
		| { type: 'click'; onClick: (row: TestRow) => void }
) {
	return renderToStaticMarkup(
		<MemoryRouter>
			<DataTable
				columns={columns}
				rows={rows}
				emptyMessage="No rows"
				sorting={[{ id: 'name', desc: false }]}
				onSortingChange={() => undefined}
				pagination={{ pageIndex: 0, pageSize: 25 }}
				onPaginationChange={() => undefined}
				rowCount={rows.length}
				getRowKey={(row) => row.id}
				rowInteraction={rowInteraction}
				renderExpandedRow={(row) => <div>{row.name} details</div>}
			/>
		</MemoryRouter>
	)
}

describe('DataTable', () => {
	it('cycles sorting from a new column to ascending and descending', () => {
		expect(getNextDataTableSorting([], 'name')).toEqual([{ id: 'name', desc: false }])
		expect(getNextDataTableSorting([{ id: 'name', desc: false }], 'name')).toEqual([
			{ id: 'name', desc: true },
		])
		expect(getNextDataTableSorting([{ id: 'name', desc: true }], 'status')).toEqual([
			{ id: 'status', desc: false },
		])
	})

	it('renders row links while leaving sticky action cells as controls', () => {
		const html = renderTable({ type: 'link', getHref: (row) => `/rows/${row.id}` })

		expect(html.match(/href="\/rows\/row-1"/g)).toHaveLength(1)
		expect(html.match(/href="\/rows\/row-2"/g)).toHaveLength(1)
		expect(html).toContain('>Action</button>')
		expect(html).toContain('1–2 of 2 rows')
	})

	it('does not render row links in callback interaction mode', () => {
		const html = renderTable({ type: 'click', onClick: () => undefined })

		expect(html).not.toContain('href="/rows/')
		expect(html).toContain('>Alpha</td>')
	})

	it('renders an expansion control for rows with expanded content', () => {
		const html = renderTable()

		expect(html).toContain('aria-label="Expand row"')
		expect(html).toContain('aria-expanded="false"')
		expect(html).not.toContain('Alpha details')
	})

	it('does not nest links in the applications row-link consumer', () => {
		const html = renderToStaticMarkup(
			<MemoryRouter>
				<ApplicationsTable
					applications={[application]}
					getApplicationHref={(row) => `/applications/${row.id}`}
				/>
			</MemoryRouter>
		)

		expect(html).toContain('href="/applications/application-1"')
		expect(html).not.toMatch(/<a[^>]*>\s*<a/)
	})
})
