/**
 * Pagination controls component for tables
 * Provides page navigation and items per page selection with progressive enhancement
 */

interface PaginationControlsProps {
	tableId: string
	totalItems: number
	defaultItemsPerPage?: 25 | 50 | 100
	showItemsPerPageSelector?: boolean
}

export function PaginationControls({
	tableId,
	totalItems,
	defaultItemsPerPage = 25,
	showItemsPerPageSelector = true,
}: PaginationControlsProps) {
	// Calculate initial page count based on default items per page
	const initialPageCount = Math.ceil(totalItems / defaultItemsPerPage)

	return (
		<div className="pagination-controls" data-table-id={tableId}>
			<div className="pagination-info">
				<span className="pagination-text">
					Showing <span className="pagination-start">1</span>-
					<span className="pagination-end">{Math.min(defaultItemsPerPage, totalItems)}</span> of{' '}
					<span className="pagination-total">{totalItems}</span> items
				</span>
			</div>

			<div className="pagination-nav-wrapper">
				{showItemsPerPageSelector && (
					<div className="items-per-page">
						<label htmlFor={`${tableId}-per-page`}>Items per page:</label>
						<select
							id={`${tableId}-per-page`}
							className="items-per-page-select"
							data-table-id={tableId}
						>
							<option value="25" selected={defaultItemsPerPage === 25}>
								25
							</option>
							<option value="50" selected={defaultItemsPerPage === 50}>
								50
							</option>
							<option value="100" selected={defaultItemsPerPage === 100}>
								100
							</option>
							<option value="all">All</option>
						</select>
					</div>
				)}

				<div className="pagination-nav">
					<button
						className="pagination-button pagination-first"
						data-action="first"
						data-table-id={tableId}
						disabled
						aria-label="Go to first page"
					>
						First
					</button>
					<button
						className="pagination-button pagination-prev"
						data-action="prev"
						data-table-id={tableId}
						disabled
						aria-label="Go to previous page"
					>
						Previous
					</button>

					<div className="pagination-pages" data-table-id={tableId}>
						{/* Page buttons will be dynamically generated via JavaScript */}
						{/* Initial server-side render shows page 1 as active */}
						<button
							className="pagination-button pagination-page active"
							data-page="1"
							data-table-id={tableId}
							aria-label="Go to page 1"
							aria-current="page"
						>
							1
						</button>
						{initialPageCount > 1 && (
							<button
								className="pagination-button pagination-page"
								data-page="2"
								data-table-id={tableId}
								aria-label="Go to page 2"
							>
								2
							</button>
						)}
						{initialPageCount > 2 && (
							<button
								className="pagination-button pagination-page"
								data-page="3"
								data-table-id={tableId}
								aria-label="Go to page 3"
							>
								3
							</button>
						)}
						{initialPageCount > 5 && (
							<>
								<span className="pagination-ellipsis">...</span>
								<button
									className="pagination-button pagination-page"
									data-page={initialPageCount}
									data-table-id={tableId}
									aria-label={`Go to page ${initialPageCount}`}
								>
									{initialPageCount}
								</button>
							</>
						)}
					</div>

					<button
						className="pagination-button pagination-next"
						data-action="next"
						data-table-id={tableId}
						disabled={initialPageCount <= 1}
						aria-label="Go to next page"
					>
						Next
					</button>
					<button
						className="pagination-button pagination-last"
						data-action="last"
						data-table-id={tableId}
						disabled={initialPageCount <= 1}
						aria-label="Go to last page"
					>
						Last
					</button>
				</div>
			</div>

			{/* Progressive enhancement JavaScript for pagination */}
			<script
				dangerouslySetInnerHTML={{
					__html: `
(function() {
	// Wait for DOM to be ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initPagination);
	} else {
		initPagination();
	}

	function initPagination() {
		const tableId = '${tableId}';
		const controls = document.querySelector('[data-table-id="' + tableId + '"].pagination-controls');
		if (!controls) return;

		// Find the associated table
		const table = document.getElementById(tableId);
		if (!table) return;

		// Pagination state
		let currentPage = 1;
		let itemsPerPage = ${defaultItemsPerPage};
		let totalItems = ${totalItems};
		let filteredItems = totalItems;
		let allRows = [];

		// Initialize rows
		function initRows() {
			const tbody = table.querySelector('tbody');
			if (!tbody) return;

			allRows = Array.from(tbody.querySelectorAll('tr'));

			// Add data attributes for pagination
			allRows.forEach((row, index) => {
				row.setAttribute('data-original-index', index);
			});
		}

		// Update pagination display
		function updatePagination() {
			const visibleRows = allRows.filter(row => {
				// Check if row is filtered out
				const isFiltered = row.style.display === 'none' && row.hasAttribute('data-filtered');
				return !isFiltered;
			});

			filteredItems = visibleRows.length;
			const totalPages = itemsPerPage === 'all' ? 1 : Math.ceil(filteredItems / itemsPerPage);

			// Ensure current page is valid
			if (currentPage > totalPages && totalPages > 0) {
				currentPage = 1;
			}

			// Hide/show rows based on pagination
			const startIndex = itemsPerPage === 'all' ? 0 : (currentPage - 1) * itemsPerPage;
			const endIndex = itemsPerPage === 'all' ? filteredItems : Math.min(startIndex + itemsPerPage, filteredItems);

			let visibleIndex = 0;
			allRows.forEach(row => {
				const isFiltered = row.style.display === 'none' && row.hasAttribute('data-filtered');

				if (isFiltered) {
					// Keep filtered rows hidden
					row.style.display = 'none';
				} else {
					// Show/hide based on pagination
					if (itemsPerPage === 'all' || (visibleIndex >= startIndex && visibleIndex < endIndex)) {
						row.style.display = '';
						row.removeAttribute('data-paginated');
					} else {
						row.style.display = 'none';
						row.setAttribute('data-paginated', 'true');
					}
					visibleIndex++;
				}
			});

			// Update info text
			const infoText = controls.querySelector('.pagination-text');
			if (infoText) {
				const start = filteredItems === 0 ? 0 : startIndex + 1;
				const end = Math.min(endIndex, filteredItems);

				const startSpan = infoText.querySelector('.pagination-start');
				const endSpan = infoText.querySelector('.pagination-end');
				const totalSpan = infoText.querySelector('.pagination-total');

				if (startSpan) startSpan.textContent = start;
				if (endSpan) endSpan.textContent = end;
				if (totalSpan) totalSpan.textContent = filteredItems;
			}

			// Update navigation buttons
			updateNavigationButtons(totalPages);

			// Update page buttons
			updatePageButtons(totalPages);
		}

		// Update navigation button states
		function updateNavigationButtons(totalPages) {
			const firstBtn = controls.querySelector('.pagination-first');
			const prevBtn = controls.querySelector('.pagination-prev');
			const nextBtn = controls.querySelector('.pagination-next');
			const lastBtn = controls.querySelector('.pagination-last');

			if (firstBtn) firstBtn.disabled = currentPage <= 1 || itemsPerPage === 'all';
			if (prevBtn) prevBtn.disabled = currentPage <= 1 || itemsPerPage === 'all';
			if (nextBtn) nextBtn.disabled = currentPage >= totalPages || itemsPerPage === 'all';
			if (lastBtn) lastBtn.disabled = currentPage >= totalPages || itemsPerPage === 'all';
		}

		// Update page number buttons
		function updatePageButtons(totalPages) {
			const pagesContainer = controls.querySelector('.pagination-pages');
			if (!pagesContainer) return;

			pagesContainer.innerHTML = '';

			if (itemsPerPage === 'all' || totalPages <= 1) {
				// Single page or all items shown
				const pageBtn = document.createElement('button');
				pageBtn.className = 'pagination-button pagination-page active';
				pageBtn.textContent = '1';
				pageBtn.setAttribute('data-page', '1');
				pageBtn.setAttribute('aria-current', 'page');
				pagesContainer.appendChild(pageBtn);
				return;
			}

			// Generate page buttons with ellipsis for many pages
			const maxButtons = 7; // Maximum number of buttons to show
			let startPage = 1;
			let endPage = totalPages;

			if (totalPages > maxButtons) {
				const halfButtons = Math.floor(maxButtons / 2);

				if (currentPage <= halfButtons) {
					// Near the beginning
					endPage = maxButtons - 2;
				} else if (currentPage >= totalPages - halfButtons + 1) {
					// Near the end
					startPage = totalPages - maxButtons + 3;
				} else {
					// In the middle
					startPage = currentPage - halfButtons + 2;
					endPage = currentPage + halfButtons - 2;
				}
			}

			// First page
			if (startPage > 1) {
				addPageButton(1, currentPage === 1);
				if (startPage > 2) {
					const ellipsis = document.createElement('span');
					ellipsis.className = 'pagination-ellipsis';
					ellipsis.textContent = '...';
					pagesContainer.appendChild(ellipsis);
				}
			}

			// Middle pages
			for (let i = startPage; i <= endPage; i++) {
				addPageButton(i, currentPage === i);
			}

			// Last page
			if (endPage < totalPages) {
				if (endPage < totalPages - 1) {
					const ellipsis = document.createElement('span');
					ellipsis.className = 'pagination-ellipsis';
					ellipsis.textContent = '...';
					pagesContainer.appendChild(ellipsis);
				}
				addPageButton(totalPages, currentPage === totalPages);
			}

			function addPageButton(pageNum, isActive) {
				const pageBtn = document.createElement('button');
				pageBtn.className = 'pagination-button pagination-page' + (isActive ? ' active' : '');
				pageBtn.textContent = pageNum;
				pageBtn.setAttribute('data-page', pageNum);
				pageBtn.setAttribute('data-table-id', tableId);
				pageBtn.setAttribute('aria-label', 'Go to page ' + pageNum);
				if (isActive) {
					pageBtn.setAttribute('aria-current', 'page');
				}
				pageBtn.addEventListener('click', function() {
					currentPage = pageNum;
					updatePagination();
				});
				pagesContainer.appendChild(pageBtn);
			}
		}

		// Handle items per page change
		const perPageSelect = controls.querySelector('.items-per-page-select');
		if (perPageSelect) {
			perPageSelect.addEventListener('change', function() {
				const value = this.value;
				itemsPerPage = value === 'all' ? 'all' : parseInt(value, 10);
				currentPage = 1;
				updatePagination();
			});
		}

		// Handle navigation buttons
		controls.addEventListener('click', function(e) {
			const button = e.target.closest('.pagination-button');
			if (!button || button.disabled) return;

			const action = button.getAttribute('data-action');
			if (!action) return;

			const visibleRows = allRows.filter(row => {
				const isFiltered = row.style.display === 'none' && row.hasAttribute('data-filtered');
				return !isFiltered;
			});

			const totalPages = itemsPerPage === 'all' ? 1 : Math.ceil(visibleRows.length / itemsPerPage);

			switch(action) {
				case 'first':
					currentPage = 1;
					break;
				case 'prev':
					currentPage = Math.max(1, currentPage - 1);
					break;
				case 'next':
					currentPage = Math.min(totalPages, currentPage + 1);
					break;
				case 'last':
					currentPage = totalPages;
					break;
			}

			updatePagination();
		});

		// Hook into existing filter/search functionality
		// Monitor for changes to row visibility from external filters
		const observeFilters = function() {
			const originalDisplay = Element.prototype.style.display;

			// Watch for programmatic style changes from filters
			Object.defineProperty(Element.prototype.style, 'display', {
				set: function(value) {
					const oldValue = this.display;
					originalDisplay.call(this, value);

					// Check if this is a table row in our table
					if (this.parentElement &&
						this.parentElement.tagName === 'TR' &&
						this.parentElement.closest('table')?.id === tableId) {

						// Small delay to let all filter changes complete
						clearTimeout(window['paginationTimeout_' + tableId]);
						window['paginationTimeout_' + tableId] = setTimeout(() => {
							// Reset to page 1 when filters change
							currentPage = 1;
							updatePagination();
						}, 10);
					}
				},
				get: function() {
					return originalDisplay.call(this);
				}
			});
		};

		// Initialize
		initRows();
		updatePagination();

		// Store reference for external access
		window['pagination_' + tableId] = {
			update: updatePagination,
			reset: function() {
				currentPage = 1;
				updatePagination();
			}
		};
	}
})();
					`.trim(),
				}}
			/>
		</div>
	)
}