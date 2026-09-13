import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { html } from 'hono/html'

import {
	LOGIN_LOCALE_COOKIE,
	LOGIN_LOCALE_NAMES,
	LOGIN_MESSAGES,
	parseLoginLocale,
	resolveLoginLocale,
} from './login-i18n'

import type { UserLocale } from '@repo/core'
import type { App } from '../context'

const login = new Hono<App>()
const LOGIN_LOCALE_COOKIE_TTL_SECONDS = 365 * 24 * 60 * 60

function selectedAttribute(locale: UserLocale, option: UserLocale) {
	return locale === option ? 'selected' : ''
}

/**
 * GET /login
 *
 * Landing page explaining EVE SSO login process
 * Supports optional redirect parameter for post-login navigation
 */
login.get('/', async (c) => {
	const user = c.get('user')
	const redirectUrl = c.req.query('redirect')
	const forceReauth = c.req.query('reauth') === '1' || c.req.query('reauth') === 'true'
	const requestedLocale = parseLoginLocale(c.req.query('locale'))
	const locale = resolveLoginLocale({
		queryLocale: requestedLocale,
		cookieLocale: getCookie(c, LOGIN_LOCALE_COOKIE),
		acceptLanguage: c.req.header('Accept-Language'),
	})
	const messages = LOGIN_MESSAGES[locale]

	// The locale is not sensitive. Keeping this cookie readable allows the SPA activation
	// slice to adopt the pre-authentication choice once the full catalog is ready.
	if (requestedLocale) {
		setCookie(c, LOGIN_LOCALE_COOKIE, requestedLocale, {
			httpOnly: false,
			path: '/',
			maxAge: LOGIN_LOCALE_COOKIE_TTL_SECONDS,
			sameSite: 'Lax',
			secure: new URL(c.req.url).protocol === 'https:',
		})
	}

	c.header('Cache-Control', 'private, no-store')
	c.header('Vary', 'Cookie, Accept-Language')

	// Build the auth URL with redirect parameter
	const authUrl = redirectUrl
		? `/api/auth/login?redirect=${encodeURIComponent(redirectUrl)}`
		: '/api/auth/login'

	// If already logged in, redirect to dashboard or specified redirect unless a fresh
	// login was explicitly requested for OAuth consent reauthentication.
	if (user && !forceReauth) {
		return c.redirect(redirectUrl || '/dashboard')
	}

	if (user && forceReauth) {
		return c.redirect(authUrl)
	}

	return c.html(html`
		<!DOCTYPE html>
		<html lang="${locale}">
			<head>
				<meta charset="UTF-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<title>${messages.title}</title>

				<!-- Open Graph Meta Tags -->
				<meta property="og:type" content="website" />
				<meta property="og:title" content="${messages.metaTitle}" />
				<meta property="og:description" content="${messages.description}" />
				<meta property="og:site_name" content="TEST Auth" />
				<meta
					property="og:image"
					content="https://images.evetech.net/corporations/1000274/logo?size=512"
				/>
				<meta property="og:image:width" content="512" />
				<meta property="og:image:height" content="512" />

				<!-- Standard Meta Tags -->
				<meta name="description" content="${messages.description}" />

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

					.locale-form {
						display: flex;
						align-items: flex-end;
						justify-content: flex-end;
						gap: 8px;
						margin-bottom: 24px;
						text-align: left;
					}

					.locale-field {
						display: flex;
						flex-direction: column;
						gap: 6px;
					}

					.locale-label {
						font-size: 12px;
						font-weight: 600;
						color: hsl(210 10% 70%);
					}

					.locale-control {
						position: relative;
					}

					.locale-select,
					.locale-apply {
						height: 40px;
						border: 1px solid hsl(220 12% 28%);
						border-radius: 6px;
						background: hsl(220 14% 18%);
						color: hsl(210 12% 95%);
						font: inherit;
						box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
						transition:
							border-color 0.15s,
							box-shadow 0.15s;
					}

					.locale-select {
						min-width: 150px;
						appearance: none;
						padding: 0 36px 0 12px;
						font-size: 14px;
						color-scheme: dark;
						cursor: pointer;
					}

					.locale-chevron {
						position: absolute;
						top: 50%;
						right: 12px;
						width: 16px;
						height: 16px;
						transform: translateY(-50%);
						pointer-events: none;
						color: hsl(210 10% 70%);
					}

					.locale-apply {
						padding: 0 12px;
						font-size: 13px;
						font-weight: 600;
						cursor: pointer;
					}

					.locale-select:focus-visible,
					.locale-apply:focus-visible {
						outline: 2px solid hsl(205 85% 58%);
						outline-offset: 2px;
					}

					.locale-select:hover {
						border-color: hsl(220 12% 38%);
					}

					.locale-apply:hover {
						background: hsl(220 14% 22%);
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

					.account-warning-box {
						background: hsl(0 72% 51% / 0.12);
						border-left: 3px solid hsl(0 72% 51%);
						padding: 16px;
						border-radius: 8px;
						margin-bottom: 16px;
					}

					.account-warning-title {
						font-size: 14px;
						font-weight: 600;
						color: hsl(0 84% 68%);
						margin-bottom: 8px;
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

					@media (max-width: 480px) {
						.header,
						.content {
							padding: 24px;
						}

						.locale-form {
							justify-content: center;
						}
					}
				</style>
			</head>
			<body>
				<div class="container">
					<div class="header">
						<form class="locale-form" method="get" action="/login">
							<div class="locale-field">
								<label class="locale-label" for="login-locale">${messages.languageLabel}</label>
								<div class="locale-control">
									<select class="locale-select" id="login-locale" name="locale">
										<option value="en" ${selectedAttribute(locale, 'en')}>
											${LOGIN_LOCALE_NAMES.en}
										</option>
										<option value="de" ${selectedAttribute(locale, 'de')}>
											${LOGIN_LOCALE_NAMES.de}
										</option>
										<option value="ko" ${selectedAttribute(locale, 'ko')}>
											${LOGIN_LOCALE_NAMES.ko}
										</option>
									</select>
									<svg class="locale-chevron" viewBox="0 0 24 24" fill="none" aria-hidden="true">
										<path
											d="m7 15 5 5 5-5M7 9l5-5 5 5"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
								</div>
							</div>
							${redirectUrl
								? html`<input type="hidden" name="redirect" value="${redirectUrl}" />`
								: ''}
							${forceReauth ? html`<input type="hidden" name="reauth" value="1" />` : ''}
							<noscript>
								<button class="locale-apply" type="submit">${messages.applyLanguage}</button>
							</noscript>
						</form>
						<h1>${messages.welcome}</h1>
						<p>${messages.subtitle}</p>
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
							<p class="info-text">${messages.intro}</p>
						</div>

						<div class="account-warning-box">
							<div class="account-warning-title">${messages.accountWarningTitle}</div>
							<p class="warning-text">${messages.accountWarningText}</p>
						</div>

						<div class="warning-box">
							<div class="warning-title">${messages.characterWarningTitle}</div>
							<p class="warning-text">
								${messages.characterWarningBefore}<strong>${messages.mainCharacter}</strong>${messages.characterWarningAfter}
							</p>
						</div>

						<div class="info-section">
							<div class="info-title">${messages.nextTitle}</div>
							<ul class="info-list">
								${messages.nextSteps.map((step) => html`<li>${step}</li>`)}
							</ul>
						</div>

						<div class="info-section">
							<div class="info-title">${messages.securityTitle}</div>
							<p class="info-text">${messages.securityText}</p>
						</div>

						<a href="${authUrl}" class="button button-primary">${messages.continueButton}</a>

						<a href="/" class="button button-secondary">${messages.cancelButton}</a>
					</div>

					<div class="footer">${messages.footer}</div>
				</div>
				<script>
					{
						const loginLocaleSelect = document.getElementById('login-locale')

						if (loginLocaleSelect instanceof HTMLSelectElement && loginLocaleSelect.form) {
							const localeForm = loginLocaleSelect.form
							loginLocaleSelect.addEventListener('change', () => {
								localeForm.requestSubmit()
							})
						}
					}
				</script>
			</body>
		</html>
	`)
})

export default login
