export const testPageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Fleet Monitor Test</title>
	<style>
		* {
			box-sizing: border-box;
			margin: 0;
			padding: 0;
		}

		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
			background: #0a0a0a;
			color: #e0e0e0;
			padding: 20px;
			line-height: 1.6;
		}

		.container {
			max-width: 1200px;
			margin: 0 auto;
		}

		h1 {
			color: #4a9eff;
			margin-bottom: 20px;
		}

		.controls {
			background: #1a1a1a;
			border: 1px solid #333;
			border-radius: 8px;
			padding: 20px;
			margin-bottom: 20px;
		}

		.input-group {
			margin-bottom: 15px;
		}

		label {
			display: block;
			margin-bottom: 5px;
			color: #aaa;
			font-size: 14px;
		}

		input {
			width: 100%;
			padding: 10px;
			background: #0a0a0a;
			border: 1px solid #333;
			border-radius: 4px;
			color: #e0e0e0;
			font-size: 14px;
		}

		input:focus {
			outline: none;
			border-color: #4a9eff;
		}

		.button-group {
			display: flex;
			gap: 10px;
			flex-wrap: wrap;
		}

		button {
			padding: 10px 20px;
			background: #4a9eff;
			border: none;
			border-radius: 4px;
			color: white;
			cursor: pointer;
			font-size: 14px;
			font-weight: 500;
			transition: background 0.2s;
		}

		button:hover:not(:disabled) {
			background: #3a8eef;
		}

		button:disabled {
			background: #333;
			cursor: not-allowed;
			opacity: 0.5;
		}

		button.danger {
			background: #ff4a4a;
		}

		button.danger:hover:not(:disabled) {
			background: #ee3a3a;
		}

		.status {
			background: #1a1a1a;
			border: 1px solid #333;
			border-radius: 8px;
			padding: 15px;
			margin-bottom: 20px;
		}

		.status-item {
			display: flex;
			align-items: center;
			gap: 10px;
			margin-bottom: 10px;
		}

		.status-indicator {
			width: 12px;
			height: 12px;
			border-radius: 50%;
			background: #333;
		}

		.status-indicator.connected {
			background: #4aff4a;
			box-shadow: 0 0 8px #4aff4a;
		}

		.status-indicator.disconnected {
			background: #ff4a4a;
		}

		.messages {
			background: #1a1a1a;
			border: 1px solid #333;
			border-radius: 8px;
			padding: 20px;
			margin-bottom: 20px;
			max-height: 400px;
			overflow-y: auto;
		}

		.messages h2 {
			color: #4a9eff;
			margin-bottom: 15px;
			font-size: 18px;
		}

		.message {
			background: #0a0a0a;
			border-left: 3px solid #4a9eff;
			padding: 10px;
			margin-bottom: 10px;
			border-radius: 4px;
			font-size: 13px;
		}

		.message.error {
			border-left-color: #ff4a4a;
		}

		.message.success {
			border-left-color: #4aff4a;
		}

		.message-time {
			color: #666;
			font-size: 11px;
			margin-bottom: 5px;
		}

		.fleet-status {
			background: #1a1a1a;
			border: 1px solid #333;
			border-radius: 8px;
			padding: 20px;
		}

		.fleet-status h2 {
			color: #4a9eff;
			margin-bottom: 15px;
			font-size: 18px;
		}

		.fleet-info {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
			gap: 15px;
			margin-bottom: 20px;
		}

		.info-item {
			background: #0a0a0a;
			padding: 10px;
			border-radius: 4px;
		}

		.info-label {
			color: #aaa;
			font-size: 12px;
			margin-bottom: 5px;
		}

		.info-value {
			color: #e0e0e0;
			font-size: 14px;
			font-weight: 500;
		}

		.members-list {
			margin-top: 20px;
		}

		.members-list h3 {
			color: #4a9eff;
			margin-bottom: 10px;
			font-size: 16px;
		}

		.member-item {
			background: #0a0a0a;
			padding: 10px;
			margin-bottom: 8px;
			border-radius: 4px;
			border-left: 3px solid #4a9eff;
		}

		.member-name {
			color: #e0e0e0;
			font-weight: 500;
			margin-bottom: 5px;
		}

		.member-details {
			color: #aaa;
			font-size: 12px;
		}

		pre {
			background: #0a0a0a;
			padding: 10px;
			border-radius: 4px;
			overflow-x: auto;
			font-size: 12px;
			margin-top: 10px;
		}
	</style>
