/**
 * Mail List section component
 * Displays EVE character mails with expandable content
 */

import type { ProcessedMails } from '../../workflows/processors/helpers/mails'
import { PaginationControls } from './PaginationControls'

interface MailListProps {
	data: ProcessedMails
}

export function MailList({ data }: MailListProps) {
	if (data.length === 0) {
		return (
			<section>
				<h2>Mail</h2>
				<div>
					<p>No mail found.</p>
				</div>
			</section>
		)
	}

	// Generate unique ID for this table instance
	const tableId = `mails-table-${Date.now()}`

	return (
		<section>
			<h2>Mail</h2>
			<div>
				<div className="assets-controls">
					<div className="search-control">
						<label htmlFor={`${tableId}-search`}>Search:</label>
						<input
							type="text"
							id={`${tableId}-search`}
							className="search-input"
							placeholder="Search by subject or sender..."
							data-table-id={tableId}
						/>
					</div>
					<div className="filter-control">
						<label htmlFor={`${tableId}-read-status`}>Status:</label>
						<select
							id={`${tableId}-read-status`}
							className="filter-select"
							data-table-id={tableId}
							data-filter="read-status"
						>
							<option value="">All</option>
							<option value="unread">Unread</option>
							<option value="read">Read</option>
						</select>
					</div>
				</div>

				<PaginationControls tableId={tableId} totalItems={data.length} defaultItemsPerPage={25} />

				<div className="table-container">
					<table id={tableId} className="assets-table mails-table">
						<thead>
							<tr>
								<th className="mail-expand-col"></th>
								<th className="sortable" data-sort="timestamp">
									Date <span className="sort-indicator"></span>
								</th>
								<th className="sortable" data-sort="fromName">
									From <span className="sort-indicator"></span>
								</th>
								<th>Recipients</th>
								<th className="sortable" data-sort="subject">
									Subject <span className="sort-indicator"></span>
								</th>
								<th className="sortable" data-sort="isRead">
									Status <span className="sort-indicator"></span>
								</th>
							</tr>
						</thead>
						<tbody>
							{data.map((mail) => {
								const rowId = `mail-row-${mail.mail_id || Math.random()}`
								return (
									<>
										<tr
											key={mail.mail_id}
											id={rowId}
											className="mail-header-row"
											data-mail-id={mail.mail_id}
											data-timestamp={mail.timestamp || ''}
											data-from-name={(mail.fromName || '').toLowerCase()}
											data-subject={(mail.subject || '').toLowerCase()}
											data-is-read={mail.is_read ? 'true' : 'false'}
										>
											<td className="mail-expand-cell">
												<button
													className="mail-expand-btn"
													data-row-id={rowId}
													aria-expanded="false"
													aria-label="Toggle mail content"
												>
													▶
												</button>
											</td>
											<td className="mail-date-cell">
												{mail.timestampFormatted || mail.timestamp || 'Unknown'}
											</td>
											<td className="mail-from-cell">
												{mail.fromName || mail.from || 'Unknown'}
											</td>
											<td className="mail-recipients-cell">
												{mail.recipients && mail.recipients.length > 0 ? (
													<span className="recipients-list">
														{mail.recipients.map((r, idx) => (
															<span key={idx}>
																{r.recipientName || r.recipient_id}
																<span className="recipient-type">
																	{' '}
																	({r.recipient_type})
																</span>
																{idx < mail.recipients!.length - 1 ? ', ' : ''}
															</span>
														))}
													</span>
												) : (
													'—'
												)}
											</td>
											<td className="mail-subject-cell">{mail.subject || 'No subject'}</td>
											<td className="mail-status-cell">
												<span
													className={`mail-status ${
														mail.is_read ? 'status-read' : 'status-unread'
													}`}
												>
													{mail.is_read ? 'Read' : 'Unread'}
												</span>
											</td>
										</tr>
										<tr
											className="mail-content-row"
											data-content-for={rowId}
											style={{ display: 'none' }}
										>
											<td colSpan={6}>
												<div className="mail-content">
													{mail.bodyPlainText || mail.body ? (
														<pre className="mail-body">{mail.bodyPlainText || mail.body}</pre>
													) : (
														<p className="no-content">No mail content available</p>
													)}
													{mail.labels && mail.labels.length > 0 && (
														<div className="mail-labels">
															<strong>Labels:</strong> {mail.labels.join(', ')}
														</div>
													)}
												</div>
											</td>
										</tr>
									</>
								)
							})}
						</tbody>
						<tfoot>
							<tr>
								<td colSpan={6} className="table-footer">
									Total mails: {data.length.toLocaleString()}
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
	const readStatusFilter = document.getElementById(tableId + '-read-status');
	const rows = table ? Array.from(table.querySelectorAll('.mail-header-row')) : [];

	let sortColumn = null;
	let sortDirection = 'desc'; // Default to newest first for timestamp

	function getCellValue(row, column) {
		switch(column) {
			case 'timestamp':
				const timestamp = row.getAttribute('data-timestamp');
				return timestamp ? new Date(timestamp).getTime() : 0;
			case 'fromName':
				return row.getAttribute('data-from-name') || '';
			case 'subject':
				return row.getAttribute('data-subject') || '';
			case 'isRead':
				return row.getAttribute('data-is-read') === 'true' ? 1 : 0;
			default:
				return '';
		}
	}

	function sortTable(column) {
		if (sortColumn === column) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortColumn = column;
			sortDirection = column === 'timestamp' ? 'desc' : 'asc';
		}

		const tbody = table?.querySelector('tbody');
		if (!tbody) return;

		// Get all rows including content rows
		const allRows = Array.from(tbody.querySelectorAll('tr'));
		const mailGroups = [];

		// Group header and content rows together
		for (let i = 0; i < allRows.length; i++) {
			if (allRows[i].classList.contains('mail-header-row')) {
				const group = [allRows[i]];
				if (allRows[i + 1] && allRows[i + 1].classList.contains('mail-content-row')) {
					group.push(allRows[i + 1]);
					i++; // Skip the content row in the next iteration
				}
				mailGroups.push(group);
			}
		}

		// Sort mail groups by their header row
		const sortedGroups = mailGroups.sort((a, b) => {
			const aVal = getCellValue(a[0], column);
			const bVal = getCellValue(b[0], column);

			let comparison = 0;
			if (typeof aVal === 'number' && typeof bVal === 'number') {
				comparison = aVal - bVal;
			} else {
				comparison = String(aVal).localeCompare(String(bVal));
			}

			return sortDirection === 'asc' ? comparison : -comparison;
		});

		// Re-append sorted groups to tbody
		sortedGroups.forEach(group => {
			group.forEach(row => tbody.appendChild(row));
		});

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
		const readStatus = readStatusFilter?.value || '';

		rows.forEach((row) => {
			const fromName = row.getAttribute('data-from-name') || '';
			const subject = row.getAttribute('data-subject') || '';
			const isRead = row.getAttribute('data-is-read') === 'true';
			const contentRow = row.nextElementSibling;

			const matchesSearch =
				!searchTerm ||
				fromName.includes(searchTerm) ||
				subject.includes(searchTerm);

			const matchesReadStatus =
				!readStatus ||
				(readStatus === 'read' && isRead) ||
				(readStatus === 'unread' && !isRead);

			if (matchesSearch && matchesReadStatus) {
				row.style.display = '';
				row.removeAttribute('data-filtered');
			} else {
				row.style.display = 'none';
				row.setAttribute('data-filtered', 'true');
				// Also hide content row if header is hidden
				if (contentRow && contentRow.classList.contains('mail-content-row')) {
					contentRow.style.display = 'none';
				}
			}
		});

		// Update footer count
		const visibleRows = rows.filter(
			(row) => !row.hasAttribute('data-filtered')
		).length;
		const footer = table?.querySelector('tfoot td');
		if (footer) {
			footer.textContent = 'Visible mails: ' + visibleRows.toLocaleString() + ' of ' + rows.length.toLocaleString();
		}

		// Trigger pagination update if available
		if (window['pagination_' + tableId]) {
			window['pagination_' + tableId].reset();
		}
	}

	// Handle mail content expansion
	function toggleMailContent(button) {
		const rowId = button.getAttribute('data-row-id');
		const contentRow = document.querySelector('[data-content-for="' + rowId + '"]');

		if (contentRow) {
			const isExpanded = button.getAttribute('aria-expanded') === 'true';

			if (isExpanded) {
				contentRow.style.display = 'none';
				button.setAttribute('aria-expanded', 'false');
				button.textContent = '▶';
			} else {
				contentRow.style.display = '';
				button.setAttribute('aria-expanded', 'true');
				button.textContent = '▼';
			}
		}
	}

	// Add click handlers to expand buttons
	const expandButtons = table?.querySelectorAll('.mail-expand-btn') || [];
	expandButtons.forEach(button => {
		button.addEventListener('click', () => toggleMailContent(button));
	});

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
	if (readStatusFilter) {
		readStatusFilter.addEventListener('change', filterTable);
	}

	// Initialize with default sort by timestamp (newest first)
	sortColumn = 'timestamp';
	updateSortIndicators();
})();
`,
				}}
			/>
			<style
				dangerouslySetInnerHTML={{
					__html: `
