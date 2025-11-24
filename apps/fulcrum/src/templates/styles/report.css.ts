/**
 * Inline CSS styles for character reports
 * Exported as a string to be embedded in the HTML document
 */

export const reportStyles = `
/* EVE Online-Inspired Dark Theme CSS Variables */
:root {
	/* Deep space backgrounds - layered depth with blue tint */
	--background: 220 18% 8%; /* #0d0f14 - Deep blue-black space */
	--background-elevated: 220 16% 11%; /* #15171e - Elevated panels */
	--foreground: 210 12% 95%; /* #f0f1f3 - Cool white text */

	/* Card system - layered interface depth */
	--card: 220 16% 12%; /* #191c24 - Card background with blue tint */
	--card-elevated: 220 15% 18%; /* #252935 - Elevated cards */
	--card-foreground: 210 12% 95%;

	/* Primary - Caldari Blue (EVE's tech faction) */
	--primary: 205 85% 58%; /* #3da7f5 - Caldari interface blue */
	--primary-hover: 205 85% 52%; /* #2899ea - Darker on hover */
	--primary-foreground: 220 18% 8%; /* Dark text on primary */

	/* Secondary - Teal/Cyan accents */
	--secondary: 185 62% 48%; /* #2ea5a5 - Cyan tech accent */
	--secondary-foreground: 220 18% 8%;

	/* Accent - Orange/Amber warnings (Caldari UI) */
	--accent: 32 95% 55%; /* #f59e0b - Caldari orange */
	--accent-foreground: 210 12% 95%;

	/* Muted backgrounds - subtle variations */
	--muted: 220 14% 18%; /* #272a34 - Muted dark background */
	--muted-foreground: 210 10% 70%; /* #afb3bb - Muted text */

	/* Success - Green (Gallente inspired) */
	--success: 145 65% 48%; /* #2ba35d - Tech green */
	--success-foreground: 220 18% 8%;

	/* Destructive - Red (Minmatar inspired) */
	--destructive: 0 84% 60%; /* #e63946 - Warning red */
	--destructive-foreground: 0 0% 98%;

	/* Warning - Amber */
	--warning: 38 92% 50%; /* #f59e0b - Warning orange */
	--warning-foreground: 220 18% 8%;

	/* Borders - Layered border system */
	--border: 220 12% 22%; /* #31353f - Subtle border */
	--border-strong: 220 14% 28%; /* #3d4250 - Stronger border */

	/* Input fields */
	--input: 220 16% 16%; /* #1f2430 - Input background */
	--input-border: 220 12% 24%; /* #35394a - Input border */

	/* Elevation System - Consistent shadow depths */
	--elevation-low: 0 2px 8px rgb(0 0 0 / 0.3);
	--elevation-medium: 0 4px 16px rgb(0 0 0 / 0.35);
	--elevation-high: 0 8px 30px rgb(0 0 0 / 0.5);
}

* {
	margin: 0;
	padding: 0;
	box-sizing: border-box;
}

body {
	font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
	line-height: 1.6;
	color: hsl(var(--foreground));
	background: hsl(var(--background));
	padding: 20px;
}

.container {
	max-width: 1200px;
	margin: 0 auto;
	background: hsl(var(--card));
	padding: 30px;
	border-radius: 8px;
	box-shadow: var(--elevation-medium);
	border: 1px solid hsl(var(--border));
}

h1 {
	color: hsl(var(--foreground));
	margin-bottom: 10px;
	font-size: 2em;
}

h2 {
	color: hsl(var(--primary));
	margin: 30px 0 15px 0;
	padding-bottom: 10px;
	border-bottom: 2px solid hsl(var(--primary));
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
	background: hsl(var(--muted));
	border-radius: 4px;
	border: 1px solid hsl(var(--border));
}

.info-item.full-width {
	grid-column: 1 / -1;
}

.info-item label {
	display: block;
	font-weight: 600;
	color: hsl(var(--muted-foreground));
	margin-bottom: 5px;
	font-size: 0.9em;
}

.info-item span {
	display: block;
	color: hsl(var(--foreground));
	font-size: 1.1em;
}

.description {
	white-space: pre-wrap;
	padding: 10px;
	background: hsl(var(--card-elevated));
	border-left: 3px solid hsl(var(--primary));
	margin-top: 5px;
	font-family: inherit;
	font-size: inherit;
	margin: 5px 0 0 0;
	border-radius: 0 4px 4px 0;
}

.metadata {
	margin-top: 20px;
	padding-top: 15px;
	border-top: 1px solid hsl(var(--border));
	color: hsl(var(--muted-foreground));
}

.header-info {
	background: hsl(var(--card-elevated));
	padding: 15px;
	border-radius: 4px;
	margin-bottom: 20px;
	border: 1px solid hsl(var(--border));
}

footer {
	margin-top: 40px;
	padding-top: 20px;
	border-top: 1px solid hsl(var(--border));
	text-align: center;
	color: hsl(var(--muted-foreground));
}

/* Tabbed Container Styles */
.tab-container {
	margin: 30px 0;
	background: hsl(var(--card));
	border-radius: 8px;
	border: 1px solid hsl(var(--border));
	overflow: hidden;
	box-shadow: var(--elevation-low);
}

.tab-navigation {
	display: flex;
	background: hsl(var(--background-elevated));
	border-bottom: 2px solid hsl(var(--border-strong));
	overflow: hidden;
}

/* Hide radio buttons visually but keep them functional for CSS-only fallback */
.tab-radio {
	position: absolute;
	opacity: 0;
	pointer-events: none;
}

.tab-button,
.tab-label {
	flex: 1 1 auto;
	min-width: 150px;
	max-width: 250px;
	padding: 15px 20px;
	background: transparent;
	border: none;
	color: hsl(var(--muted-foreground));
	font-size: 1em;
	font-weight: 500;
	cursor: pointer;
	transition: all 0.3s ease;
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	text-align: center;
	user-select: none;
}

.tab-button:hover,
.tab-label:hover {
	background: hsl(var(--muted) / 0.3);
	color: hsl(var(--foreground));
}

.tab-button.active,
.tab-label.active {
	color: hsl(var(--primary));
	background: hsl(var(--card));
}

.tab-button.active::after,
.tab-label.active::after {
	content: '';
	position: absolute;
	bottom: -2px;
	left: 0;
	right: 0;
	height: 2px;
	background: hsl(var(--primary));
	animation: slideIn 0.3s ease;
}

/* CSS-only tab switching is handled by the ID-based selectors below */

/* Since we can't directly style labels based on radio state with this structure,
   we'll use a different approach with adjacent selectors */
#tab-contacts:checked ~ .tab-navigation label[for="tab-contacts"],
#tab-assets:checked ~ .tab-navigation label[for="tab-assets"],
#tab-transactions:checked ~ .tab-navigation label[for="tab-transactions"],
#tab-journal:checked ~ .tab-navigation label[for="tab-journal"] {
	color: hsl(var(--primary));
	background: hsl(var(--card));
}

#tab-contacts:checked ~ .tab-navigation label[for="tab-contacts"]::after,
#tab-assets:checked ~ .tab-navigation label[for="tab-assets"]::after,
#tab-transactions:checked ~ .tab-navigation label[for="tab-transactions"]::after,
#tab-journal:checked ~ .tab-navigation label[for="tab-journal"]::after {
	content: '';
	position: absolute;
	bottom: -2px;
	left: 0;
	right: 0;
	height: 2px;
	background: hsl(var(--primary));
}

/* Tab panels visibility control */
.tab-panels {
	position: relative;
	min-height: 400px;
}

.tab-panel {
	display: none;
	animation: fadeIn 0.3s ease;
}

.tab-panel.active,
.tab-panel.initial-active {
	display: block;
}

/* Show correct panel based on radio selection */
#tab-contacts:checked ~ .tab-panels > [data-tab="contacts"],
#tab-assets:checked ~ .tab-panels > [data-tab="assets"],
#tab-transactions:checked ~ .tab-panels > [data-tab="transactions"],
#tab-journal:checked ~ .tab-panels > [data-tab="journal"] {
	display: block;
}

.tab-content {
	padding: 20px;
}

.tab-count {
	display: inline-block;
	padding: 2px 6px;
	background: hsl(var(--muted));
	border-radius: 10px;
	font-size: 0.85em;
	font-weight: 600;
	color: hsl(var(--muted-foreground));
	margin-left: 4px;
}

.tab-button.active .tab-count,
.tab-label.active .tab-count {
	background: hsl(var(--primary) / 0.15);
	color: hsl(var(--primary));
}

@keyframes fadeIn {
	from {
		opacity: 0;
		transform: translateY(10px);
	}
	to {
		opacity: 1;
		transform: translateY(0);
	}
}

@keyframes slideIn {
	from {
		transform: scaleX(0);
	}
	to {
		transform: scaleX(1);
	}
}

/* Responsive tabs */
@media (max-width: 768px) {
	.tab-navigation {
		flex-wrap: wrap;
		gap: 2px;
		overflow: hidden;
	}

	.tab-button,
	.tab-label {
		flex: 1 1 auto;
		min-width: calc(33.333% - 2px);
		max-width: none;
		padding: 12px 10px;
		font-size: 0.9em;
	}

	.tab-content {
		padding: 15px;
	}
}

/* Pagination Controls */
.pagination-controls {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 15px;
	background: hsl(var(--card-elevated));
	border: 1px solid hsl(var(--border));
	border-radius: 4px;
	margin: 15px 0;
	flex-wrap: wrap;
	gap: 15px;
}

.pagination-info {
	color: hsl(var(--muted-foreground));
	font-size: 0.9em;
	font-weight: 500;
}

.pagination-text {
	display: inline-block;
}

.pagination-start,
.pagination-end,
.pagination-total {
	color: hsl(var(--foreground));
	font-weight: 600;
}

.pagination-nav-wrapper {
	display: flex;
	align-items: center;
	gap: 20px;
	flex-wrap: wrap;
}

.items-per-page {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 0.9em;
	color: hsl(var(--muted-foreground));
}

.items-per-page label {
	font-weight: 500;
}

.items-per-page-select {
	padding: 6px 10px;
	background: hsl(var(--input));
	border: 1px solid hsl(var(--input-border));
	color: hsl(var(--foreground));
	border-radius: 4px;
	font-size: 0.9em;
	cursor: pointer;
	transition: all 0.2s;
}

.items-per-page-select:hover {
	border-color: hsl(var(--primary));
}

.items-per-page-select:focus {
	outline: none;
	border-color: hsl(var(--primary));
	box-shadow: 0 0 0 2px hsl(var(--primary) / 0.15);
}

.pagination-nav {
	display: flex;
	align-items: center;
	gap: 5px;
}

.pagination-button {
	padding: 6px 12px;
	background: hsl(var(--card));
	border: 1px solid hsl(var(--border));
	color: hsl(var(--foreground));
	border-radius: 4px;
	cursor: pointer;
	transition: all 0.2s;
	font-size: 0.9em;
	font-weight: 500;
	user-select: none;
}

.pagination-button:hover:not(:disabled) {
	background: hsl(var(--primary) / 0.1);
	border-color: hsl(var(--primary));
	color: hsl(var(--primary));
}

.pagination-button:active:not(:disabled) {
	transform: scale(0.98);
}

.pagination-button:disabled {
	opacity: 0.4;
	cursor: not-allowed;
	color: hsl(var(--muted-foreground));
}

.pagination-button.active {
	background: hsl(var(--primary));
	color: hsl(var(--primary-foreground));
	border-color: hsl(var(--primary));
	font-weight: 600;
}

.pagination-button.active:hover {
	background: hsl(var(--primary-hover));
	border-color: hsl(var(--primary-hover));
}

.pagination-pages {
	display: flex;
	align-items: center;
	gap: 5px;
}

.pagination-page {
	min-width: 36px;
	padding: 6px 8px;
}

.pagination-ellipsis {
	padding: 0 8px;
	color: hsl(var(--muted-foreground));
	font-size: 0.9em;
	user-select: none;
}

/* Responsive pagination */
@media (max-width: 768px) {
	.pagination-controls {
		flex-direction: column;
		align-items: stretch;
	}

	.pagination-nav-wrapper {
		flex-direction: column;
		align-items: stretch;
		width: 100%;
	}

	.items-per-page {
		justify-content: space-between;
		width: 100%;
	}

	.pagination-nav {
		justify-content: center;
		width: 100%;
		overflow-x: auto;
		padding: 5px 0;
	}

	.pagination-button {
		font-size: 0.85em;
		padding: 5px 10px;
	}

	.pagination-first,
	.pagination-last {
		display: none; /* Hide First/Last on mobile for space */
	}

	.pagination-page {
		min-width: 32px;
		padding: 5px 6px;
	}
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
	background: hsl(var(--card-elevated));
	color: hsl(var(--foreground));
	border-radius: 4px;
	margin-bottom: 0;
	transition: background-color 0.2s;
	border: 1px solid hsl(var(--border));
}

.collapsible-header:hover {
	background: hsl(var(--muted));
}

.collapse-indicator {
	font-size: 0.8em;
	margin-left: 10px;
	transition: transform 0.2s;
}

.collapsible-content {
	padding: 20px;
	border: 1px solid hsl(var(--border));
	border-top: none;
	border-radius: 0 0 4px 4px;
	background: hsl(var(--card));
}

/* Assets table styles */
.assets-controls {
	display: flex;
	gap: 20px;
	flex-wrap: wrap;
	margin-bottom: 20px;
	padding: 15px;
	background: hsl(var(--muted));
	border-radius: 4px;
	border: 1px solid hsl(var(--border));
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
	color: hsl(var(--muted-foreground));
	font-size: 0.9em;
	white-space: nowrap;
}

.search-input {
	padding: 8px 12px;
	border: 1px solid hsl(var(--input-border));
	border-radius: 4px;
	font-size: 0.95em;
	min-width: 250px;
	background: hsl(var(--input));
	color: hsl(var(--foreground));
}

.search-input:focus {
	outline: none;
	border-color: hsl(var(--primary));
	box-shadow: 0 0 0 2px hsl(var(--primary) / 0.15);
}

.filter-select {
	padding: 8px 12px;
	border: 1px solid hsl(var(--input-border));
	border-radius: 4px;
	font-size: 0.95em;
	background: hsl(var(--input));
	color: hsl(var(--foreground));
	cursor: pointer;
}

.filter-select:focus {
	outline: none;
	border-color: hsl(var(--primary));
	box-shadow: 0 0 0 2px hsl(var(--primary) / 0.15);
}

.table-container {
	overflow-x: auto;
	margin: 20px 0;
	border: 1px solid hsl(var(--border));
	border-radius: 4px;
}

.assets-table {
	width: 100%;
	border-collapse: collapse;
	background: hsl(var(--card));
	font-size: 0.9em;
}

.assets-table thead {
	background: hsl(var(--card-elevated));
	color: hsl(var(--foreground));
}

.assets-table th {
	padding: 12px 10px;
	text-align: left;
	font-weight: 600;
	border-bottom: 2px solid hsl(var(--border-strong));
	position: relative;
}

.assets-table th.sortable {
	cursor: pointer;
	user-select: none;
	transition: background-color 0.2s;
}

.assets-table th.sortable:hover {
	background-color: hsl(var(--muted));
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
	border-bottom: 1px solid hsl(var(--border));
	transition: background-color 0.2s;
}

.assets-table tbody tr:hover {
	background: hsl(var(--muted) / 0.5);
}

.assets-table tbody tr[style*="display: none"] {
	display: none !important;
}

.assets-table td {
	padding: 10px;
	vertical-align: top;
	color: hsl(var(--foreground));
}

.assets-table .number-cell {
	text-align: right;
	font-variant-numeric: tabular-nums;
}

.assets-table .boolean-cell {
	text-align: center;
	color: hsl(var(--muted-foreground));
}

.assets-table .location-flag-cell {
	font-family: monospace;
	font-size: 0.85em;
	color: hsl(var(--muted-foreground));
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
	background: hsl(var(--success) / 0.15);
	color: hsl(var(--success));
}

.location-type-solar_system {
	background: hsl(var(--primary) / 0.15);
	color: hsl(var(--primary));
}

.location-type-item {
	background: hsl(var(--warning) / 0.15);
	color: hsl(var(--warning));
}

.location-type-other {
	background: hsl(var(--secondary) / 0.15);
	color: hsl(var(--secondary));
}

.assets-table tfoot {
	background: hsl(var(--muted));
	border-top: 2px solid hsl(var(--border));
}

.assets-table .table-footer {
	padding: 12px 10px;
	text-align: center;
	font-weight: 600;
	color: hsl(var(--muted-foreground));
}

.wallet-journal-table .ref-type-badge {
	display: inline-block;
	padding: 4px 10px;
	border-radius: 999px;
	background: hsl(var(--primary) / 0.15);
	color: hsl(var(--primary));
	font-size: 0.8em;
	font-weight: 600;
	text-transform: capitalize;
}

.amount-cell {
	font-weight: 600;
}

.amount-positive {
	color: hsl(var(--success));
}

.amount-negative {
	color: hsl(var(--destructive));
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
	/* Override dark theme for printing with light colors */
	:root {
		--background: 0 0% 100%; /* White background */
		--foreground: 0 0% 20%; /* Dark text */
		--card: 0 0% 100%; /* White cards */
		--card-elevated: 0 0% 98%; /* Slightly gray */
		--muted: 0 0% 96%; /* Light gray */
		--muted-foreground: 0 0% 40%; /* Medium gray text */
		--border: 0 0% 85%; /* Light borders */
		--border-strong: 0 0% 70%; /* Medium borders */
		--primary: 205 85% 45%; /* Darker blue for print */
		--success: 145 65% 35%; /* Darker green */
		--destructive: 0 84% 50%; /* Darker red */
		--warning: 38 92% 40%; /* Darker orange */
		--secondary: 185 62% 35%; /* Darker teal */
	}

	body {
		background: white;
		color: black;
		padding: 0;
	}

	.container {
		box-shadow: none;
		padding: 0;
		border: none;
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
