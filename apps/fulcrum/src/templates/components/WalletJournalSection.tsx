import type { ProcessedWalletJournalEntries } from '../../workflows/processors/helpers/wallet-journal'
import { PaginationControls } from './PaginationControls'

interface WalletJournalSectionProps {
	data: ProcessedWalletJournalEntries
}

export function WalletJournalSection({ data }: WalletJournalSectionProps) {
	const tableId = `wallet-journal-table-${Date.now()}`

	if (data.length === 0) {
		return null
	}

	const refTypes = Array.from(new Set(data.map((entry) => entry.ref_type))).sort((a, b) =>
		a.localeCompare(b),
	)

	return (
		<section>
			<h2>Wallet Journal</h2>
			<div>
				<div className="assets-controls">
					<div className="search-control">
						<label htmlFor={`${tableId}-search`}>Search:</label>
						<input
							type="text"
							id={`${tableId}-search`}
							className="search-input"
							placeholder="Search by description, parties, or reason..."
							data-table-id={tableId}
						/>
					</div>
					<div className="filter-control">
						<label htmlFor={`${tableId}-ref-type`}>Ref Type:</label>
						<select id={`${tableId}-ref-type`} className="filter-select" data-table-id={tableId}>
							<option value="">All</option>
							{refTypes.map((refType) => (
								<option key={refType} value={refType}>
									{refType}
								</option>
							))}
						</select>
					</div>
					<div className="filter-control">
						<label htmlFor={`${tableId}-amount-direction`}>Amount:</label>
						<select
							id={`${tableId}-amount-direction`}
							className="filter-select"
							data-table-id={tableId}
						>
							<option value="">All</option>
							<option value="credit">Credit</option>
							<option value="debit">Debit</option>
						</select>
					</div>
				</div>

				<PaginationControls tableId={tableId} totalItems={data.length} defaultItemsPerPage={25} />

				<div className="table-container">
					<table id={tableId} className="assets-table wallet-journal-table">
						<thead>
							<tr>
								<th className="sortable" data-sort="date">
									Date <span className="sort-indicator"></span>
								</th>
								<th className="sortable" data-sort="refType">
									Ref Type <span className="sort-indicator"></span>
								</th>
								<th>Description</th>
								<th className="sortable" data-sort="amount">
									Amount <span className="sort-indicator"></span>
								</th>
								<th className="sortable" data-sort="balance">
									Balance <span className="sort-indicator"></span>
								</th>
								<th className="sortable" data-sort="firstParty">
									First Party <span className="sort-indicator"></span>
								</th>
								<th className="sortable" data-sort="secondParty">
									Second Party <span className="sort-indicator"></span>
								</th>
								<th className="sortable" data-sort="context">
									Context <span className="sort-indicator"></span>
								</th>
								<th className="sortable" data-sort="tax">
									Tax <span className="sort-indicator"></span>
								</th>
								<th>Reason</th>
							</tr>
						</thead>
						<tbody>
							{data.map((entry) => {
								const amountSign = entry.amountNumber >= 0 ? 'credit' : 'debit'
								return (
									<tr
										key={entry.id}
										data-date={entry.date}
										data-ref-type={entry.ref_type}
										data-ref-type-label={(entry.refTypeLabel || '').toLowerCase()}
										data-amount={entry.amountNumber.toString()}
										data-amount-sign={amountSign}
										data-description={entry.description.toLowerCase()}
										data-first-party={(entry.firstPartyName || entry.first_party_id || '').toLowerCase()}
										data-second-party={(entry.secondPartyName || entry.second_party_id || '').toLowerCase()}
										data-context={(entry.contextName || entry.context_id || '').toLowerCase()}
										data-tax={(entry.taxFormatted || '').toLowerCase()}
										data-reason={(entry.reason || '').toLowerCase()}
									>
										<td>{new Date(entry.date).toLocaleString()}</td>
										<td>
											<span className="ref-type-badge">{entry.refTypeLabel}</span>
										</td>
										<td>{entry.description}</td>
										<td
											className={`number-cell amount-cell ${
												entry.amountNumber >= 0 ? 'amount-positive' : 'amount-negative'
											}`}
										>
											{entry.amountFormatted} ISK
										</td>
										<td className="number-cell">
											{entry.balanceFormatted ? `${entry.balanceFormatted} ISK` : '—'}
										</td>
										<td>{entry.firstPartyName || entry.first_party_id || '—'}</td>
										<td>{entry.secondPartyName || entry.second_party_id || '—'}</td>
										<td>{entry.contextName || entry.context_id || '—'}</td>
										<td className="number-cell">{entry.taxFormatted ? `${entry.taxFormatted} ISK` : '—'}</td>
										<td>{entry.reason || '—'}</td>
									</tr>
								)
							})}
						</tbody>
						<tfoot>
							<tr>
								<td colSpan={10} className="table-footer">
									Total entries: {data.length.toLocaleString()}
								</td>
							</tr>
						</tfoot>
					</table>
				</div>

				<div className="metadata">
					<p>
						<em>
							Data retrieved:{' '}
							{data[0]?.processedAt ? new Date(data[0].processedAt).toLocaleString() : 'Unknown'}
						</em>
					</p>
				</div>

				<script
					dangerouslySetInnerHTML={{
						__html: `
(function() {
	const tableId = '${tableId}';
	const table = document.getElementById(tableId);
	const searchInput = document.getElementById(tableId + '-search');
	const refTypeFilter = document.getElementById(tableId + '-ref-type');
	const amountFilter = document.getElementById(tableId + '-amount-direction');
	const rows = table ? Array.from(table.querySelectorAll('tbody tr')) : [];

	let sortColumn = null;
	let sortDirection = 'asc';

	function getCellValue(row, column) {
		switch (column) {
			case 'date':
				return row.getAttribute('data-date') || '';
			case 'refType':
				return row.getAttribute('data-ref-type-label') || '';
			case 'amount':
				return parseFloat(row.getAttribute('data-amount') || '0');
			case 'balance':
				return parseFloat(
					(row.querySelector('td:nth-child(5)')?.textContent || '0').replace(/[^0-9.-]/g, '')
				);
			case 'firstParty':
				return row.getAttribute('data-first-party') || '';
			case 'secondParty':
				return row.getAttribute('data-second-party') || '';
			case 'context':
				return row.getAttribute('data-context') || '';
			case 'tax':
				return parseFloat(row.getAttribute('data-tax') || '0');
			default:
				return '';
		}
	}

	function sortTable(column) {
		if (sortColumn === column) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortColumn = column;
			sortDirection = 'asc';
		}

		const tbody = table?.querySelector('tbody');
		if (!tbody) return;

		const sortedRows = Array.from(rows).sort((a, b) => {
			const aVal = getCellValue(a, column);
			const bVal = getCellValue(b, column);

			let comparison = 0;
			if (typeof aVal === 'number' && typeof bVal === 'number' && !Number.isNaN(aVal) && !Number.isNaN(bVal)) {
				comparison = aVal - bVal;
			} else {
				comparison = String(aVal).localeCompare(String(bVal));
			}

			return sortDirection === 'asc' ? comparison : -comparison;
		});

		sortedRows.forEach((row) => tbody.appendChild(row));
		updateSortIndicators();
		filterTable();
	}

	function updateSortIndicators() {
		table?.querySelectorAll('th.sortable').forEach((th) => {
			const indicator = th.querySelector('.sort-indicator');
			if (indicator) {
				indicator.textContent = '';
			}
			if (th.getAttribute('data-sort') === sortColumn) {
				if (indicator) {
					indicator.textContent = sortDirection === 'asc' ? ' ▲' : ' ▼';
				}
			}
		});
	}

	function filterTable() {
		const searchTerm = (searchInput?.value || '').toLowerCase();
		const refTypeValue = refTypeFilter?.value || '';
		const amountValue = amountFilter?.value || '';

		rows.forEach((row) => {
			const rowRefType = row.getAttribute('data-ref-type') || '';
			const rowAmountSign = row.getAttribute('data-amount-sign') || '';
			const description = row.getAttribute('data-description') || '';
			const firstParty = row.getAttribute('data-first-party') || '';
			const secondParty = row.getAttribute('data-second-party') || '';
			const context = row.getAttribute('data-context') || '';
			const reason = row.getAttribute('data-reason') || '';

			const matchesRefType = !refTypeValue || rowRefType === refTypeValue;
			const matchesAmount = !amountValue || rowAmountSign === amountValue;

			const matchesSearch =
				!searchTerm ||
				description.includes(searchTerm) ||
				firstParty.includes(searchTerm) ||
				secondParty.includes(searchTerm) ||
				context.includes(searchTerm) ||
				reason.includes(searchTerm);

			if (matchesRefType && matchesAmount && matchesSearch) {
				row.style.display = '';
				row.removeAttribute('data-filtered');
			} else {
				row.style.display = 'none';
				row.setAttribute('data-filtered', 'true');
			}
		});

		const visibleRows = rows.filter((row) => !row.hasAttribute('data-filtered')).length;
		const footer = table?.querySelector('tfoot td');
		if (footer) {
			footer.textContent =
				'Visible entries: ' + visibleRows.toLocaleString() + ' of ' + rows.length.toLocaleString();
		}

		// Trigger pagination update if available
		if (window['pagination_${tableId}']) {
			window['pagination_${tableId}'].reset();
		}
	}

	table?.querySelectorAll('th.sortable').forEach((header) => {
		header.addEventListener('click', () => {
			const column = header.getAttribute('data-sort');
			if (column) {
				sortTable(column);
			}
		});
	});

	if (searchInput) {
		searchInput.addEventListener('input', filterTable);
	}
	if (refTypeFilter) {
		refTypeFilter.addEventListener('change', filterTable);
	}
	if (amountFilter) {
		amountFilter.addEventListener('change', filterTable);
	}

	filterTable();
	sortTable('date');
})();
`,
					}}
				/>
			</div>
		</section>
	)
}

