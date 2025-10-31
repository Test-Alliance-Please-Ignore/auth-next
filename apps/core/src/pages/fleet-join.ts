import type { Context } from 'hono'
import type { Fleets, CharacterForFleetJoin } from '@repo/fleets'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import { getStub } from '@repo/do-utils'
import { createEveCharacterId } from '@repo/eve-types'

/**
 * Render the fleet quick join page
 */
export async function renderFleetJoinPage(
	c: Context,
	token: string,
	error?: string
): Promise<string> {
	const user = c.get('user')
	if (!user) {
		return renderErrorPage('Authentication required')
	}

	// Call the Fleets Durable Object directly instead of making HTTP request
	const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')

	try {
		const validation = await fleetsStub.validateQuickJoinToken(token)

		if (!validation.valid || !validation.invitation) {
			return renderErrorPage(validation.error || 'Invalid or expired fleet invitation')
		}

		// Get user's characters from the user object
		const tokenStore = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')
		const characterData = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')

		const charactersWithTokens: CharacterForFleetJoin[] = await Promise.all(
			user.characters.map(async (char: typeof user.characters[number]) => {
				const characterId = char.characterId.toString()

				// Check if character has valid ESI token
				const hasValidToken = (await tokenStore.getAccessToken(characterId)) !== null

				// Get character info and portrait
				const [info, portrait] = await Promise.all([
					characterData.getCharacterInfo(characterId),
					characterData.getPortrait(characterId)
				])

				return {
					characterId,
					characterName: info?.name || char.characterName,
					portrait: portrait
						? {
								px64x64: portrait.px64x64 || '',
								px128x128: portrait.px128x128 || ''
							}
						: undefined,
					hasValidToken
				}
			})
		)

		// Get fleet boss name
		const fleetBossId = validation.invitation.fleetBossId
		const fleetBossInfo = await characterData.getCharacterInfo(fleetBossId)

		const data = {
			valid: true,
			invitation: validation.invitation,
			fleetInfo: validation.fleetInfo,
			fleetBossName: fleetBossInfo?.name || 'Unknown',
			characters: charactersWithTokens
		}

	// Render the character selection page
	return `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Join Fleet - EVE Online</title>
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}

		body {
			background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2a 100%);
			color: #e0e0e0;
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
			min-height: 100vh;
			display: flex;
			justify-content: center;
			align-items: center;
			padding: 1rem;
		}

		.container {
			background: rgba(20, 20, 30, 0.95);
			border-radius: 12px;
			box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
			max-width: 800px;
			width: 100%;
			overflow: hidden;
		}

		.header {
			background: linear-gradient(135deg, #2a2a4a 0%, #1a1a3a 100%);
			padding: 2rem;
			text-align: center;
			border-bottom: 2px solid rgba(255, 255, 255, 0.1);
		}

		.header h1 {
			font-size: 1.8rem;
			margin-bottom: 0.5rem;
			color: #ffffff;
		}

		.fleet-info {
			padding: 1.5rem 2rem;
			background: rgba(30, 30, 45, 0.5);
			border-bottom: 1px solid rgba(255, 255, 255, 0.05);
		}

		.fleet-detail {
			display: flex;
			align-items: center;
			margin: 0.5rem 0;
			font-size: 0.95rem;
		}

		.fleet-detail .label {
			font-weight: 600;
			margin-right: 0.5rem;
			color: #999;
		}

		.fleet-detail .value {
			color: #e0e0e0;
		}

		.fleet-tags {
			display: flex;
			gap: 0.5rem;
			margin-top: 1rem;
			flex-wrap: wrap;
		}

		.tag {
			background: rgba(100, 150, 255, 0.2);
			color: #6496ff;
			padding: 0.25rem 0.75rem;
			border-radius: 20px;
			font-size: 0.85rem;
			border: 1px solid rgba(100, 150, 255, 0.3);
		}

		.tag.inactive {
			background: rgba(150, 150, 150, 0.2);
			color: #999;
			border-color: rgba(150, 150, 150, 0.3);
		}

		.content {
			padding: 2rem;
		}

		.section-title {
			font-size: 1.2rem;
			margin-bottom: 1.5rem;
			color: #ffffff;
			font-weight: 600;
		}

		.error-message {
			background: rgba(220, 53, 69, 0.1);
			color: #ff6b6b;
			padding: 1rem;
			border-radius: 8px;
			margin-bottom: 1.5rem;
			border: 1px solid rgba(220, 53, 69, 0.3);
		}

		.success-message {
			background: rgba(40, 167, 69, 0.1);
			color: #51cf66;
			padding: 1rem;
			border-radius: 8px;
			margin-bottom: 1.5rem;
			border: 1px solid rgba(40, 167, 69, 0.3);
		}

		.characters-grid {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
			gap: 1rem;
			margin-top: 1rem;
		}

		.character-card {
			background: rgba(30, 30, 45, 0.6);
			border: 1px solid rgba(255, 255, 255, 0.1);
			border-radius: 8px;
			padding: 1rem;
			display: flex;
			align-items: center;
			gap: 1rem;
			transition: all 0.3s ease;
			cursor: pointer;
			position: relative;
		}

		.character-card:hover:not(.disabled) {
			background: rgba(40, 40, 60, 0.8);
			border-color: rgba(100, 150, 255, 0.5);
			transform: translateY(-2px);
			box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		}

		.character-card.disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}

		.character-portrait {
			width: 64px;
			height: 64px;
			border-radius: 8px;
			border: 2px solid rgba(255, 255, 255, 0.1);
		}

		.character-info {
			flex: 1;
		}

		.character-name {
			font-size: 1rem;
			font-weight: 600;
			color: #ffffff;
			margin-bottom: 0.25rem;
		}

		.character-status {
			font-size: 0.85rem;
			color: #999;
		}

		.character-status.valid {
			color: #51cf66;
		}

		.character-status.invalid {
			color: #ff6b6b;
		}

		.join-button {
			position: absolute;
			right: 1rem;
			background: linear-gradient(135deg, #4a7fff 0%, #3a5fcf 100%);
			color: white;
			border: none;
			padding: 0.5rem 1.25rem;
			border-radius: 6px;
			font-size: 0.9rem;
			font-weight: 600;
			cursor: pointer;
			transition: all 0.3s ease;
		}

		.join-button:hover {
			background: linear-gradient(135deg, #5a8fff 0%, #4a6fdf 100%);
			transform: translateY(-1px);
			box-shadow: 0 4px 12px rgba(74, 127, 255, 0.3);
		}

		.join-button:disabled {
			background: #444;
			cursor: not-allowed;
			opacity: 0.5;
		}

		.footer {
			padding: 1.5rem 2rem;
			background: rgba(20, 20, 30, 0.5);
			border-top: 1px solid rgba(255, 255, 255, 0.05);
			text-align: center;
			font-size: 0.85rem;
			color: #666;
		}

		.loading {
			display: none;
		}

		.loading.active {
			display: inline-block;
			width: 16px;
			height: 16px;
			border: 2px solid rgba(255, 255, 255, 0.3);
			border-radius: 50%;
			border-top-color: #fff;
			animation: spin 1s linear infinite;
			margin-left: 0.5rem;
		}

		@keyframes spin {
			to { transform: rotate(360deg); }
		}

		@media (max-width: 600px) {
			.characters-grid {
				grid-template-columns: 1fr;
			}

			.header h1 {
				font-size: 1.5rem;
			}

			.container {
				margin: 1rem;
			}
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<h1>Join Fleet</h1>
			<p style="margin-top: 0.5rem; color: #999;">Select a character to join the fleet</p>
		</div>

		<div class="fleet-info">
			<div class="fleet-detail">
				<span class="label">Fleet Commander:</span>
				<span class="value">${data.fleetBossName || 'Unknown'}</span>
			</div>
			${data.fleetInfo?.motd ? `
			<div class="fleet-detail">
				<span class="label">Message:</span>
				<span class="value">${escapeHtml(data.fleetInfo.motd)}</span>
			</div>
			` : ''}
			<div class="fleet-tags">
				${data.fleetInfo?.is_free_move ? '<span class="tag">Free Move</span>' : ''}
				${data.fleetInfo?.is_registered ? '<span class="tag">Registered</span>' : ''}
				${data.fleetInfo?.is_voice_enabled ? '<span class="tag">Voice Enabled</span>' : ''}
			</div>
		</div>

		<div class="content">
			${error ? `<div class="error-message">${escapeHtml(error)}</div>` : ''}

			<h2 class="section-title">Select Character</h2>

			<div class="characters-grid">
				${data.characters?.map(char => `
					<div class="character-card ${!char.hasValidToken ? 'disabled' : ''}" data-character-id="${char.characterId}">
						<img
							src="${char.portrait?.px64x64 || '/default-portrait.png'}"
							alt="${escapeHtml(char.characterName)}"
							class="character-portrait"
						/>
						<div class="character-info">
							<div class="character-name">${escapeHtml(char.characterName)}</div>
							<div class="character-status ${char.hasValidToken ? 'valid' : 'invalid'}">
								${char.hasValidToken ? '✓ Ready to join' : '✗ No ESI access'}
							</div>
						</div>
						${char.hasValidToken ? `
							<button class="join-button" onclick="joinFleet('${char.characterId}', this)">
								Join
								<span class="loading"></span>
							</button>
						` : ''}
					</div>
				`).join('') || '<p style="color: #999;">No characters available</p>'}
			</div>
		</div>

		<div class="footer">
			Fleet invitation expires ${new Date(data.invitation?.expiresAt || '').toLocaleString()}
		</div>
	</div>

	<script>
		async function joinFleet(characterId, button) {
			// Disable all buttons and show loading
			const allButtons = document.querySelectorAll('.join-button');
			allButtons.forEach(btn => btn.disabled = true);

			const loading = button.querySelector('.loading');
			loading.classList.add('active');
			button.textContent = 'Joining...';
			button.appendChild(loading);

			try {
				const response = await fetch('/api/fleets/quick-join/${token}/join', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ characterId }),
					credentials: 'include'
				});

				const result = await response.json();

				if (result.success) {
					// Show success message
					const content = document.querySelector('.content');
					const successMsg = document.createElement('div');
					successMsg.className = 'success-message';
					successMsg.textContent = 'Fleet invitation sent! Check your in-game notifications.';
					content.insertBefore(successMsg, content.firstChild);

					// Disable the successful button permanently
					button.textContent = 'Invited';
					button.disabled = true;
					loading.classList.remove('active');

					// Re-enable other buttons after a delay
					setTimeout(() => {
						allButtons.forEach(btn => {
							if (btn !== button) {
								btn.disabled = false;
							}
						});
					}, 2000);
				} else {
					// Show error and re-enable buttons
					window.location.href = '?error=' + encodeURIComponent(result.error || 'Failed to join fleet');
				}
			} catch (err) {
				console.error('Failed to join fleet:', err);
				window.location.href = '?error=' + encodeURIComponent('Network error. Please try again.');
			}
		}

		function escapeHtml(text) {
			const div = document.createElement('div');
			div.textContent = text;
			return div.innerHTML;
		}
	</script>
</body>
</html>
	`
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : 'Failed to load fleet invitation'
		return renderErrorPage(errorMessage)
	}
}