</head>
<body>
	<div class="container">
		<h1>Fleet Monitor Test</h1>

		<div class="controls">
			<div class="input-group">
				<label for="fleetId">Fleet ID</label>
				<input type="text" id="fleetId" placeholder="Enter fleet ID" value="">
			</div>
			<div class="button-group">
				<button id="connectWs">Connect WebSocket</button>
				<button id="disconnectWs" disabled>Disconnect</button>
				<button id="fetchStatus">Fetch Status (HTTP)</button>
				<button id="clearMessages">Clear Messages</button>
			</div>
		</div>

		<div class="status">
			<div class="status-item">
				<div class="status-indicator disconnected" id="wsStatus"></div>
				<span>WebSocket: <strong id="wsStatusText">Disconnected</strong></span>
			</div>
		</div>

		<div class="messages">
			<h2>Messages</h2>
			<div id="messagesList"></div>
		</div>

		<div class="fleet-status">
			<h2>Fleet Status</h2>
			<div id="fleetStatusContent">
				<p style="color: #666;">No fleet data loaded yet. Connect WebSocket or fetch status to see data.</p>
			</div>
		</div>
	</div>

	<script>
		let ws = null;
		const baseUrl = window.location.origin;
		const messagesList = document.getElementById('messagesList');
		const fleetStatusContent = document.getElementById('fleetStatusContent');
		const wsStatus = document.getElementById('wsStatus');
		const wsStatusText = document.getElementById('wsStatusText');
		const fleetIdInput = document.getElementById('fleetId');
		const connectBtn = document.getElementById('connectWs');
		const disconnectBtn = document.getElementById('disconnectWs');
		const fetchStatusBtn = document.getElementById('fetchStatus');
		const clearMessagesBtn = document.getElementById('clearMessages');

		function addMessage(message, type = 'info') {
			const messageDiv = document.createElement('div');
			messageDiv.className = \`message \${type}\`;
			const time = new Date().toLocaleTimeString();
			messageDiv.innerHTML = \`
				<div class="message-time">\${time}</div>
				<div>\${message}</div>
			\`;
			messagesList.appendChild(messageDiv);
			messagesList.scrollTop = messagesList.scrollHeight;
		}

		function updateWsStatus(connected) {
			if (connected) {
				wsStatus.className = 'status-indicator connected';
				wsStatusText.textContent = 'Connected';
				connectBtn.disabled = true;
				disconnectBtn.disabled = false;
			} else {
				wsStatus.className = 'status-indicator disconnected';
				wsStatusText.textContent = 'Disconnected';
				connectBtn.disabled = false;
				disconnectBtn.disabled = true;
			}
		}

		function displayFleetStatus(data) {
			if (!data) {
				fleetStatusContent.innerHTML = '<p style="color: #666;">No fleet data available.</p>';
				return;
			}

			const fleetInfo = data.fleetInfo || {};
			const members = data.members || [];
			const memberCount = data.memberCount || members.length;
			const shipTypeNames = data.shipTypeNames || {};
			const characterNames = data.characterNames || {};
			const systemNames = data.systemNames || {};
			const stationNames = data.stationNames || {};

			let html = \`
				<div class="fleet-info">
					<div class="info-item">
						<div class="info-label">Fleet Boss</div>
						<div class="info-value">\${data.fleetBossName || 'Unknown'}</div>
					</div>
					<div class="info-item">
						<div class="info-label">Member Count</div>
						<div class="info-value">\${memberCount}</div>
					</div>
					<div class="info-item">
						<div class="info-label">Free Move</div>
						<div class="info-value">\${fleetInfo.is_free_move ? 'Yes' : 'No'}</div>
					</div>
					<div class="info-item">
						<div class="info-label">Registered</div>
						<div class="info-value">\${fleetInfo.is_registered ? 'Yes' : 'No'}</div>
					</div>
					<div class="info-item">
						<div class="info-label">Voice Enabled</div>
						<div class="info-value">\${fleetInfo.is_voice_enabled ? 'Yes' : 'No'}</div>
					</div>
				</div>
			\`;

			if (fleetInfo.motd) {
				html += \`
					<div class="info-item" style="margin-bottom: 20px;">
						<div class="info-label">MOTD</div>
						<div class="info-value">\${fleetInfo.motd}</div>
					</div>
				\`;
			}

			if (members.length > 0) {
				html += \`
					<div class="members-list">
						<h3>Members (\${members.length})</h3>
						\${members.map(member => {
							const shipTypeId = String(member.ship_type_id);
							const shipName = shipTypeNames[shipTypeId] || shipTypeId;
							const characterId = String(member.character_id);
							const characterName = characterNames[characterId] || characterId;
							const systemId = String(member.solar_system_id);
							const systemName = systemNames[systemId] || systemId;
							const stationId = member.station_id ? String(member.station_id) : null;
							const stationName = stationId && stationNames[stationId] ? stationNames[stationId] : stationId;
							return \`
							<div class="member-item">
								<div class="member-name">\${characterName}</div>
								<div class="member-details">
									Ship: \${shipName} | 
									System: \${systemName} | 
									Role: \${member.role_name} | 
									Wing: \${member.wing_id} | 
									Squad: \${member.squad_id}
									\${stationName ? \` | Station: \${stationName}\` : ''}
								</div>
							</div>
						\`;
						}).join('')}
					</div>
				\`;
			}

			html += \`
				<details style="margin-top: 20px;">
					<summary style="color: #aaa; cursor: pointer; margin-bottom: 10px;">Raw JSON Data</summary>
					<pre>\${JSON.stringify(data, null, 2)}</pre>
				</details>
			\`;

			fleetStatusContent.innerHTML = html;
		}

		connectBtn.addEventListener('click', () => {
			const fleetId = fleetIdInput.value.trim();
			if (!fleetId) {
				addMessage('Please enter a fleet ID', 'error');
				return;
			}

			const wsUrl = \`\${baseUrl}/fleet-monitor/\${fleetId}/ws\`;
			addMessage(\`Connecting to WebSocket: \${wsUrl}\`, 'info');

			try {
				ws = new WebSocket(wsUrl);

				ws.onopen = () => {
					addMessage('WebSocket connected', 'success');
					updateWsStatus(true);
					// Subscribe to updates
					ws.send(JSON.stringify({ type: 'subscribe' }));
				};

				ws.onmessage = (event) => {
					try {
						const data = JSON.parse(event.data);
						addMessage(\`Received: \${data.type}\`, 'info');

						if (data.type === 'fleet_update' || data.type === 'fleet_status') {
							displayFleetStatus(data.data);
						} else if (data.type === 'pong') {
							addMessage(\`Pong received: \${data.payload}\`, 'info');
						} else if (data.type === 'subscribed') {
							addMessage('Subscribed to fleet updates', 'success');
						} else if (data.type === 'error') {
							addMessage(\`Error: \${data.payload}\`, 'error');
						}
					} catch (error) {
						addMessage(\`Failed to parse message: \${event.data}\`, 'error');
					}
				};

				ws.onerror = (error) => {
					addMessage('WebSocket error occurred', 'error');
					console.error('WebSocket error:', error);
				};

				ws.onclose = () => {
					addMessage('WebSocket disconnected', 'info');
					updateWsStatus(false);
					ws = null;
				};
			} catch (error) {
				addMessage(\`Failed to connect: \${error.message}\`, 'error');
				updateWsStatus(false);
			}
		});

		disconnectBtn.addEventListener('click', () => {
			if (ws) {
				ws.send(JSON.stringify({ type: 'unsubscribe' }));
				ws.close();
				ws = null;
			}
		});

		fetchStatusBtn.addEventListener('click', async () => {
			const fleetId = fleetIdInput.value.trim();
			if (!fleetId) {
				addMessage('Please enter a fleet ID', 'error');
				return;
			}

			const statusUrl = \`\${baseUrl}/fleet-monitor/\${fleetId}/status\`;
			addMessage(\`Fetching status from: \${statusUrl}\`, 'info');

			try {
				const response = await fetch(statusUrl);
				if (!response.ok) {
					const error = await response.json();
					addMessage(\`Error: \${error.error || error.message || response.statusText}\`, 'error');
					return;
				}

				const data = await response.json();
				addMessage('Status fetched successfully', 'success');
				displayFleetStatus(data);
			} catch (error) {
				addMessage(\`Failed to fetch status: \${error.message}\`, 'error');
			}
		});

		clearMessagesBtn.addEventListener('click', () => {
			messagesList.innerHTML = '';
		});

		// Auto-connect on Enter key in fleetId input
		fleetIdInput.addEventListener('keypress', (e) => {
			if (e.key === 'Enter' && !ws) {
				connectBtn.click();
			}
		});
	</script>
</body>
</html>`

