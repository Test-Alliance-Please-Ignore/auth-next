/**
 * Contacts section component
 * Displays EVE character contacts in a filterable/sortable table with pagination
 */

import type { ProcessedContacts } from '../../workflows/processors/helpers/contacts'
import { PaginationControls } from './PaginationControls'

interface ContactsSectionProps {
	data: ProcessedContacts
}

export function ContactsSection({ data }: ContactsSectionProps) {
	if (data.length === 0) {
		return (
			<section>
				<h2>Contacts List</h2>
				<div>
					<p>No contacts found.</p>
				</div>
			</section>
		)
	}

	// Generate unique ID for this table instance
	const tableId = `contacts-table-${Date.now()}`

	return (
		<section>
			<h2>Contacts List</h2>
			<div>
				<div className="assets-controls">
					<div className="search-control">
						<label htmlFor={`${tableId}-search`}>Search:</label>
						<input
							type="text"
							id={`${tableId}-search`}
							className="search-input"
							placeholder="Search by contact name..."
							data-table-id={tableId}
						/>
					</div>
					<div className="filter-control">
						<label htmlFor={`${tableId}-contact-type`}>Contact Type:</label>
						<select
							id={`${tableId}-contact-type`}
							className="filter-select"
							data-table-id={tableId}
							data-filter="contact-type"
						>
							<option value="">All</option>
							<option value="character">Character</option>
							<option value="corporation">Corporation</option>
							<option value="alliance">Alliance</option>
							<option value="faction">Faction</option>
						</select>
					</div>
					<div className="filter-control">
						<label htmlFor={`${tableId}-standing-range`}>Standing Range:</label>
						<select
							id={`${tableId}-standing-range`}
							className="filter-select"
							data-table-id={tableId}
							data-filter="standing-range"
						>
							<option value="">All</option>
							<option value="positive">Positive (0.1+)</option>
							<option value="negative">Negative (-0.1-)</option>
							<option value="neutral">Neutral (0.0)</option>
							<option value="high-positive">High Positive (5.0+)</option>
							<option value="high-negative">High Negative (-5.0-)</option>
						</select>
					</div>
				</div>

				<PaginationControls tableId={tableId} totalItems={data.length} defaultItemsPerPage={25} />

				<div className="table-container">
					<table id={tableId} className="assets-table">
						<thead>
							<tr>
								<th className="sortable" data-sort="contactName">
									Name <span className="sort-indicator"></span>
								</th>
								<th className="sortable" data-sort="contactType">
									Type <span className="sort-indicator"></span>
								</th>
								<th className="sortable" data-sort="standing">
									Standing <span className="sort-indicator"></span>
								</th>
								<th className="sortable" data-sort="labelIds">
									Label IDs <span className="sort-indicator"></span>
								</th>
								<th className="sortable" data-sort="blocked">
									Blocked <span className="sort-indicator"></span>
								</th>
								<th className="sortable" data-sort="watched">
									Watched <span className="sort-indicator"></span>
								</th>
							</tr>
						</thead>
						<tbody>
							{data.map((contact) => (
								<tr
									key={contact.contact_id}
									data-contact-id={contact.contact_id}
									data-contact-type={contact.contact_type}
									data-standing={String(contact.standing)}
									data-label-ids={(contact.label_ids || []).join(',')}
									data-is-blocked={contact.is_blocked ? 'true' : 'false'}
									data-is-watched={contact.is_watched ? 'true' : 'false'}
									data-contact-name={(contact.contactName || '').toLowerCase()}
								>
									<td>{contact.contactName || contact.contact_id}</td>
									<td className="contact-type-cell">{contact.contact_type}</td>
									<td
										className="standing-cell"
										dangerouslySetInnerHTML={{
											__html: contact.standingFormatted || String(contact.standing),
										}}
									/>
									<td className="label-ids-cell">
										{contact.label_ids && contact.label_ids.length > 0
											? contact.label_ids.join(', ')
											: '—'}
									</td>
									<td className="boolean-cell">
										{contact.is_blocked ? 'Yes' : 'No'}
									</td>
									<td className="boolean-cell">
										{contact.is_watched ? 'Yes' : 'No'}
									</td>
								</tr>
							))}
						</tbody>
						<tfoot>
							<tr>
								<td colSpan={6} className="table-footer">
									Total contacts: {data.length.toLocaleString()}
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
	const contactTypeFilter = document.getElementById(tableId + '-contact-type');
	const standingRangeFilter = document.getElementById(tableId + '-standing-range');
	const rows = table ? Array.from(table.querySelectorAll('tbody tr')) : [];
	
	let sortColumn = null;
	let sortDirection = 'asc';

	function getCellValue(row, column) {
		switch(column) {
			case 'contactName':
				return (row.getAttribute('data-contact-name') || '').toLowerCase();
			case 'contactType':
				return (row.getAttribute('data-contact-type') || '').toLowerCase();
			case 'standing':
				return parseFloat(row.getAttribute('data-standing') || '0');
			case 'labelIds':
				return row.getAttribute('data-label-ids') || '';
			case 'blocked':
				return row.getAttribute('data-is-blocked') === 'true' ? 1 : 0;
			case 'watched':
				return row.getAttribute('data-is-watched') === 'true' ? 1 : 0;
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
		const contactType = contactTypeFilter?.value || '';
		const standingRange = standingRangeFilter?.value || '';

		rows.forEach((row) => {
			const contactName = row.getAttribute('data-contact-name') || '';
			const rowContactType = row.getAttribute('data-contact-type') || '';
			const standing = parseFloat(row.getAttribute('data-standing') || '0');

			const matchesSearch =
				!searchTerm ||
				contactName.includes(searchTerm);

			const matchesContactType =
				!contactType || rowContactType === contactType;

			let matchesStandingRange = true;
			if (standingRange) {
				switch(standingRange) {
					case 'positive':
						matchesStandingRange = standing > 0;
						break;
					case 'negative':
						matchesStandingRange = standing < 0;
						break;
					case 'neutral':
						matchesStandingRange = standing === 0;
						break;
					case 'high-positive':
						matchesStandingRange = standing >= 5.0;
						break;
					case 'high-negative':
						matchesStandingRange = standing <= -5.0;
						break;
					default:
						matchesStandingRange = true;
				}
			}

			if (matchesSearch && matchesContactType && matchesStandingRange) {
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
			footer.textContent = 'Visible contacts: ' + visibleRows.toLocaleString() + ' of ' + rows.length.toLocaleString();
		}

		// Trigger pagination update if available
		if (window['pagination_' + tableId]) {
			window['pagination_' + tableId].reset();
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
	if (contactTypeFilter) {
		contactTypeFilter.addEventListener('change', filterTable);
	}
	if (standingRangeFilter) {
		standingRangeFilter.addEventListener('change', filterTable);
	}
	
	// Initialize sort indicators
	updateSortIndicators();
})();
`,
				}}
			/>
		</section>
	)
}

