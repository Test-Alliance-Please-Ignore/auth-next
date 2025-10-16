import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getRequestLogData, logger, withNotFound, withOnError } from '@repo/hono-helpers'

import type { App } from './context'
import { OIDCClient } from './oidc-client'

const GOOGLE_OAUTH_SCOPES = ['openid', 'email', 'profile']

const app = new Hono<App>()
	.basePath('/auth/social')
	.use(
		'*',
		// middleware
		(c, next) =>
			useWorkersLogger(c.env.NAME, {
				environment: c.env.ENVIRONMENT,
				release: c.env.SENTRY_RELEASE,
			})(c, next)
	)

	.onError(withOnError())
	.notFound(withNotFound())

	.get('/', async (c) => {
		return c.html(`
			<!DOCTYPE html>
			<html>
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width, initial-scale=1">
					<title>Social Authentication</title>
					<style>
						* {
							margin: 0;
							padding: 0;
							box-sizing: border-box;
						}
						body {
							font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
							background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
							min-height: 100vh;
							display: flex;
							justify-content: center;
							align-items: center;
							padding: 2rem;
						}
						.container {
							background: white;
							padding: 3rem;
							border-radius: 1rem;
							box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
							max-width: 500px;
							width: 100%;
						}
						h1 {
							color: #333;
							margin-bottom: 0.5rem;
							font-size: 2rem;
							text-align: center;
						}
						.subtitle {
							color: #666;
							text-align: center;
							margin-bottom: 2rem;
							font-size: 1rem;
						}
						.info-box {
							background: #f7fafc;
							border: 1px solid #e2e8f0;
							border-radius: 0.5rem;
							padding: 1.5rem;
							margin-bottom: 2rem;
						}
						.info-box h2 {
							color: #2d3748;
							font-size: 1.1rem;
							margin-bottom: 0.75rem;
						}
						.info-box ul {
							color: #4a5568;
							padding-left: 1.5rem;
							line-height: 1.8;
						}
						.btn-google {
							display: flex;
							align-items: center;
							justify-content: center;
							gap: 0.75rem;
							width: 100%;
							padding: 1rem;
							background: white;
							color: #333;
							border: 2px solid #e2e8f0;
							border-radius: 0.5rem;
							font-size: 1rem;
							font-weight: 600;
							cursor: pointer;
							transition: all 0.2s;
							text-decoration: none;
						}
						.btn-google:hover {
							background: #f7fafc;
							border-color: #cbd5e0;
							transform: translateY(-2px);
							box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
						}
						.btn-dashboard {
							display: block;
							text-align: center;
							margin-top: 1rem;
							padding: 0.75rem;
							background: #667eea;
							color: white;
							border: none;
							border-radius: 0.5rem;
							font-size: 0.95rem;
							font-weight: 600;
							cursor: pointer;
							transition: all 0.2s;
							text-decoration: none;
						}
						.btn-dashboard:hover {
							background: #5568d3;
							transform: translateY(-2px);
							box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
						}
						.google-icon {
							width: 20px;
							height: 20px;
						}
					</style>
				</head>
				<body>
					<div class="container">
						<h1>Social Authentication</h1>
						<p class="subtitle">Link your social account to your legacy account</p>

						<div class="info-box">
							<h2>How it works</h2>
							<ul>
								<li>Sign in with your Google account</li>
								<li>Link it to your legacy system account</li>
								<li>Each social account can link to only one legacy account</li>
								<li>Account links are permanent and secure</li>
							</ul>
						</div>

						<a href="/auth/social/login/google" class="btn-google">
							<svg class="google-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
								<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
								<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
								<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
								<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
							</svg>
							Sign in with Google
						</a>

						<a href="/auth/social/dashboard" class="btn-dashboard">
							Go to Dashboard
						</a>
					</div>

					<script>
						// Check if we have a session and redirect to dashboard
						const sessionId = localStorage.getItem('sessionId');
						if (sessionId && window.location.search.indexOf('force_login') === -1) {
							// Verify session is still valid
							fetch('/auth/social/session/verify', {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ sessionId })
							})
							.then(res => res.json())
							.then(data => {
								if (data.success) {
									window.location.href = '/auth/social/dashboard';
								}
							})
							.catch(() => {
								// Invalid session, stay on login page
							});
						}
					</script>
				</body>
			</html>
		`)
	})

	// Dashboard page
	.get('/dashboard', async (c) => {
		return c.html(`
			<!DOCTYPE html>
			<html>
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width, initial-scale=1">
					<title>Dashboard - Social Authentication</title>
					<style>
						* {
							margin: 0;
							padding: 0;
							box-sizing: border-box;
						}
						body {
							font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
							background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
							min-height: 100vh;
							padding: 2rem;
						}
						.container {
							max-width: 800px;
							margin: 0 auto;
						}
						.card {
							background: white;
							padding: 2rem;
							border-radius: 1rem;
							box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
							margin-bottom: 1.5rem;
						}
						h1 {
							color: #333;
							margin-bottom: 0.5rem;
							font-size: 1.75rem;
						}
						h2 {
							color: #333;
							margin-bottom: 1rem;
							font-size: 1.25rem;
						}
						.subtitle {
							color: #666;
							margin-bottom: 1.5rem;
						}
						.info-row {
							display: flex;
							justify-content: space-between;
							padding: 0.75rem;
							border-bottom: 1px solid #e2e8f0;
						}
						.info-row:last-child {
							border-bottom: none;
						}
						.info-label {
							font-weight: 600;
							color: #4a5568;
						}
						.info-value {
							color: #2d3748;
							font-family: 'Monaco', 'Courier New', monospace;
							word-break: break-all;
						}
						.btn {
							display: inline-block;
							padding: 0.75rem 1.5rem;
							border-radius: 0.5rem;
							font-weight: 600;
							cursor: pointer;
							transition: all 0.2s;
							border: none;
							text-decoration: none;
							text-align: center;
						}
						.btn-primary {
							background: #667eea;
							color: white;
						}
						.btn-primary:hover {
							background: #5568d3;
							transform: translateY(-2px);
							box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
						}
						.btn-secondary {
							background: #e2e8f0;
							color: #4a5568;
						}
						.btn-secondary:hover {
							background: #cbd5e0;
							transform: translateY(-2px);
						}
						.btn-danger {
							background: #f56565;
							color: white;
						}
						.btn-danger:hover {
							background: #e53e3e;
							transform: translateY(-2px);
							box-shadow: 0 4px 12px rgba(245, 101, 101, 0.3);
						}
						.loading {
							text-align: center;
							padding: 3rem;
							color: #666;
						}
						.error {
							background: #fed7d7;
							color: #c53030;
							padding: 1rem;
							border-radius: 0.5rem;
							margin-bottom: 1rem;
						}
						.status-badge {
							display: inline-block;
							padding: 0.25rem 0.75rem;
							border-radius: 0.25rem;
							font-size: 0.875rem;
							font-weight: 600;
						}
						.status-linked {
							background: #c6f6d5;
							color: #22543d;
						}
						.status-not-linked {
							background: #feebc8;
							color: #7c2d12;
						}
						.button-group {
							display: flex;
							gap: 1rem;
							margin-top: 1.5rem;
						}
						.empty-state {
							text-align: center;
							padding: 2rem;
							color: #666;
						}
						.copy-btn {
							margin-left: 0.5rem;
							padding: 0.25rem 0.5rem;
							font-size: 0.75rem;
							background: #e2e8f0;
							border: none;
							border-radius: 0.25rem;
							cursor: pointer;
						}
						.copy-btn:hover {
							background: #cbd5e0;
						}
					</style>
				</head>
				<body>
					<div class="container">
						<div id="loading" class="card loading">
							<p>Loading your dashboard...</p>
						</div>

						<div id="error" class="card" style="display: none;">
							<div class="error"></div>
							<a href="/auth/social" class="btn btn-primary">Back to Home</a>
						</div>

						<div id="dashboard" style="display: none;">
							<div class="card">
								<h1>Welcome, <span id="userName"></span></h1>
								<p class="subtitle">Manage your social authentication and account links</p>

								<div class="button-group">
									<button onclick="toggleMasking()" class="btn btn-primary" id="maskToggleBtn">
										<span id="maskIcon">🔒</span> <span id="maskText">Show Real Data</span>
									</button>
									<button onclick="logout()" class="btn btn-danger">Logout</button>
									<a href="/auth/social" class="btn btn-secondary">Back to Home</a>
								</div>
							</div>

							<div class="card">
								<h2>Profile Information</h2>
								<div class="info-row">
									<span class="info-label">Provider</span>
									<span class="info-value" id="provider"></span>
								</div>
								<div class="info-row">
									<span class="info-label">Email</span>
									<span class="info-value" id="email"></span>
								</div>
								<div class="info-row">
									<span class="info-label">Name</span>
									<span class="info-value" id="name"></span>
								</div>
							</div>

							<div class="card">
								<h2>Session Information</h2>
								<div class="info-row">
									<span class="info-label">Session ID</span>
									<span class="info-value">
										<span id="sessionId"></span>
										<button onclick="copySessionId()" class="copy-btn">Copy</button>
									</span>
								</div>
								<div class="info-row">
									<span class="info-label">Expires</span>
									<span class="info-value" id="expiresAt"></span>
								</div>
							</div>

							<div class="card">
								<h2>Legacy Account Link</h2>
								<div id="linkStatus"></div>
							</div>
						</div>
					</div>

					<script>
						const sessionId = localStorage.getItem('sessionId');
						let maskingEnabled = localStorage.getItem('maskingEnabled') !== 'false'; // Default to true

						if (!sessionId) {
							window.location.href = '/auth/social';
						}

						// Masking utilities
						function maskEmail(email) {
							if (!maskingEnabled || !email) return email;
							const [user, domain] = email.split('@');
							if (!domain) return '***@***.***';
							const maskedUser = user.length <= 2 ? '***' : user[0] + '***' + user[user.length - 1];
							const [domainName, tld] = domain.split('.');
							const maskedDomain = domainName.length <= 2 ? '***' : domainName[0] + '***';
							return \`\${maskedUser}@\${maskedDomain}.\${tld || '***'}\`;
						}

						function maskName(name) {
							if (!maskingEnabled || !name) return name;
							const parts = name.split(' ');
							return parts.map(part => {
								if (part.length <= 2) return '***';
								return part[0] + '***';
							}).join(' ');
						}

						function maskId(id, showLength = 8) {
							if (!maskingEnabled || !id) return id;
							if (id.length <= showLength) return '***';
							return id.substring(0, showLength) + '...';
						}

						function maskUsername(username) {
							if (!maskingEnabled || !username) return username;
							if (username.length <= 3) return '***';
							return username.substring(0, 2) + '***' + username[username.length - 1];
						}

						function toggleMasking() {
							maskingEnabled = !maskingEnabled;
							localStorage.setItem('maskingEnabled', maskingEnabled);
							loadDashboard(); // Reload to apply changes
						}

						async function loadDashboard() {
							try {
								// Verify session
								const sessionRes = await fetch('/auth/social/session/verify', {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({ sessionId })
								});

								if (!sessionRes.ok) {
									throw new Error('Session expired or invalid');
								}

								const sessionData = await sessionRes.json();
								const session = sessionData.session;

								// Get account links
								const linksRes = await fetch('/auth/social/account/links', {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({ sessionId })
								});

								const linksData = await linksRes.json();
								const links = linksData.links || [];

								// Update UI with masking
								document.getElementById('userName').textContent = maskName(session.name);
								document.getElementById('provider').textContent = session.provider;
								document.getElementById('email').textContent = maskEmail(session.email);
								document.getElementById('name').textContent = maskName(session.name);
								document.getElementById('sessionId').textContent = maskId(sessionId, 16);
								document.getElementById('expiresAt').textContent = new Date(session.expiresAt).toLocaleString();

								// Display link status
								const linkStatusDiv = document.getElementById('linkStatus');
								if (links.length > 0) {
									const link = links[0];
									linkStatusDiv.innerHTML = \`
										<div class="info-row">
											<span class="info-label">Status</span>
											<span class="status-badge status-linked">Linked</span>
										</div>
										<div class="info-row">
											<span class="info-label">Legacy System</span>
											<span class="info-value">\${link.legacySystem}</span>
										</div>
										<div class="info-row">
											<span class="info-label">Legacy User ID</span>
											<span class="info-value">\${maskId(link.legacyUserId, 6)}</span>
										</div>
										<div class="info-row">
											<span class="info-label">Username</span>
											<span class="info-value">\${maskUsername(link.legacyUsername)}</span>
										</div>
										<div class="info-row">
											<span class="info-label">Linked At</span>
											<span class="info-value">\${new Date(link.linkedAt).toLocaleString()}</span>
										</div>
										<p style="margin-top: 1rem; color: #666; font-size: 0.9rem;">
											Account links are permanent and cannot be changed by users.
										</p>
									\`;
								} else {
									linkStatusDiv.innerHTML = \`
										<div class="empty-state">
											<span class="status-badge status-not-linked">Not Linked</span>
											<p style="margin-top: 1rem;">You haven't linked a legacy account yet.</p>
											<button onclick="claimAccount()" class="btn btn-primary" style="margin-top: 1rem;">
												Link Legacy Account
											</button>
										</div>
									\`;
								}

								// Update masking toggle button
								const maskIcon = document.getElementById('maskIcon');
								const maskText = document.getElementById('maskText');
								if (maskingEnabled) {
									maskIcon.textContent = '🔒';
									maskText.textContent = 'Show Real Data';
								} else {
									maskIcon.textContent = '👁️';
									maskText.textContent = 'Hide Sensitive Data';
								}

								// Show dashboard
								document.getElementById('loading').style.display = 'none';
								document.getElementById('dashboard').style.display = 'block';

							} catch (error) {
								console.error('Error loading dashboard:', error);
								document.getElementById('loading').style.display = 'none';
								const errorDiv = document.getElementById('error');
								errorDiv.style.display = 'block';
								errorDiv.querySelector('.error').textContent = error.message || 'Failed to load dashboard';
								localStorage.removeItem('sessionId');
							}
						}

						async function claimAccount() {
							try {
								const res = await fetch('/auth/social/claim/initiate', {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({ sessionId })
								});

								const data = await res.json();
								if (data.success) {
									window.location.href = data.authUrl;
								} else {
									alert('Failed to initiate account claim: ' + (data.error || 'Unknown error'));
								}
							} catch (error) {
								alert('Error: ' + error.message);
							}
						}

						function copySessionId() {
							navigator.clipboard.writeText(sessionId);
							const btn = event.target;
							btn.textContent = 'Copied!';
							setTimeout(() => {
								btn.textContent = 'Copy';
							}, 2000);
						}

						function logout() {
							if (confirm('Are you sure you want to logout?')) {
								fetch('/auth/social/session', {
									method: 'DELETE',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({ sessionId })
								})
								.then(() => {
									localStorage.removeItem('sessionId');
									window.location.href = '/auth/social';
								})
								.catch(error => {
									console.error('Logout error:', error);
									localStorage.removeItem('sessionId');
									window.location.href = '/auth/social';
								});
							}
						}

						loadDashboard();
					</script>
				</body>
			</html>
		`)
	})

	// Google OAuth login endpoint
	.get('/login/google', (c) => {
		const state = crypto.randomUUID()
		const scopes = GOOGLE_OAUTH_SCOPES.join(' ')

		const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
		authUrl.searchParams.set('client_id', c.env.GOOGLE_CLIENT_ID)
		authUrl.searchParams.set('redirect_uri', c.env.GOOGLE_CALLBACK_URL)
		authUrl.searchParams.set('response_type', 'code')
		authUrl.searchParams.set('scope', scopes)
		authUrl.searchParams.set('state', state)
		authUrl.searchParams.set('access_type', 'offline')
		authUrl.searchParams.set('prompt', 'consent')

		logger
			.withTags({
				type: 'oauth_login_redirect',
				provider: 'google',
			})
			.info('Redirecting to Google OAuth', {
				scopes,
				state,
				request: getRequestLogData(c, Date.now()),
			})

		return c.redirect(authUrl.toString())
	})

	// Google OAuth callback endpoint
	.get('/callback/google', async (c) => {
		const code = c.req.query('code')
		const state = c.req.query('state')
		const error = c.req.query('error')

		if (error) {
			logger
				.withTags({
					type: 'oauth_callback_error',
					provider: 'google',
				})
				.error('OAuth callback error', {
					error,
					request: getRequestLogData(c, Date.now()),
				})
			return c.json({ error: `OAuth error: ${error}` }, 400)
		}

		if (!code) {
			return c.json({ error: 'Missing authorization code' }, 400)
		}

		logger
			.withTags({
				type: 'oauth_callback',
				provider: 'google',
			})
			.info('OAuth callback received', {
				state,
				request: getRequestLogData(c, Date.now()),
			})

		try {
			// Exchange code for tokens
			const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams({
					code,
					client_id: c.env.GOOGLE_CLIENT_ID,
					client_secret: c.env.GOOGLE_CLIENT_SECRET,
					redirect_uri: c.env.GOOGLE_CALLBACK_URL,
					grant_type: 'authorization_code',
				}),
			})

			if (!tokenResponse.ok) {
				const error = await tokenResponse.text()
				logger
					.withTags({
						type: 'oauth_token_error',
						provider: 'google',
					})
					.error('Failed to exchange code for token', {
						status: tokenResponse.status,
						error,
						request: getRequestLogData(c, Date.now()),
					})
				return c.json({ error: 'Failed to exchange code for token' }, 502)
			}

			const tokenData = (await tokenResponse.json()) as {
				access_token: string
				refresh_token: string
				expires_in: number
				id_token: string
			}

			// Get user info from Google
			const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
				headers: {
					Authorization: `Bearer ${tokenData.access_token}`,
				},
			})

			if (!userInfoResponse.ok) {
				const error = await userInfoResponse.text()
				logger
					.withTags({
						type: 'oauth_userinfo_error',
						provider: 'google',
					})
					.error('Failed to get user info', {
						status: userInfoResponse.status,
						error,
						request: getRequestLogData(c, Date.now()),
					})
				return c.json({ error: 'Failed to get user info' }, 502)
			}

			const userInfo = (await userInfoResponse.json()) as {
				id: string
				email: string
				name: string
				picture?: string
			}

			// Store session in Durable Object (using global instance)
			const id = c.env.USER_SESSION_STORE.idFromName('global')
			const stub = c.env.USER_SESSION_STORE.get(id)

			const sessionInfo = await stub.createSession(
				'google',
				userInfo.id,
				userInfo.email,
				userInfo.name,
				tokenData.access_token,
				tokenData.refresh_token,
				tokenData.expires_in
			)

			logger
				.withTags({
					type: 'oauth_success',
					provider: 'google',
				})
				.info('OAuth flow completed', {
					email: userInfo.email,
					name: userInfo.name,
					sessionId: sessionInfo.sessionId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.html(`
				<!DOCTYPE html>
				<html>
					<head>
						<meta charset="utf-8">
						<meta name="viewport" content="width=device-width, initial-scale=1">
						<title>Authentication Successful</title>
						<style>
							body {
								font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
								display: flex;
								justify-content: center;
								align-items: center;
								min-height: 100vh;
								margin: 0;
								background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
							}
							.container {
								background: white;
								padding: 3rem;
								border-radius: 1rem;
								box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
								text-align: center;
								max-width: 600px;
							}
							h1 {
								color: #333;
								margin: 0 0 1rem 0;
								font-size: 2rem;
							}
							p {
								color: #666;
								margin: 0.5rem 0;
								font-size: 1.1rem;
							}
							.user-name {
								color: #667eea;
								font-weight: bold;
							}
							.success-icon {
								font-size: 4rem;
								margin-bottom: 1rem;
							}
						</style>
					</head>
					<body>
						<div class="container">
							<div class="success-icon">✓</div>
							<h1>Authentication Successful</h1>
							<p>Welcome, <span class="user-name" id="userName"></span>!</p>
							<p>Redirecting to your dashboard...</p>
						</div>
						<script>
							// Mask name by default
							function maskName(name) {
								const parts = name.split(' ');
								return parts.map(part => {
									if (part.length <= 2) return '***';
									return part[0] + '***';
								}).join(' ');
							}

							const userName = '${userInfo.name}';
							const maskingEnabled = localStorage.getItem('maskingEnabled') !== 'false';
							document.getElementById('userName').textContent = maskingEnabled ? maskName(userName) : userName;

							localStorage.setItem('sessionId', '${sessionInfo.sessionId}');
							setTimeout(() => {
								window.location.href = '/auth/social/dashboard';
							}, 1500);
						</script>
					</body>
				</html>
			`)
		} catch (error) {
			logger
				.withTags({
					type: 'oauth_exception',
					provider: 'google',
				})
				.error('OAuth exception', {
					error: String(error),
					request: getRequestLogData(c, Date.now()),
				})
			return c.json({ error: String(error) }, 500)
		}
	})

	// Verify session and get user info
	.post('/session/verify', async (c) => {
		const body = await c.req.json<{ sessionId: string }>()
		const { sessionId } = body

		if (!sessionId) {
			return c.json({ error: 'Missing sessionId' }, 400)
		}

		try {
			const id = c.env.USER_SESSION_STORE.idFromName('global')
			const stub = c.env.USER_SESSION_STORE.get(id)

			const sessionInfo = await stub.getSession(sessionId)

			return c.json({
				success: true,
				session: {
					provider: sessionInfo.provider,
					email: sessionInfo.email,
					name: sessionInfo.name,
					expiresAt: sessionInfo.expiresAt,
				},
			})
		} catch (error) {
			logger.error('Session verify error', { error: String(error) })
			return c.json({ error: String(error) }, error instanceof Error && error.message === 'Session not found' ? 404 : 500)
		}
	})

	// Refresh session token
	.post('/session/refresh', async (c) => {
		const body = await c.req.json<{ sessionId: string }>()
		const { sessionId } = body

		if (!sessionId) {
			return c.json({ error: 'Missing sessionId' }, 400)
		}

		try {
			const id = c.env.USER_SESSION_STORE.idFromName('global')
			const stub = c.env.USER_SESSION_STORE.get(id)

			const sessionInfo = await stub.refreshSession(sessionId)

			return c.json({
				success: true,
				session: {
					provider: sessionInfo.provider,
					email: sessionInfo.email,
					name: sessionInfo.name,
					accessToken: sessionInfo.accessToken,
					expiresAt: sessionInfo.expiresAt,
				},
			})
		} catch (error) {
			logger.error('Session refresh error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	// Delete session (logout)
	.delete('/session', async (c) => {
		const body = await c.req.json<{ sessionId: string }>()
		const { sessionId } = body

		if (!sessionId) {
			return c.json({ error: 'Missing sessionId' }, 400)
		}

		try {
			const id = c.env.USER_SESSION_STORE.idFromName('global')
			const stub = c.env.USER_SESSION_STORE.get(id)

			await stub.deleteSession(sessionId)

			return c.json({ success: true })
		} catch (error) {
			logger.error('Session delete error', { error: String(error) })
			return c.json({ error: String(error) }, error instanceof Error && error.message === 'Session not found' ? 404 : 500)
		}
	})

	// ========== Account Claiming Endpoints ==========

	// Initiate account claim flow
	.post('/claim/initiate', async (c) => {
		const body = await c.req.json<{ sessionId: string }>()
		const { sessionId } = body

		if (!sessionId) {
			return c.json({ error: 'Missing sessionId' }, 400)
		}

		try {
			// Verify environment variables are set
			if (
				!c.env.TEST_AUTH_OIDC_ISSUER ||
				!c.env.TEST_AUTH_CLIENT_ID ||
				!c.env.TEST_AUTH_CLIENT_SECRET ||
				!c.env.TEST_AUTH_CALLBACK_URL
			) {
				logger.error('Missing OIDC configuration', {
					hasIssuer: !!c.env.TEST_AUTH_OIDC_ISSUER,
					hasClientId: !!c.env.TEST_AUTH_CLIENT_ID,
					hasClientSecret: !!c.env.TEST_AUTH_CLIENT_SECRET,
					hasCallbackUrl: !!c.env.TEST_AUTH_CALLBACK_URL,
				})
				return c.json({ error: 'OIDC configuration not set. Please contact administrator.' }, 500)
			}

			// Verify session exists
			const id = c.env.USER_SESSION_STORE.idFromName('global')
			const stub = c.env.USER_SESSION_STORE.get(id)

			await stub.getSession(sessionId)

			// Create OIDC state linked to this session
			const state = await stub.createOIDCState(sessionId)

			// Create OIDC client
			const oidcClient = new OIDCClient(
				c.env.TEST_AUTH_OIDC_ISSUER,
				c.env.TEST_AUTH_CLIENT_ID,
				c.env.TEST_AUTH_CLIENT_SECRET,
				c.env.TEST_AUTH_CALLBACK_URL
			)

			// Generate authorization URL
			const authUrl = await oidcClient.generateAuthorizationUrl(state)

			logger
				.withTags({
					type: 'claim_initiate',
				})
				.info('Initiating account claim flow', {
					sessionId: sessionId.substring(0, 8) + '...',
					state: state.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
				authUrl,
			})
		} catch (error) {
			logger.error('Claim initiate error', { error: String(error) })
			return c.json({ error: String(error) }, error instanceof Error && error.message === 'Session not found' ? 404 : 500)
		}
	})

	// Handle account claim callback
	.get('/claim/callback', async (c) => {
		const code = c.req.query('code')
		const state = c.req.query('state')
		const error = c.req.query('error')

		if (error) {
			logger
				.withTags({
					type: 'claim_callback_error',
				})
				.error('OIDC callback error', {
					error,
					request: getRequestLogData(c, Date.now()),
				})
			return c.json({ error: `OIDC error: ${error}` }, 400)
		}

		if (!code || !state) {
			return c.json({ error: 'Missing code or state' }, 400)
		}

		try {
			// Verify environment variables are set
			if (
				!c.env.TEST_AUTH_OIDC_ISSUER ||
				!c.env.TEST_AUTH_CLIENT_ID ||
				!c.env.TEST_AUTH_CLIENT_SECRET ||
				!c.env.TEST_AUTH_CALLBACK_URL
			) {
				logger.error('Missing OIDC configuration in callback', {
					hasIssuer: !!c.env.TEST_AUTH_OIDC_ISSUER,
					hasClientId: !!c.env.TEST_AUTH_CLIENT_ID,
					hasClientSecret: !!c.env.TEST_AUTH_CLIENT_SECRET,
					hasCallbackUrl: !!c.env.TEST_AUTH_CALLBACK_URL,
				})
				return c.json({ error: 'OIDC configuration not set. Please contact administrator.' }, 500)
			}

			const id = c.env.USER_SESSION_STORE.idFromName('global')
			const stub = c.env.USER_SESSION_STORE.get(id)

			// Validate state and get session ID
			const sessionId = await stub.validateOIDCState(state)

			// Get session info to link the account
			const session = await stub.getSession(sessionId)

			// Create OIDC client
			const oidcClient = new OIDCClient(
				c.env.TEST_AUTH_OIDC_ISSUER,
				c.env.TEST_AUTH_CLIENT_ID,
				c.env.TEST_AUTH_CLIENT_SECRET,
				c.env.TEST_AUTH_CALLBACK_URL
			)

			// Exchange code for tokens
			const tokens = await oidcClient.exchangeCodeForTokens(code)

			// Get user info from test auth
			const userInfo = await oidcClient.getUserInfo(tokens.access_token)

			// Extract legacy account claims
			const legacyUsername = userInfo.auth_username || userInfo.preferred_username || userInfo.email || userInfo.sub
			const superuser = userInfo.superuser ?? false
			const staff = userInfo.staff ?? false
			const active = userInfo.active ?? false
			const primaryCharacter = userInfo.primary_character || ''
			const primaryCharacterId = String(userInfo.primary_character_id || '')
			const groups = userInfo.groups || []

			// Create account link
			const link = await stub.createAccountLink(
				session.socialUserId,
				'test-auth',
				userInfo.sub,
				legacyUsername,
				superuser,
				staff,
				active,
				primaryCharacter,
				primaryCharacterId,
				groups
			)

			logger
				.withTags({
					type: 'claim_success',
				})
				.info('Account claim completed', {
					linkId: link.linkId,
					socialUserId: link.socialUserId.substring(0, 8) + '...',
					legacySystem: link.legacySystem,
					legacyUserId: link.legacyUserId,
					request: getRequestLogData(c, Date.now()),
				})

			return c.html(`
				<!DOCTYPE html>
				<html>
					<head>
						<meta charset="utf-8">
						<meta name="viewport" content="width=device-width, initial-scale=1">
						<title>Account Claimed Successfully</title>
						<style>
							body {
								font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
								display: flex;
								justify-content: center;
								align-items: center;
								min-height: 100vh;
								margin: 0;
								background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
							}
							.container {
								background: white;
								padding: 3rem;
								border-radius: 1rem;
								box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
								text-align: center;
								max-width: 600px;
							}
							h1 {
								color: #333;
								margin: 0 0 1rem 0;
								font-size: 2rem;
							}
							p {
								color: #666;
								margin: 0.5rem 0;
								font-size: 1.1rem;
							}
							.legacy-username {
								color: #667eea;
								font-weight: bold;
							}
							.success-icon {
								font-size: 4rem;
								margin-bottom: 1rem;
							}
						</style>
					</head>
					<body>
						<div class="container">
							<div class="success-icon">✓</div>
							<h1>Account Linked Successfully</h1>
							<p>Your legacy account <span class="legacy-username" id="legacyUsername"></span> has been linked!</p>
							<p>Redirecting to your dashboard...</p>
						</div>
						<script>
							// Mask username by default
							function maskUsername(username) {
								if (username.length <= 3) return '***';
								return username.substring(0, 2) + '***' + username[username.length - 1];
							}

							const username = '${link.legacyUsername}';
							const maskingEnabled = localStorage.getItem('maskingEnabled') !== 'false';
							document.getElementById('legacyUsername').textContent = maskingEnabled ? maskUsername(username) : username;

							setTimeout(() => {
								window.location.href = '/auth/social/dashboard';
							}, 1500);
						</script>
					</body>
				</html>
			`)
		} catch (error) {
			logger
				.withTags({
					type: 'claim_exception',
				})
				.error('Claim callback exception', {
					error: String(error),
					request: getRequestLogData(c, Date.now()),
				})
			return c.json({ error: String(error) }, 500)
		}
	})

	// Get account links for current session
	.post('/account/links', async (c) => {
		const body = await c.req.json<{ sessionId: string }>()
		const { sessionId } = body

		if (!sessionId) {
			return c.json({ error: 'Missing sessionId' }, 400)
		}

		try {
			const id = c.env.USER_SESSION_STORE.idFromName('global')
			const stub = c.env.USER_SESSION_STORE.get(id)

			// Get session info
			const session = await stub.getSession(sessionId)

			// Get all account links for this social user
			const links = await stub.getAccountLinksBySocialUser(session.socialUserId)

			return c.json({
				success: true,
				links: links.map((link) => ({
					linkId: link.linkId,
					legacySystem: link.legacySystem,
					legacyUserId: link.legacyUserId,
					legacyUsername: link.legacyUsername,
					superuser: link.superuser,
					staff: link.staff,
					active: link.active,
					primaryCharacter: link.primaryCharacter,
					primaryCharacterId: link.primaryCharacterId,
					groups: link.groups,
					linkedAt: link.linkedAt,
					updatedAt: link.updatedAt,
				})),
			})
		} catch (error) {
			logger.error('Get account links error', { error: String(error) })
			return c.json({ error: String(error) }, error instanceof Error && error.message === 'Session not found' ? 404 : 500)
		}
	})

	// Admin endpoint to revoke account link
	.delete('/admin/account/links/:linkId', async (c) => {
		const linkId = c.req.param('linkId')

		try {
			const id = c.env.USER_SESSION_STORE.idFromName('global')
			const stub = c.env.USER_SESSION_STORE.get(id)

			// Delete the account link
			await stub.deleteAccountLink(linkId)

			logger
				.withTags({
					type: 'account_link_revoked',
				})
				.info('Account link revoked by admin', {
					linkId,
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({ success: true })
		} catch (error) {
			logger.error('Delete account link error', { error: String(error) })
			return c.json(
				{ error: String(error) },
				error instanceof Error && error.message === 'Account link not found' ? 404 : 500
			)
		}
	})

	// Admin endpoint to list all sessions
	.get('/admin/sessions', async (c) => {
		const limit = Number(c.req.query('limit')) || 50
		const offset = Number(c.req.query('offset')) || 0

		try {
			const id = c.env.USER_SESSION_STORE.idFromName('global')
			const stub = c.env.USER_SESSION_STORE.get(id)

			const result = await stub.listSessions(limit, offset)

			return c.json({
				success: true,
				total: result.total,
				limit: result.limit,
				offset: result.offset,
				sessions: result.results,
			})
		} catch (error) {
			logger.error('List sessions error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	// Admin endpoint to get stats
	.get('/admin/stats', async (c) => {
		try {
			const id = c.env.USER_SESSION_STORE.idFromName('global')
			const stub = c.env.USER_SESSION_STORE.get(id)

			const stats = await stub.getStats()

			return c.json({
				success: true,
				stats,
			})
		} catch (error) {
			logger.error('Get stats error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

export default app

// Export Durable Object
export { SessionStore } from './session-store'
