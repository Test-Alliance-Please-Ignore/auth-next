import { Hono } from 'hono'
import { html } from 'hono/html'

import type { App } from '../context'

const login = new Hono<App>()

/**
 * GET /login
 *
 * Landing page explaining EVE SSO login process
 * Supports optional redirect parameter for post-login navigation
 */
login.get('/', async (c) => {
	const user = c.get('user')
	const redirectUrl = c.req.query('redirect')

	// If already logged in, redirect to dashboard or specified redirect
	if (user) {
		return c.redirect(redirectUrl || '/dashboard')
	}

	// Build the auth URL with redirect parameter
	const authUrl = redirectUrl
		? `/api/auth/login?redirect=${encodeURIComponent(redirectUrl)}`
		: '/api/auth/login'

	return c.html(html`
		<!DOCTYPE html>
		<html lang="en">
			<head>
				<meta charset="UTF-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<title>Login - TEST Auth</title>

				<!-- Open Graph Meta Tags -->
				<meta property="og:type" content="website" />
				<meta property="og:title" content="Login to TEST Auth" />
				<meta
					property="og:description"
					content="Secure authentication for EVE Online alliances and corporations"
				/>
				<meta property="og:site_name" content="TEST Auth" />
				<meta
					property="og:image"
					content="https://images.evetech.net/corporations/1000274/logo?size=512"
				/>
				<meta property="og:image:width" content="512" />
				<meta property="og:image:height" content="512" />

				<!-- Standard Meta Tags -->
				<meta
					name="description"
					content="Secure authentication for EVE Online alliances and corporations"
				/>

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

					.info-section {
						margin-bottom: 24px;
					}

					.info-title {
						font-size: 18px;
						font-weight: 600;
						margin-bottom: 12px;
						color: hsl(205 85% 58%);
					}

					.info-text {
						color: hsl(210 10% 70%);
						line-height: 1.6;
						margin-bottom: 12px;
					}

					.info-list {
						list-style: none;
						padding-left: 0;
					}

					.info-list li {
						color: hsl(210 10% 70%);
						line-height: 1.8;
						padding-left: 24px;
						position: relative;
					}

					.info-list li::before {
						content: '→';
						position: absolute;
						left: 0;
						color: hsl(205 85% 58%);
						font-weight: bold;
					}

					.warning-box {
						background: hsl(45 100% 50% / 0.1);
						border-left: 3px solid hsl(45 100% 50%);
						padding: 16px;
						border-radius: 8px;
						margin-bottom: 24px;
					}

					.warning-title {
						font-size: 14px;
						font-weight: 600;
						color: hsl(45 100% 60%);
						margin-bottom: 8px;
					}

					.warning-text {
						font-size: 14px;
						color: hsl(210 10% 70%);
						line-height: 1.6;
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

					.button-primary:hover {
						transform: translateY(-2px);
						box-shadow: 0 8px 20px hsl(205 85% 58% / 0.4);
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

					.eve-logo {
						display: flex;
						align-items: center;
						justify-content: center;
						gap: 12px;
						margin-bottom: 24px;
						padding: 16px;
						background: hsl(220 18% 10%);
						border: 1px solid hsl(220 12% 22%);
						border-radius: 8px;
					}

					.eve-logo-text {
						font-size: 24px;
						font-weight: 700;
						color: hsl(210 12% 95%);
					}

					.footer {
						padding: 16px 32px;
						background: hsl(220 18% 10%);
						border-top: 1px solid hsl(220 12% 22%);
						text-align: center;
						font-size: 12px;
						color: hsl(210 10% 70%);
					}
				</style>
			</head>
			<body>
				<div class="container">
					<div class="header">
						<h1>Welcome to TEST Auth</h1>
						<p>Secure Authentication for EVE Online</p>
					</div>

					<div class="content">
						<div class="eve-logo">
							<svg width="32" height="32" viewBox="0 0 24 24" fill="none">
								<circle cx="12" cy="12" r="10" stroke="hsl(205 85% 58%)" stroke-width="2" />
								<path
									d="M12 6v6l4 4"
									stroke="hsl(205 85% 58%)"
									stroke-width="2"
									stroke-linecap="round"
								/>
							</svg>
							<span class="eve-logo-text">EVE Online SSO</span>
						</div>

						<div class="info-section">
							<p class="info-text">
								You are about to login using EVE Online's secure Single Sign-On (SSO) system. This
								ensures your credentials stay safe and are never shared with third parties.
							</p>
						</div>

						<div class="warning-box">
							<div class="warning-title">Important: Select Your Main Character</div>
							<p class="warning-text">
								When you reach the EVE SSO page, please select your <strong>main character</strong>.
								This character will be associated with your account and cannot be easily changed
								later.
							</p>
						</div>

						<div class="info-section">
							<div class="info-title">What happens next?</div>
							<ul class="info-list">
								<li>You'll be redirected to EVE Online's official login page</li>
								<li>Log in with your EVE Online account credentials</li>
								<li>Select your main character from your character list</li>
								<li>Authorize TEST Auth to access your character information</li>
								<li>You'll be automatically redirected back to continue</li>
							</ul>
						</div>

						<div class="info-section">
							<div class="info-title">Your data is secure</div>
							<p class="info-text">
								We only request the necessary permissions to verify your identity and manage your
								group memberships. Your EVE Online password is never shared with us.
							</p>
						</div>

						<a href="${authUrl}" class="button button-primary"> Continue to EVE Online Login </a>

						<a href="/" class="button button-secondary"> Cancel </a>
					</div>

					<div class="footer">
						Powered by EVE Online SSO • Your credentials remain secure with CCP Games
					</div>
				</div>
			</body>
		</html>
	`)
})

export default login
