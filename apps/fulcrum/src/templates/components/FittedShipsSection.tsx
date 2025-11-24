/**
 * Fitted ships section component
 * Displays EVE character fitted ships with their modules, rigs, cargo, etc.
 */

import type { FittedShip } from '../../workflows/processors/helpers/ships'

interface FittedShipsSectionProps {
	data: FittedShip[]
}

const slotLabels: Record<string, string> = {
	rigs: 'Rigs',
	highs: 'High Slots',
	meds: 'Medium Slots',
	lows: 'Low Slots',
	drones: 'Drones',
	cargo: 'Cargo',
	fuel: 'Fuel',
	fighters: 'Fighters',
	fighterBay: 'Fighter Bay',
	shipsInSmb: 'Ships in SMB',
	fleetHangar: 'Fleet Hangar',
	subsystems: 'Subsystems',
}

export function FittedShipsSection({ data }: FittedShipsSectionProps) {
	if (data.length === 0) {
		return (
			<section>
				<h2>Fit Ships</h2>
				<p>No fitted ships found.</p>
			</section>
		)
	}

	const sectionId = `fitted-ships-${Date.now()}`

	// Group ships by locationId
	const shipsByLocation = data.reduce((acc, ship) => {
		const locationId = ship.locationId
		if (!acc[locationId]) {
			acc[locationId] = []
		}
		acc[locationId].push(ship)
		return acc
	}, {} as Record<string, FittedShip[]>)

	// Sort location IDs for consistent display
	const locationIds = Object.keys(shipsByLocation).sort()

	return (
		<section>
			<h2>Fit Ships</h2>
			<div>
				<div className="assets-controls">
					<div className="search-control">
						<label htmlFor={`${sectionId}-search`}>Search:</label>
						<input
							type="text"
							id={`${sectionId}-search`}
							className="search-input"
							placeholder="Search by ship name or type..."
							data-section-id={sectionId}
						/>
					</div>
					<div className="filter-control">
						<label htmlFor={`${sectionId}-location-type`}>Location Type:</label>
						<select
							id={`${sectionId}-location-type`}
							className="filter-select"
							data-section-id={sectionId}
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

				<div id={sectionId} className="fitted-ships-container">
					{locationIds.map((locationId) => {
						const ships = shipsByLocation[locationId]
						const locationGroupId = `location-${sectionId}-${locationId}`
						const firstShip = ships[0]

						return (
							<div key={locationGroupId} className="location-group">
								<div className="location-group-header">
									<h3>Location: {locationId}</h3>
									<span className="location-group-meta">
										{firstShip.locationType} • {ships.length} ship{ships.length !== 1 ? 's' : ''}
									</span>
								</div>
								<div className="location-group-ships">
									{ships.map((ship, index) => {
										const shipId = `ship-${sectionId}-${locationId}-${index}`
														const totalItems =
											ship.rigs.length +
											ship.highs.length +
											ship.meds.length +
											ship.lows.length +
											ship.drones.length +
											ship.cargo.length +
											ship.fuel.length +
											ship.fighters.length +
											ship.fighterBay.length +
											ship.shipsInSmb.length +
											ship.fleetHangar.length +
											ship.subsystems.length

										return (
											<div
												key={shipId}
												className="fitted-ship-card"
												data-ship-name={(ship.shipName || '').toLowerCase()}
												data-location-type={ship.locationType}
												data-location-id={ship.locationId}
											>
												<div className="fitted-ship-header collapsible-header" data-ship-id={shipId}>
													<div className="fitted-ship-title">
														<span className="ship-name">{ship.shipName || ship.shipTypeId}</span>
														<span className="ship-meta">
															({totalItems} items) • {ship.locationType} • {ship.locationFlag}
														</span>
													</div>
													<span className="collapse-indicator">▶</span>
												</div>
												<div className="fitted-ship-content collapsible-content" id={shipId} style={{ display: 'none' }}>
													<div className="fitted-ship-info">
														<div className="info-item">
															<label>Ship Type ID:</label>
															<span>{ship.shipTypeId}</span>
														</div>
														<div className="info-item">
															<label>Location ID:</label>
															<span>{ship.locationId}</span>
														</div>
														<div className="info-item">
															<label>Location Flag:</label>
															<span className="location-flag-cell">{ship.locationFlag}</span>
														</div>
														<div className="info-item">
															<label>Location Type:</label>
															<span className={`location-type-badge location-type-${ship.locationType}`}>
																{ship.locationType}
															</span>
														</div>
													</div>

													{/* Rigs */}
													{ship.rigs.length > 0 && (
														<div className="slot-section">
															<h4>{slotLabels.rigs} ({ship.rigs.length})</h4>
															<div className="slot-items">
																{ship.rigs.map((item, itemIndex) => (
																	<div key={`${shipId}-rig-${itemIndex}`} className="slot-item">
																		<span className="item-name">{item.typeName || item.typeId}</span>
																		<span className="item-meta">
																			{item.quantity > 1 && `x${item.quantity}`} • {item.slot}
																		</span>
																	</div>
																))}
															</div>
														</div>
													)}

													{/* High Slots */}
													{ship.highs.length > 0 && (
														<div className="slot-section">
															<h4>{slotLabels.highs} ({ship.highs.length})</h4>
															<div className="slot-items">
																{ship.highs.map((item, itemIndex) => (
																	<div key={`${shipId}-high-${itemIndex}`} className="slot-item">
																		<span className="item-name">{item.typeName || item.typeId}</span>
																		<span className="item-meta">
																			{item.quantity > 1 && `x${item.quantity}`} • {item.slot}
																		</span>
																	</div>
																))}
															</div>
														</div>
													)}

													{/* Medium Slots */}
													{ship.meds.length > 0 && (
														<div className="slot-section">
															<h4>{slotLabels.meds} ({ship.meds.length})</h4>
															<div className="slot-items">
																{ship.meds.map((item, itemIndex) => (
																	<div key={`${shipId}-med-${itemIndex}`} className="slot-item">
																		<span className="item-name">{item.typeName || item.typeId}</span>
																		<span className="item-meta">
																			{item.quantity > 1 && `x${item.quantity}`} • {item.slot}
																		</span>
																	</div>
																))}
															</div>
														</div>
													)}

													{/* Low Slots */}
													{ship.lows.length > 0 && (
														<div className="slot-section">
															<h4>{slotLabels.lows} ({ship.lows.length})</h4>
															<div className="slot-items">
																{ship.lows.map((item, itemIndex) => (
																	<div key={`${shipId}-low-${itemIndex}`} className="slot-item">
																		<span className="item-name">{item.typeName || item.typeId}</span>
																		<span className="item-meta">
																			{item.quantity > 1 && `x${item.quantity}`} • {item.slot}
																		</span>
																	</div>
																))}
															</div>
														</div>
													)}

													{/* Drones */}
													{ship.drones.length > 0 && (
														<div className="slot-section">
															<h4>{slotLabels.drones} ({ship.drones.length})</h4>
															<div className="slot-items">
																{ship.drones.map((item, itemIndex) => (
																	<div key={`${shipId}-drone-${itemIndex}`} className="slot-item">
																		<span className="item-name">{item.typeName || item.typeId}</span>
																		<span className="item-meta">
																			{item.quantity > 1 && `x${item.quantity}`} • {item.slot}
																		</span>
																	</div>
																))}
															</div>
														</div>
													)}

													{/* Cargo */}
													{ship.cargo.length > 0 && (
														<div className="slot-section">
															<h4>{slotLabels.cargo} ({ship.cargo.length})</h4>
															<div className="slot-items">
																{ship.cargo.map((item, itemIndex) => (
																	<div key={`${shipId}-cargo-${itemIndex}`} className="slot-item">
																		<span className="item-name">{item.typeName || item.typeId}</span>
																		<span className="item-meta">
																			{item.quantity > 1 && `x${item.quantity}`} • {item.slot}
																		</span>
																	</div>
																))}
															</div>
														</div>
													)}

													{/* Fuel */}
													{ship.fuel.length > 0 && (
														<div className="slot-section">
															<h4>{slotLabels.fuel} ({ship.fuel.length})</h4>
															<div className="slot-items">
																{ship.fuel.map((item, itemIndex) => (
																	<div key={`${shipId}-fuel-${itemIndex}`} className="slot-item">
																		<span className="item-name">{item.typeName || item.typeId}</span>
																		<span className="item-meta">
																			{item.quantity > 1 && `x${item.quantity}`} • {item.slot}
																		</span>
																	</div>
																))}
															</div>
														</div>
													)}

													{/* Fighters */}
													{ship.fighters.length > 0 && (
														<div className="slot-section">
															<h4>{slotLabels.fighters} ({ship.fighters.length})</h4>
															<div className="slot-items">
																{ship.fighters.map((item, itemIndex) => (
																	<div key={`${shipId}-fighter-${itemIndex}`} className="slot-item">
																		<span className="item-name">{item.typeName || item.typeId}</span>
																		<span className="item-meta">
																			{item.quantity > 1 && `x${item.quantity}`} • {item.slot}
																		</span>
																	</div>
																))}
															</div>
														</div>
													)}

													{/* Fighter Bay */}
													{ship.fighterBay.length > 0 && (
														<div className="slot-section">
															<h4>{slotLabels.fighterBay} ({ship.fighterBay.length})</h4>
															<div className="slot-items">
																{ship.fighterBay.map((item, itemIndex) => (
																	<div key={`${shipId}-fighterbay-${itemIndex}`} className="slot-item">
																		<span className="item-name">{item.typeName || item.typeId}</span>
																		<span className="item-meta">
																			{item.quantity > 1 && `x${item.quantity}`} • {item.slot}
																		</span>
																	</div>
																))}
															</div>
														</div>
													)}

													{/* Ships in SMB */}
													{ship.shipsInSmb.length > 0 && (
														<div className="slot-section">
															<h4>{slotLabels.shipsInSmb} ({ship.shipsInSmb.length})</h4>
															<div className="slot-items">
																{ship.shipsInSmb.map((item, itemIndex) => (
																	<div key={`${shipId}-smb-${itemIndex}`} className="slot-item">
																		<span className="item-name">{item.typeName || item.typeId}</span>
																		<span className="item-meta">
																			{item.quantity > 1 && `x${item.quantity}`} • {item.slot}
																		</span>
																	</div>
																))}
															</div>
														</div>
													)}

													{/* Fleet Hangar */}
													{ship.fleetHangar.length > 0 && (
														<div className="slot-section">
															<h4>{slotLabels.fleetHangar} ({ship.fleetHangar.length})</h4>
															<div className="slot-items">
																{ship.fleetHangar.map((item, itemIndex) => (
																	<div key={`${shipId}-fleet-${itemIndex}`} className="slot-item">
																		<span className="item-name">{item.typeName || item.typeId}</span>
																		<span className="item-meta">
																			{item.quantity > 1 && `x${item.quantity}`} • {item.slot}
																		</span>
																	</div>
																))}
															</div>
														</div>
													)}

													{/* Subsystems */}
													{ship.subsystems.length > 0 && (
														<div className="slot-section">
															<h4>{slotLabels.subsystems} ({ship.subsystems.length})</h4>
															<div className="slot-items">
																{ship.subsystems.map((item, itemIndex) => (
																	<div key={`${shipId}-subsystem-${itemIndex}`} className="slot-item">
																		<span className="item-name">{item.typeName || item.typeId}</span>
																		<span className="item-meta">
																			{item.quantity > 1 && `x${item.quantity}`} • {item.slot}
																		</span>
																	</div>
																))}
															</div>
														</div>
													)}

													{totalItems === 0 && (
														<div className="slot-section">
															<p className="no-items">No items fitted</p>
														</div>
													)}
												</div>
											</div>
										)
									})}
								</div>
							</div>
						)
					})}
				</div>
			</div>
			<script
				dangerouslySetInnerHTML={{
					__html: `
(function() {
	const sectionId = '${sectionId}';
	const container = document.getElementById(sectionId);
	const searchInput = document.getElementById(sectionId + '-search');
	const locationTypeFilter = document.getElementById(sectionId + '-location-type');
	const shipCards = container ? Array.from(container.querySelectorAll('.fitted-ship-card')) : [];
	
	// Collapsible functionality - all ships start collapsed
	shipCards.forEach((card) => {
		const header = card.querySelector('.collapsible-header');
		const content = card.querySelector('.collapsible-content');
		const indicator = header?.querySelector('.collapse-indicator');
		
		if (header && content && indicator) {
			// Initialize as collapsed
			content.style.display = 'none';
			indicator.textContent = '▶';
			header.style.cursor = 'pointer';
			header.addEventListener('click', () => {
				const isExpanded = content.style.display !== 'none';
				content.style.display = isExpanded ? 'none' : '';
				indicator.textContent = isExpanded ? '▶' : '▼';
			});
		}
	});

	function filterShips() {
		const searchTerm = (searchInput?.value || '').toLowerCase();
		const locationType = locationTypeFilter?.value || '';

		shipCards.forEach((card) => {
			const shipName = card.getAttribute('data-ship-name') || '';
			const rowLocationType = card.getAttribute('data-location-type') || '';

			const matchesSearch = !searchTerm || shipName.includes(searchTerm);
			const matchesLocationType = !locationType || rowLocationType === locationType;

			if (matchesSearch && matchesLocationType) {
				card.style.display = '';
				card.removeAttribute('data-filtered');
			} else {
				card.style.display = 'none';
				card.setAttribute('data-filtered', 'true');
			}
		});

		// Hide location groups if all their ships are filtered
		const locationGroups = container ? Array.from(container.querySelectorAll('.location-group')) : [];
		locationGroups.forEach((group) => {
			const groupShips = Array.from(group.querySelectorAll('.fitted-ship-card'));
			const visibleShips = groupShips.filter((ship) => !ship.hasAttribute('data-filtered'));
			if (visibleShips.length === 0) {
				group.style.display = 'none';
			} else {
				group.style.display = '';
			}
		});
	}

	if (searchInput) {
		searchInput.addEventListener('input', filterShips);
	}
	if (locationTypeFilter) {
		locationTypeFilter.addEventListener('change', filterShips);
	}
})();
`,
				}}
			/>
		</section>
	)
}