.mails-table {
	width: 100%;
	border-collapse: collapse;
}

.mail-expand-col {
	width: 30px;
}

.mail-expand-btn {
	background: none;
	border: none;
	cursor: pointer;
	padding: 4px 8px;
	font-size: 12px;
	transition: transform 0.2s;
}

.mail-expand-btn:hover {
	background-color: rgba(255, 255, 255, 0.1);
}

.mail-header-row {
	border-top: 1px solid #444;
}

.mail-content-row td {
	padding: 0;
	border: none;
}

.mail-content {
	padding: 20px;
	background-color: #2a2a2e;
	border-top: 1px solid #444;
}

.mail-body {
	line-height: 1.6;
	white-space: pre-wrap;
	word-wrap: break-word;
	color: #e0e0e0;
	font-family: inherit;
	font-size: 14px;
	margin: 0;
	padding: 0;
}

.mail-labels {
	margin-top: 15px;
	padding-top: 10px;
	border-top: 1px solid #444;
	color: #999;
}

.no-content {
	color: #777;
	font-style: italic;
}

.mail-status {
	display: inline-block;
	padding: 2px 8px;
	border-radius: 3px;
	font-size: 12px;
	font-weight: 500;
}

.status-unread {
	background-color: rgba(33, 150, 243, 0.2);
	color: #64b5f6;
}

.status-read {
	background-color: rgba(255, 255, 255, 0.1);
	color: #999;
}

.recipients-list {
	font-size: 14px;
}

.recipient-type {
	color: #999;
	font-size: 12px;
}

.eve-link {
	color: #0066cc;
	cursor: help;
	text-decoration: underline dotted;
}
`,
				}}
			/>
		</section>
	)
}