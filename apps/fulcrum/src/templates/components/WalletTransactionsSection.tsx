/**
 * Wallet transactions section component
 * Displays EVE character wallet transactions in a filterable/sortable table with pagination
 */

import type { ProcessedWalletTransactions } from '../../workflows/processors/helpers/wallet-transactions'
import { PaginationControls } from './PaginationControls'

interface WalletTransactionsSectionProps {
	data: ProcessedWalletTransactions
}

export function WalletTransactionsSection({ data }: WalletTransactionsSectionProps) {
	// Debug: Log received data structure
	if (typeof window !== 'undefined') {
		console.log('[WalletTransactionsSection] Received data', {
			dataLength: data.length,
			sampleTransaction: data[0] || null,
			hasClientName: data[0] ? 'clientName' in data[0] : false,
			clientNameValue: data[0]?.clientName,
			clientIdValue: data[0]?.client_id,
		})
	}

	// Debug: Log first transaction details for server-side rendering
	const firstTransaction = data[0]
	if (firstTransaction) {
		console.log('[WalletTransactionsSection] First transaction details', {
			transactionId: firstTransaction.transaction_id,
			typeId: firstTransaction.type_id,
			typeName: firstTransaction.typeName,
			clientId: firstTransaction.client_id,
			clientName: firstTransaction.clientName,
			hasClientName: 'clientName' in firstTransaction,
			clientNameDefined: firstTransaction.clientName !== undefined,
			allKeys: Object.keys(firstTransaction),
		})
	}

	if (data.length === 0) {
		return (
			<section>
				<h2>Wallet Transactions</h2>
				<div>
					<p>No wallet transactions found.</p>
				</div>
			</section>
		)
	}

	// Generate unique ID for this table instance
	const tableId = `wallet-transactions-table-${Date.now()}`

	return (
		<section>
			<h2>Wallet Transactions</h2>
			<div>
				<div className="assets-controls">
					<div className="search-control">
						<label htmlFor={`${tableId}-search`}>Search:</label>
						<input
							type="text"
							id={`${tableId}-search`}
							className="search-input"
							placeholder="Search by item name or client..."
							data-table-id={tableId}
						/>
					</div>
					<div className="filter-control">
						<label htmlFor={`${tableId}-buy-sell`}>Buy/Sell:</label>
						<select
							id={`${tableId}-buy-sell`}
							className="filter-select"
							data-table-id={tableId}
							data-filter="buy-sell"
						>
							<option value="">All</option>
							<option value="buy">Buy</option>
							<option value="sell">Sell</option>
						</select>
					</div>
					<div className="filter-control">
						<label htmlFor={`${tableId}-personal`}>Personal:</label>
						<select
							id={`${tableId}-personal`}
							className="filter-select"
							data-table-id={tableId}
							data-filter="personal"
						>
							<option value="">All</option>
							<option value="true">Yes</option>
							<option value="false">No</option>
						</select>
					</div>
				</div>

				<PaginationControls tableId={tableId} totalItems={data.length} defaultItemsPerPage={25} />

				<div className="table-container">
					<table id={tableId} className="assets-table">
						<thead>
							<tr>
								<th className="sortable" data-sort="date">
									Date <span className="sort-indicator"></span>
								</th>
								<th className="sortable" data-sort="typeName">
									Item Name <span className="sort-indicator"></span>
								</th>
								<th className="sortable" data-sort="quantity">
									Quantity <span className="sort-indicator"></span>
								</th>
								<th className="sortable" data-sort="unitPrice">
									Unit Price <span className="sort-indicator"></span>
								</th>
								<th className="sortable" data-sort="totalValue">
									Total Value <span className="sort-indicator"></span>
								</th>
								<th className="sortable" data-sort="buySell">
									Buy/Sell <span className="sort-indicator"></span>
								</th>
								<th className="sortable" data-sort="client">
									Client <span className="sort-indicator"></span>
								</th>
								<th className="sortable" data-sort="location">
									Location <span className="sort-indicator"></span>
								</th>
								<th className="sortable" data-sort="personal">
									Personal <span className="sort-indicator"></span>
								</th>
							</tr>
						</thead>
						<tbody>
							{data.map((transaction) => (
								<tr
									key={transaction.transaction_id}
									data-type-id={transaction.type_id}
									data-client-id={transaction.client_id}
									data-location-id={transaction.location_id}
									data-type-name={(transaction.typeName || '').toLowerCase()}
									data-client-name={(transaction.clientName || '').toLowerCase()}
									data-location-name={(transaction.locationName || '').toLowerCase()}
									data-is-buy={transaction.is_buy ? 'buy' : 'sell'}
									data-is-personal={transaction.is_personal ? 'true' : 'false'}
									data-date={transaction.date}
									data-quantity={String(transaction.quantity)}
									data-unit-price={String(transaction.unit_price)}
									data-total-value={transaction.totalValue}
								>
									<td>{new Date(transaction.date).toLocaleString()}</td>
									<td>{transaction.typeName || transaction.type_id}</td>
									<td className="number-cell">{transaction.quantity.toLocaleString()}</td>
									<td className="number-cell">
										{transaction.unit_price.toLocaleString(undefined, {
											minimumFractionDigits: 2,
											maximumFractionDigits: 2,
										})}
									</td>
									<td className="number-cell">
										{parseFloat(transaction.totalValue).toLocaleString(undefined, {
											minimumFractionDigits: 2,
											maximumFractionDigits: 2,
										})}
									</td>
									<td className="boolean-cell">{transaction.is_buy ? 'Buy' : 'Sell'}</td>
									<td>{transaction.clientName || transaction.client_id}</td>
									<td>
										{transaction.locationName || transaction.location_id}
									</td>
									<td className="boolean-cell">
										{transaction.is_personal ? 'Yes' : 'No'}
									</td>
								</tr>
							))}
						</tbody>
						<tfoot>
							<tr>
								<td colSpan={9} className="table-footer">
									Total transactions: {data.length.toLocaleString()}
								</td>
							</tr>
						</tfoot>
					</table>
				</div>
				<div className="metadata">
					<p>
						<em>
							Data retrieved:{' '}
							{data[0]?.processedAt
								? new Date(data[0].processedAt).toLocaleString()
								: 'Unknown'}
						</em>
					</p>
				</div>
			</div>
			<script
				dangerouslySetInnerHTML={{
					__html: `
(function() {
	const tableId = '${tableId}';
	const table = document.getElementById(tableId);
	const searchInput = document.getElementById(tableId + '-search');
	const buySellFilter = document.getElementById(tableId + '-buy-sell');
	const personalFilter = document.getElementById(tableId + '-personal');
	const rows = table ? Array.from(table.querySelectorAll('tbody tr')) : [];
	
	let sortColumn = null;
	let sortDirection = 'asc';

	function getCellValue(row, column) {
		const cells = row.querySelectorAll('td');
		switch(column) {
			case 'date':
				return new Date(row.getAttribute('data-date') || 0).getTime();
			case 'typeName':
				return (row.getAttribute('data-type-name') || '').toLowerCase();
			case 'quantity':
				return parseInt(row.getAttribute('data-quantity') || '0');
			case 'unitPrice':
				return parseFloat(row.getAttribute('data-unit-price') || '0');
			case 'totalValue':
				return parseFloat(row.getAttribute('data-total-value') || '0');
			case 'buySell':
				return row.getAttribute('data-is-buy') === 'buy' ? 0 : 1;
			case 'client':
				return (row.getAttribute('data-client-name') || '').toLowerCase();
			case 'location':
				return (row.getAttribute('data-location-name') || '').toLowerCase();
			case 'personal':
				return row.getAttribute('data-is-personal') === 'true' ? 1 : 0;
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
			if (typeof aVal === 'number' && typeof bVal === 'number') {
				comparison = aVal - bVal;
			} else {
				comparison = String(aVal).localeCompare(String(bVal));
			}
			
			return sortDirection === 'asc' ? comparison : -comparison;
		});

		sortedRows.forEach(row => tbody.appendChild(row));
		updateSortIndicators();
		filterTable();
	}

	function updateSortIndicators() {
		const headers = table?.querySelectorAll('th.sortable') || [];
		headers.forEach(header => {
			const indicator = header.querySelector('.sort-indicator');
			const column = header.getAttribute('data-sort');
			if (indicator) {
				if (column === sortColumn) {
					indicator.textContent = sortDirection === 'asc' ? ' ▲' : ' ▼';
					indicator.style.opacity = '1';
				} else {
					indicator.textContent = '';
					indicator.style.opacity = '0';
				}
			}
		});
	}

	function filterTable() {
		const searchTerm = (searchInput?.value || '').toLowerCase();
		const buySell = buySellFilter?.value || '';
		const personal = personalFilter?.value || '';

		rows.forEach((row) => {
			const typeName = row.getAttribute('data-type-name') || '';
			const clientName = row.getAttribute('data-client-name') || '';
			const rowBuySell = row.getAttribute('data-is-buy') === 'buy' ? 'buy' : 'sell';
			const rowPersonal = row.getAttribute('data-is-personal') || '';

			const matchesSearch =
				!searchTerm ||
				typeName.includes(searchTerm) ||
				clientName.includes(searchTerm);

			const matchesBuySell =
				!buySell || rowBuySell === buySell;

			const matchesPersonal =
				!personal || rowPersonal === personal;

			if (matchesSearch && matchesBuySell && matchesPersonal) {
				row.style.display = '';
				row.removeAttribute('data-filtered');
			} else {
				row.style.display = 'none';
				row.setAttribute('data-filtered', 'true');
			}
		});

		// Update footer count
		const visibleRows = rows.filter(
			(row) => !row.hasAttribute('data-filtered')
		).length;
		const footer = table?.querySelector('tfoot td');
		if (footer) {
			footer.textContent = 'Visible transactions: ' + visibleRows.toLocaleString() + ' of ' + rows.length.toLocaleString();
		}

		// Trigger pagination update if available
		if (window['pagination_${tableId}']) {
			window['pagination_${tableId}'].reset();
		}
	}

	// Add click handlers to sortable headers
	const sortableHeaders = table?.querySelectorAll('th.sortable') || [];
	sortableHeaders.forEach(header => {
		header.style.cursor = 'pointer';
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
	if (buySellFilter) {
		buySellFilter.addEventListener('change', filterTable);
	}
	if (personalFilter) {
		personalFilter.addEventListener('change', filterTable);
	}
	
	// Initialize sort indicators
	updateSortIndicators();
	
	// Collapsible section functionality
	const sectionId = 'wallet-transactions-' + tableId;
	const header = document.querySelector('[data-section-id="' + sectionId + '"]');
	const content = document.getElementById(sectionId);
	const indicator = header?.querySelector('.collapse-indicator');
	
	if (header && content && indicator) {
		header.style.cursor = 'pointer';
		header.addEventListener('click', () => {
			const isExpanded = content.style.display !== 'none';
			content.style.display = isExpanded ? 'none' : '';
			indicator.textContent = isExpanded ? '▶' : '▼';
		});
	}
})();
`,
				}}
			/>
		</section>
	)
}

