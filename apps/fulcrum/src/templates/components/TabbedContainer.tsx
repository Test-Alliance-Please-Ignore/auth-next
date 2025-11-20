/**
 * Tabbed container component for organizing report sections
 * Uses progressive enhancement: CSS-only fallback with JavaScript enhancement
 */

import type { ComponentChildren } from 'preact'

interface Tab {
	id: string
	label: string
	count?: number
	content: ComponentChildren
}

interface TabbedContainerProps {
	tabs: Tab[]
	defaultActiveTab?: string
}

export function TabbedContainer({ tabs, defaultActiveTab }: TabbedContainerProps) {
	const activeTabId = defaultActiveTab || tabs[0]?.id || ''

	return (
		<div className="tab-container">
			{/* Hidden radio inputs for CSS-only functionality */}
			{tabs.map((tab, index) => (
				<input
					key={`radio-${tab.id}`}
					type="radio"
					id={`tab-${tab.id}`}
					name="report-tabs"
					className="tab-radio"
					checked={tab.id === activeTabId}
				/>
			))}

			{/* Tab Navigation */}
			<div className="tab-navigation">
				{tabs.map((tab) => (
					<label
						key={`nav-${tab.id}`}
						htmlFor={`tab-${tab.id}`}
						className="tab-button tab-label"
						data-tab-id={tab.id}
					>
						<span className="tab-text">{tab.label}</span>
						{tab.count !== undefined && <span className="tab-count">({tab.count})</span>}
					</label>
				))}
			</div>

			{/* Tab Content Panels */}
			<div className="tab-panels">
				{tabs.map((tab, index) => (
					<div
						key={`panel-${tab.id}`}
						className={`tab-panel ${tab.id === activeTabId ? 'initial-active' : ''}`}
						data-tab={tab.id}
					>
						<div className="tab-content">{tab.content}</div>
					</div>
				))}
			</div>

			{/* Progressive enhancement JavaScript */}
			<script
				dangerouslySetInnerHTML={{
					__html: `
(function() {
	// Wait for DOM to be ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initTabs);
	} else {
		initTabs();
	}

	function initTabs() {
		const container = document.querySelector('.tab-container');
		if (!container) return;

		// Hide radio buttons when JS is available
		const radios = container.querySelectorAll('.tab-radio');
		radios.forEach(radio => {
			radio.style.position = 'absolute';
			radio.style.opacity = '0';
			radio.style.pointerEvents = 'none';
		});

		const buttons = container.querySelectorAll('.tab-button');
		const panels = container.querySelectorAll('.tab-panel');

		// Find the initially active panel and set corresponding button as active
		let activeIndex = 0;
		panels.forEach((panel, index) => {
			if (panel.classList.contains('initial-active')) {
				activeIndex = index;
			}
			panel.classList.remove('initial-active');
		});

		// Set the active tab based on initial state
		if (buttons[activeIndex]) buttons[activeIndex].classList.add('active');
		if (panels[activeIndex]) panels[activeIndex].classList.add('active');

		// Tab switching functionality
		buttons.forEach((button, index) => {
			button.addEventListener('click', function(e) {
				// Let the label handle the radio button click
				// but add our own visual feedback

				// Remove active states
				buttons.forEach(b => b.classList.remove('active'));
				panels.forEach(p => p.classList.remove('active'));

				// Add active states
				button.classList.add('active');
				if (panels[index]) {
					panels[index].classList.add('active');
				}

				// Store preference
				const tabId = button.getAttribute('data-tab-id');
				if (tabId) {
					try {
						localStorage.setItem('fulcrum-active-tab', tabId);
					} catch (e) {
						// Ignore localStorage errors
					}
				}
			});
		});

		// Restore last active tab
		try {
			const savedTab = localStorage.getItem('fulcrum-active-tab');
			if (savedTab) {
				const savedButton = container.querySelector('[data-tab-id="' + savedTab + '"]');
				const savedIndex = Array.from(buttons).indexOf(savedButton);
				if (savedIndex >= 0 && buttons[savedIndex]) {
					// Click the corresponding radio button to trigger CSS
					const radio = container.querySelector('#tab-' + savedTab);
					if (radio) {
						radio.checked = true;
					}
					// And update our JS classes
					buttons.forEach(b => b.classList.remove('active'));
					panels.forEach(p => p.classList.remove('active'));
					buttons[savedIndex].classList.add('active');
					if (panels[savedIndex]) {
						panels[savedIndex].classList.add('active');
					}
				}
			}
		} catch (e) {
			// Ignore localStorage errors
		}
	}
})();
					`.trim(),
				}}
			/>
		</div>
	)
}