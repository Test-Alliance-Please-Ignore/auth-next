/**
 * Inline CSS styles for character reports
 * Exported as a string to be embedded in the HTML document
 */

export const reportStyles = `
* {
	margin: 0;
	padding: 0;
	box-sizing: border-box;
}

body {
	font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
	line-height: 1.6;
	color: #333;
	background: #f5f5f5;
	padding: 20px;
}

.container {
	max-width: 1200px;
	margin: 0 auto;
	background: white;
	padding: 30px;
	border-radius: 8px;
	box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

h1 {
	color: #1a1a1a;
	margin-bottom: 10px;
	font-size: 2em;
}

h2 {
	color: #2c3e50;
	margin: 30px 0 15px 0;
	padding-bottom: 10px;
	border-bottom: 2px solid #3498db;
	font-size: 1.5em;
}

section {
	margin-bottom: 30px;
}

.info-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
	gap: 15px;
	margin: 20px 0;
}

.info-item {
	padding: 10px;
	background: #f8f9fa;
	border-radius: 4px;
}

.info-item.full-width {
	grid-column: 1 / -1;
}

.info-item label {
	display: block;
	font-weight: 600;
	color: #555;
	margin-bottom: 5px;
	font-size: 0.9em;
}

.info-item span {
	display: block;
	color: #222;
	font-size: 1.1em;
}

.description {
	white-space: pre-wrap;
	padding: 10px;
	background: white;
	border-left: 3px solid #3498db;
	margin-top: 5px;
}

.metadata {
	margin-top: 20px;
	padding-top: 15px;
	border-top: 1px solid #eee;
	color: #666;
}

.header-info {
	background: #ecf0f1;
	padding: 15px;
	border-radius: 4px;
	margin-bottom: 20px;
}

footer {
	margin-top: 40px;
	padding-top: 20px;
	border-top: 1px solid #eee;
	text-align: center;
	color: #666;
}

/* Collapsible section styles */
.collapsible-section {
	margin: 20px 0;
}

.collapsible-header {
	cursor: pointer;
	user-select: none;
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 15px;
	background: #2c3e50;
	color: white;
	border-radius: 4px;
	margin-bottom: 0;
	transition: background-color 0.2s;
}

.collapsible-header:hover {
	background: #34495e;
}

.collapse-indicator {
	font-size: 0.8em;
	margin-left: 10px;
	transition: transform 0.2s;
}

.collapsible-content {
	padding: 20px;
	border: 1px solid #ddd;
	border-top: none;
	border-radius: 0 0 4px 4px;
	background: white;
}

/* Assets table styles */
.assets-controls {
	display: flex;
	gap: 20px;
	flex-wrap: wrap;
	margin-bottom: 20px;
	padding: 15px;
	background: #f8f9fa;
	border-radius: 4px;
}

.search-control,
.filter-control {
	display: flex;
	align-items: center;
	gap: 10px;
}

.search-control label,
.filter-control label {
	font-weight: 600;
	color: #555;
	font-size: 0.9em;
	white-space: nowrap;
}

.search-input {
	padding: 8px 12px;
	border: 1px solid #ddd;
	border-radius: 4px;
	font-size: 0.95em;
	min-width: 250px;
}

.search-input:focus {
	outline: none;
	border-color: #3498db;
	box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.1);
}

.filter-select {
	padding: 8px 12px;
	border: 1px solid #ddd;
	border-radius: 4px;
	font-size: 0.95em;
	background: white;
	cursor: pointer;
}

.filter-select:focus {
	outline: none;
	border-color: #3498db;
	box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.1);
}

.table-container {
	overflow-x: auto;
	margin: 20px 0;
	border: 1px solid #ddd;
	border-radius: 4px;
}

.assets-table {
	width: 100%;
	border-collapse: collapse;
	background: white;
	font-size: 0.9em;
}

.assets-table thead {
	background: #2c3e50;
	color: white;
}

.assets-table th {
	padding: 12px 10px;
	text-align: left;
	font-weight: 600;
	border-bottom: 2px solid #1a252f;
	position: relative;
}

.assets-table th.sortable {
	cursor: pointer;
	user-select: none;
	transition: background-color 0.2s;
}

.assets-table th.sortable:hover {
	background-color: #34495e;
}

.assets-table th .sort-indicator {
	display: inline-block;
	margin-left: 4px;
	font-size: 0.8em;
	opacity: 0;
	transition: opacity 0.2s;
}

.assets-table th:first-child {
	border-top-left-radius: 4px;
}

.assets-table th:last-child {
	border-top-right-radius: 4px;
}

.assets-table tbody tr {
	border-bottom: 1px solid #eee;
	transition: background-color 0.2s;
}

.assets-table tbody tr:hover {
	background: #f8f9fa;
}

.assets-table tbody tr[style*="display: none"] {
	display: none !important;
}

.assets-table td {
	padding: 10px;
	vertical-align: top;
}

.assets-table .number-cell {
	text-align: right;
	font-variant-numeric: tabular-nums;
}

.assets-table .boolean-cell {
	text-align: center;
	color: #666;
}

.assets-table .location-flag-cell {
	font-family: monospace;
	font-size: 0.85em;
	color: #666;
}

.location-type-badge {
	display: inline-block;
	padding: 4px 8px;
	border-radius: 3px;
	font-size: 0.85em;
	font-weight: 600;
	text-transform: capitalize;
}

.location-type-station {
	background: #e8f5e9;
	color: #2e7d32;
}

.location-type-solar_system {
	background: #e3f2fd;
	color: #1565c0;
}

.location-type-item {
	background: #fff3e0;
	color: #e65100;
}

.location-type-other {
	background: #f3e5f5;
	color: #6a1b9a;
}

.assets-table tfoot {
	background: #f8f9fa;
	border-top: 2px solid #ddd;
}

.assets-table .table-footer {
	padding: 12px 10px;
	text-align: center;
	font-weight: 600;
	color: #555;
}

.wallet-journal-table .ref-type-badge {
	display: inline-block;
	padding: 4px 10px;
	border-radius: 999px;
	background: #eef2ff;
	color: #3949ab;
	font-size: 0.8em;
	font-weight: 600;
	text-transform: capitalize;
}

.amount-cell {
	font-weight: 600;
}

.amount-positive {
	color: #2ecc71;
}

.amount-negative {
	color: #e74c3c;
}

@media (max-width: 768px) {
	.assets-controls {
		flex-direction: column;
	}

	.search-input {
		min-width: 100%;
	}

	.table-container {
		font-size: 0.85em;
	}

	.assets-table th,
	.assets-table td {
		padding: 8px 6px;
	}
}

@media print {
	body {
		background: white;
		padding: 0;
	}

	.container {
		box-shadow: none;
		padding: 0;
	}

	.assets-controls {
		display: none;
	}

	.table-container {
		overflow: visible;
		border: none;
	}
}
`.trim()
