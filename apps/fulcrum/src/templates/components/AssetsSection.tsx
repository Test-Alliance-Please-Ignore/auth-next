/**
 * Assets section component
 * Displays EVE character assets in a filterable/searchable table
 */

import type { ProcessedAssets } from '../../workflows/processors/helpers/assets'

interface AssetsSectionProps {
	data: ProcessedAssets
}

export function AssetsSection({ data }: AssetsSectionProps) {
	// Debug: Log received data structure
	if (typeof window !== 'undefined') {
		console.log('[AssetsSection] Received data', {
			dataLength: data.length,
			sampleAsset: data[0] || null,
			hasTypeName: data[0] ? 'typeName' in data[0] : false,
			typeNameValue: data[0]?.typeName,
			typeIdValue: data[0]?.type_id,
		})
	}

	if (data.length === 0) {
		return (
			<section>
				<h2>Assets</h2>
				<p>No assets found.</p>
			</section>
		)
	}

	// Generate unique ID for this table instance
	const tableId = `assets-table-${Date.now()}`

	// Debug: Log first asset details for server-side rendering
	const firstAsset = data[0]
	if (firstAsset) {
		console.log('[AssetsSection] First asset details', {
			typeId: firstAsset.type_id,
			typeName: firstAsset.typeName,
			hasTypeName: 'typeName' in firstAsset,
			typeNameDefined: firstAsset.typeName !== undefined,
			locationId: firstAsset.location_id,
			locationName: firstAsset.locationName,
			allKeys: Object.keys(firstAsset),
		})
	}

	return (
		<section className="collapsible-section">
			<h2 className="collapsible-header" data-section-id={`assets-${tableId}`}>
				Assets
				<span className="collapse-indicator">▼</span>
			</h2>
			<div className="collapsible-content" id={`assets-${tableId}`}>
				<div className="assets-controls">
				<div className="search-control">
					<label htmlFor={`${tableId}-search`}>Search:</label>
					<input
						type="text"
						id={`${tableId}-search`}
						className="search-input"
						placeholder="Search by item name, location, or type..."
						data-table-id={tableId}
					/>
				</div>
				<div className="filter-control">
					<label htmlFor={`${tableId}-location-type`}>Location Type:</label>
					<select
						id={`${tableId}-location-type`}
						className="filter-select"
						data-table-id={tableId}
						data-filter="location_type"
					>
						<option value="">All</option>
						<option value="station">Station</option>
						<option value="solar_system">Solar System</option>
						<option value="item">Item</option>
						<option value="other">Other</option>
					</select>
				</div>
			</div>
			<div className="table-container">
				<table id={tableId} className="assets-table">
					<thead>
						<tr>
							<th className="sortable" data-sort="typeName">
								Item Name <span className="sort-indicator"></span>
							</th>
							<th className="sortable" data-sort="quantity">
								Quantity <span className="sort-indicator"></span>
							</th>
							<th className="sortable" data-sort="location">
								Location <span className="sort-indicator"></span>
							</th>
							<th className="sortable" data-sort="locationFlag">
								Location Flag <span className="sort-indicator"></span>
							</th>
							<th className="sortable" data-sort="blueprintCopy">
								Blueprint Copy <span className="sort-indicator"></span>
							</th>
							<th className="sortable" data-sort="singleton">
								Singleton <span className="sort-indicator"></span>
							</th>
						</tr>
					</thead>
					<tbody>
						{data.map((asset) => (
							<tr
								key={asset.item_id}
								data-type-id={asset.type_id}
								data-location-id={asset.location_id}
								data-location-type={asset.location_type}
								data-location-flag={asset.location_flag}
								data-type-name={(asset.typeName || '').toLowerCase()}
								data-location-name={(asset.locationName || '').toLowerCase()}
							>
								<td>{asset.typeName || asset.type_id}</td>
								<td className="number-cell">{asset.quantity.toLocaleString()}</td>
								<td>
									{asset.location_type === 'station' && asset.locationName
										? asset.locationName
										: asset.location_id}
								</td>
								<td className="location-flag-cell">{asset.location_flag}</td>
								<td className="boolean-cell">
									{asset.is_blueprint_copy ? 'Yes' : 'No'}
								</td>
								<td className="boolean-cell">
									{asset.is_singleton ? 'Yes' : 'No'}
								</td>
							</tr>
						))}
					</tbody>
					<tfoot>
						<tr>
							<td colSpan={6} className="table-footer">
								Total assets: {data.length.toLocaleString()}
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
	const locationTypeFilter = document.getElementById(tableId + '-location-type');
	const rows = table ? Array.from(table.querySelectorAll('tbody tr')) : [];
	
	let sortColumn = null;
	let sortDirection = 'asc';

	function getCellValue(row, column) {
		const cells = row.querySelectorAll('td');
		switch(column) {
			case 'typeName':
				return (row.getAttribute('data-type-name') || '').toLowerCase();
			case 'quantity':
				const qtyText = cells[1]?.textContent || '0';
				return parseInt(qtyText.replace(/,/g, '')) || 0;
			case 'location':
				const locationText = cells[2]?.textContent || '';
				return locationText.toLowerCase();
			case 'locationFlag':
				return (cells[3]?.textContent || '').toLowerCase();
			case 'blueprintCopy':
				return cells[4]?.textContent === 'Yes' ? 1 : 0;
			case 'singleton':
				return cells[5]?.textContent === 'Yes' ? 1 : 0;
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
		const locationType = locationTypeFilter?.value || '';

		rows.forEach((row) => {
			const typeName = row.getAttribute('data-type-name') || '';
			const locationName = row.getAttribute('data-location-name') || '';
			const rowLocationType = row.getAttribute('data-location-type') || '';
			const typeId = row.getAttribute('data-type-id') || '';
			const locationId = row.getAttribute('data-location-id') || '';

			const matchesSearch =
				!searchTerm ||
				typeName.includes(searchTerm) ||
				locationName.includes(searchTerm) ||
				typeId.includes(searchTerm) ||
				locationId.includes(searchTerm);

			const matchesLocationType =
				!locationType || rowLocationType === locationType;

			if (matchesSearch && matchesLocationType) {
				row.style.display = '';
			} else {
				row.style.display = 'none';
			}
		});

		// Update footer count
		const visibleRows = rows.filter(
			(row) => row.style.display !== 'none'
		).length;
		const footer = table?.querySelector('tfoot td');
		if (footer) {
			footer.textContent = 'Visible assets: ' + visibleRows.toLocaleString() + ' of ' + rows.length.toLocaleString();
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
	if (locationTypeFilter) {
		locationTypeFilter.addEventListener('change', filterTable);
	}
	
	// Initialize sort indicators
	updateSortIndicators();
	
	// Collapsible section functionality
	const sectionId = 'assets-' + tableId;
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

