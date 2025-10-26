import { Hono } from 'hono'
import { html } from 'hono/html'

import { getStub } from '@repo/do-utils'

import type { Groups } from '@repo/groups'
import type { App } from '../context'

const invite = new Hono<App>()

/**
 * GET /invite/:code
 *
 * Landing page for invite codes with Discord embed support
 * - Shows group information with Open Graph meta tags
 * - For logged-in users: Shows join button
 * - For non-logged-in users: Shows login button
 */
invite.get('/:code', async (c) => {
	const code = c.req.param('code')
	const user = c.get('user')
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	try {
		const result = await groupsDO.getGroupByInviteCode(code, user?.id)
		const { group, inviteCode, canJoin, errorMessage } = result

		// Build the invite URL for meta tags
		const inviteUrl = new URL(c.req.url)
		const baseUrl = `${inviteUrl.protocol}//${inviteUrl.host}`
		const fullInviteUrl = `${baseUrl}/invite/${code}`

		// Prepare meta description
		const metaDescription = group.description || `Join the ${group.name} group on TEST Auth`

		// Prepare status message
		let statusMessage = ''
		let statusClass = ''

		if (errorMessage) {
			statusMessage = errorMessage
			statusClass = 'error'
		} else if (canJoin && user) {
			statusMessage = 'Click the button below to join this group'
			statusClass = 'success'
		} else if (!user) {
			statusMessage = 'Log in to join this group'
			statusClass = 'info'
		}

		// Return HTML with Open Graph meta tags
		return c.html(html`
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="UTF-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1.0" />
					<title>Join ${group.name}</title>

					<!-- Open Graph Meta Tags for Discord/Social Media -->
					<meta property="og:type" content="website" />
					<meta property="og:url" content="${fullInviteUrl}" />
					<meta property="og:title" content="Join ${group.name}" />
					<meta property="og:description" content="${metaDescription}" />
					<meta property="og:site_name" content="EVE Alliance Management" />
					<meta
						property="og:image"
						content="https://images.evetech.net/corporations/1000274/logo?size=512"
					/>
					<meta property="og:image:width" content="512" />
					<meta property="og:image:height" content="512" />

					<!-- Twitter Card Meta Tags -->
					<meta name="twitter:card" content="summary_large_image" />
					<meta name="twitter:title" content="Join ${group.name}" />
					<meta name="twitter:description" content="${metaDescription}" />
					<meta
						name="twitter:image"
						content="https://images.evetech.net/corporations/1000274/logo?size=512"
					/>

					<!-- Standard Meta Tags -->
					<meta name="description" content="${metaDescription}" />

					<style>
						* {
							margin: 0;
							padding: 0;
							box-sizing: border-box;
						}

						body {
							font-family:
								-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
								sans-serif;
							background: hsl(220 18% 8%);
							min-height: 100vh;
							display: flex;
							align-items: center;
							justify-content: center;
							padding: 20px;
							color: hsl(210 12% 95%);
						}

						.container {
							background: linear-gradient(145deg, hsl(220 15% 18%) 0%, hsl(220 16% 12%) 100%);
							border: 1px solid hsl(220 12% 22%);
							border-radius: 12px;
							box-shadow:
								0 8px 30px rgb(0 0 0 / 0.4),
								0 4px 12px rgb(0 0 0 / 0.3),
								inset 0 1px 0 hsl(0 0% 100% / 0.05);
							max-width: 600px;
							width: 100%;
							overflow: hidden;
						}

						.header {
							background: linear-gradient(135deg, hsl(220 16% 16%) 0%, hsl(220 18% 12%) 100%);
							border-bottom: 1px solid hsl(220 12% 22%);
							color: hsl(210 12% 95%);
							padding: 32px;
							text-align: center;
							position: relative;
						}

						.header::before {
							content: '';
							position: absolute;
							top: 0;
							left: 0;
							right: 0;
							height: 2px;
							background: linear-gradient(90deg, transparent, hsl(205 85% 58%), transparent);
							box-shadow: 0 2px 8px hsl(205 85% 58% / 0.3);
						}

						.header h1 {
							font-size: 28px;
							margin-bottom: 8px;
							font-weight: 600;
						}

						.header p {
							font-size: 14px;
							opacity: 0.7;
							color: hsl(210 10% 70%);
						}

						.content {
							padding: 32px;
						}

						.group-info {
							margin-bottom: 24px;
						}

						.group-name {
							font-size: 24px;
							font-weight: 600;
							margin-bottom: 8px;
							color: hsl(210 12% 95%);
						}

						.category-badge {
							display: inline-block;
							background: hsl(220 14% 18%);
							color: hsl(205 85% 58%);
							padding: 4px 12px;
							border-radius: 12px;
							border: 1px solid hsl(205 85% 58% / 0.3);
							font-size: 12px;
							font-weight: 500;
							margin-bottom: 16px;
						}

						.group-description {
							color: hsl(210 10% 70%);
							line-height: 1.6;
							margin-bottom: 16px;
						}

						.group-stats {
							display: flex;
							gap: 24px;
							margin-top: 16px;
							padding-top: 16px;
							border-top: 1px solid hsl(220 12% 22%);
						}

						.stat {
							flex: 1;
						}

						.stat-label {
							font-size: 12px;
							color: hsl(210 10% 70%);
							text-transform: uppercase;
							letter-spacing: 0.5px;
							margin-bottom: 4px;
						}

						.stat-value {
							font-size: 18px;
							font-weight: 600;
							color: hsl(205 85% 58%);
						}

						.status-message {
							padding: 12px 16px;
							border-radius: 8px;
							margin-bottom: 24px;
							font-size: 14px;
							border-left: 3px solid;
						}

						.status-message.success {
							background: hsl(145 65% 48% / 0.15);
							color: hsl(145 65% 58%);
							border-color: hsl(145 65% 48%);
						}

						.status-message.error {
							background: hsl(0 84% 60% / 0.15);
							color: hsl(0 84% 70%);
							border-color: hsl(0 84% 60%);
						}

						.status-message.info {
							background: hsl(205 85% 58% / 0.15);
							color: hsl(205 85% 68%);
							border-color: hsl(205 85% 58%);
						}

						.button {
							display: block;
							width: 100%;
							padding: 14px 24px;
							border: none;
							border-radius: 8px;
							font-size: 16px;
							font-weight: 600;
							cursor: pointer;
							text-align: center;
							text-decoration: none;
							transition: all 0.2s;
							position: relative;
							overflow: hidden;
						}

						.button-primary {
							background: linear-gradient(135deg, hsl(205 85% 58%) 0%, hsl(205 85% 52%) 100%);
							color: hsl(220 18% 8%);
							box-shadow: 0 4px 12px hsl(205 85% 58% / 0.3);
						}

						.button-primary:hover:not(:disabled) {
							transform: translateY(-2px);
							box-shadow: 0 8px 20px hsl(205 85% 58% / 0.4);
						}

						.button-primary:disabled {
							opacity: 0.5;
							cursor: not-allowed;
						}

						.button-secondary {
							background: hsl(220 14% 18%);
							color: hsl(210 12% 95%);
							margin-top: 12px;
							border: 1px solid hsl(220 12% 22%);
						}

						.button-secondary:hover {
							background: hsl(220 14% 22%);
							border-color: hsl(220 12% 28%);
						}

						.loading {
							display: none;
							text-align: center;
							padding: 12px;
							color: hsl(210 10% 70%);
						}

						.loading.active {
							display: block;
						}

						.footer {
							padding: 16px 32px;
							background: hsl(220 18% 10%);
							border-top: 1px solid hsl(220 12% 22%);
							text-align: center;
							font-size: 12px;
							color: hsl(210 10% 70%);
						}

						.invite-details {
							background: hsl(220 18% 10%);
							border: 1px solid hsl(220 12% 22%);
							padding: 16px;
							border-radius: 8px;
							margin-top: 16px;
						}

						.invite-detail {
							display: flex;
							justify-content: space-between;
							padding: 8px 0;
							font-size: 14px;
						}

						.invite-detail-label {
							color: hsl(210 10% 70%);
						}

						.invite-detail-value {
							color: hsl(210 12% 95%);
							font-weight: 500;
						}
					</style>
				</head>
				<body>
					<div class="container">
						<div class="header">
							<h1>Group Invitation</h1>
							<p>TEST Auth</p>
						</div>

						<div class="content">
							<div class="group-info">
								<div class="category-badge">${group.category.name}</div>
								<h2 class="group-name">${group.name}</h2>
								${group.description
									? html`<p class="group-description">${group.description}</p>`
									: ''}

								<div class="group-stats">
									<div class="stat">
										<div class="stat-label">Join Mode</div>
										<div class="stat-value">
											${group.joinMode === 'open'
												? 'Open'
												: group.joinMode === 'approval'
													? 'Approval'
													: 'Invite Only'}
										</div>
									</div>
									${group.memberCount !== undefined
										? html`
												<div class="stat">
													<div class="stat-label">Members</div>
													<div class="stat-value">${group.memberCount}</div>
												</div>
											`
										: ''}
								</div>

								<div class="invite-details">
									<div class="invite-detail">
										<span class="invite-detail-label">Code Status:</span>
										<span class="invite-detail-value">
											${inviteCode.isValid ? '✓ Valid' : '✗ Invalid'}
										</span>
									</div>
									<div class="invite-detail">
										<span class="invite-detail-label">Expires:</span>
										<span class="invite-detail-value">
											${new Date(inviteCode.expiresAt).toLocaleDateString()}
										</span>
									</div>
								</div>
							</div>

							${statusMessage
								? html`<div class="status-message ${statusClass}">${statusMessage}</div>`
								: ''}

							<div id="action-area">
								${user && canJoin
									? html`
											<button class="button button-primary" onclick="joinGroup()">
												Join Group
											</button>
											<div id="loading" class="loading">Joining group...</div>
										`
									: user && !canJoin
										? html`
												<button class="button button-primary" disabled>
													${errorMessage || 'Cannot Join'}
												</button>
											`
										: html`
												<a
													href="/login?redirect=${encodeURIComponent(`/invite/${code}`)}"
													class="button button-primary"
												>
													Log In to Join
												</a>
											`}
							</div>
						</div>

						<div class="footer">
							${user
								? html`Logged in as
									${user.characters.find((c) => c.is_primary)?.characterName || 'User'}`
								: 'Not logged in'}
						</div>
					</div>

					${user && canJoin
						? html`
								<script>
									async function joinGroup() {
										const button = document.querySelector('.button-primary')
										const loading = document.getElementById('loading')
										const actionArea = document.getElementById('action-area')

										button.disabled = true
										loading.classList.add('active')

										try {
											const response = await fetch('/api/groups/invite-codes/redeem', {
												method: 'POST',
												credentials: 'include',
												headers: {
													'Content-Type': 'application/json',
												},
												body: JSON.stringify({ code: '${code}' }),
											})

											const data = await response.json()

											if (response.ok) {
												actionArea.innerHTML =
													'<div class="status-message success">Successfully joined! Redirecting...</div>'
												setTimeout(() => {
													window.location.href = '/groups/' + data.group.id
												}, 1500)
											} else {
												actionArea.innerHTML =
													'<div class="status-message error">' +
													(data.error || 'Failed to join group') +
													'</div>' +
													'<button class="button button-primary" onclick="joinGroup()">Try Again</button>'
											}
										} catch (error) {
											actionArea.innerHTML =
												'<div class="status-message error">An error occurred. Please try again.</div>' +
												'<button class="button button-primary" onclick="joinGroup()">Try Again</button>'
										}
									}
								</script>
							`
						: ''}
				</body>
			</html>
		`)
	} catch (error) {
		// Handle invalid codes gracefully
		if (error instanceof Error && error.message.includes('Invalid invite code')) {
			return c.html(
				html`
					<!DOCTYPE html>
					<html lang="en">
						<head>
							<meta charset="UTF-8" />
							<meta name="viewport" content="width=device-width, initial-scale=1.0" />
							<title>Invalid Invite Code</title>
							<style>
								body {
									font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
									background: hsl(220 18% 8%);
									min-height: 100vh;
									display: flex;
									align-items: center;
									justify-content: center;
									padding: 20px;
									color: hsl(210 12% 95%);
								}
								.container {
									background: linear-gradient(145deg, hsl(220 15% 18%) 0%, hsl(220 16% 12%) 100%);
									border: 1px solid hsl(220 12% 22%);
									border-radius: 16px;
									padding: 48px;
									text-align: center;
									max-width: 500px;
									box-shadow:
										0 8px 30px rgb(0 0 0 / 0.4),
										0 4px 12px rgb(0 0 0 / 0.3),
										inset 0 1px 0 hsl(0 0% 100% / 0.05);
								}
								h1 {
									color: hsl(0 84% 60%);
									margin-bottom: 16px;
									font-size: 28px;
								}
								p {
									color: hsl(210 10% 70%);
									line-height: 1.6;
								}
								.button {
									display: inline-block;
									margin-top: 24px;
									padding: 12px 24px;
									background: linear-gradient(135deg, hsl(205 85% 58%) 0%, hsl(205 85% 52%) 100%);
									color: hsl(220 18% 8%);
									text-decoration: none;
									border-radius: 8px;
									font-weight: 600;
									box-shadow: 0 4px 12px hsl(205 85% 58% / 0.3);
									transition: all 0.2s;
								}
								.button:hover {
									transform: translateY(-2px);
									box-shadow: 0 8px 20px hsl(205 85% 58% / 0.4);
								}
							</style>
						</head>
						<body>
							<div class="container">
								<h1>Invalid Invite Code</h1>
								<p>
									The invite code you're trying to use doesn't exist or has been removed. Please
									check the link and try again.
								</p>
								<a href="/" class="button">Go to Home</a>
							</div>
						</body>
					</html>
				`,
				404
			)
		}

		// Re-throw other errors
		throw error
	}
})

export default invite