/**
 * Render an error page
 */
function renderErrorPage(error: string): string {
	return `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Fleet Join Error - EVE Online</title>
	<style>
		body {
			background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2a 100%);
			color: #e0e0e0;
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
			min-height: 100vh;
			display: flex;
			justify-content: center;
			align-items: center;
			padding: 1rem;
		}

		.error-container {
			background: rgba(20, 20, 30, 0.95);
			border-radius: 12px;
			box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
			max-width: 500px;
			width: 100%;
			padding: 3rem;
			text-align: center;
		}

		.error-icon {
			font-size: 4rem;
			color: #ff6b6b;
			margin-bottom: 1rem;
		}

		h1 {
			color: #ffffff;
			font-size: 1.8rem;
			margin-bottom: 1rem;
		}

		.error-message {
			color: #999;
			font-size: 1.1rem;
			line-height: 1.6;
			margin-bottom: 2rem;
		}

		.home-button {
			background: linear-gradient(135deg, #4a7fff 0%, #3a5fcf 100%);
			color: white;
			text-decoration: none;
			padding: 0.75rem 2rem;
			border-radius: 6px;
			font-weight: 600;
			display: inline-block;
			transition: all 0.3s ease;
		}

		.home-button:hover {
			background: linear-gradient(135deg, #5a8fff 0%, #4a6fdf 100%);
			transform: translateY(-2px);
			box-shadow: 0 4px 12px rgba(74, 127, 255, 0.3);
		}
	</style>
</head>
<body>
	<div class="error-container">
		<div class="error-icon">⚠️</div>
		<h1>Unable to Join Fleet</h1>
		<div class="error-message">${escapeHtml(error)}</div>
		<a href="/" class="home-button">Return Home</a>
	</div>
</body>
</html>
	`
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
	const map: Record<string, string> = {
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#039;'
	}
	return text.replace(/[&<>"']/g, (m) => map[m])
}