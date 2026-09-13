import { defineCatalog } from '../catalog'

export const charactersCorporationsCatalog = defineCatalog(
	{
		discordCard: {
			connected: 'Connected account',
			linkDescription: 'Link your Discord account',
			userId: 'Discord ID: {{id}}',
			authorizationRevoked: 'Authorization Revoked',
			revokedDescription:
				"You've removed this app from your Discord authorized apps. Please re-link your account to restore access.",
			redirecting: 'Redirecting to Discord…',
			relink: 'Re-link Discord Account',
			refreshing: 'Refreshing…',
			refreshAccess: 'Refresh Discord Access',
			connectDescription:
				'Connect your Discord account to enable notifications and community features.',
			link: 'Link Discord Account',
			linkFailed: 'Linking Failed',
			linkError: 'An error occurred',
			refreshStartError: 'We could not start the Discord access refresh. Please try again later.',
			refreshStatusError: 'Discord access status could not be confirmed',
			refreshed: 'Discord access refreshed successfully.',
			joined_one: 'Successfully joined {{formattedCount}} Discord server!',
			joined_other: 'Successfully joined {{formattedCount}} Discord servers!',
			refreshErrors: {
				authorization: 'Discord authorization may need renewal',
				configuration: 'Discord server configuration issue',
				temporary: 'Discord temporarily unavailable',
				unknown: 'Discord access update incomplete',
			},
			partialRefreshErrors: {
				authorization_one: 'Access to {{formattedCount}} server needs Discord authorization.',
				authorization_other: 'Access to {{formattedCount}} servers needs Discord authorization.',
				configuration_one: 'Access to {{formattedCount}} server has a server configuration issue.',
				configuration_other:
					'Access to {{formattedCount}} servers has a server configuration issue.',
				temporary_one:
					'Access to {{formattedCount}} server is affected by a temporary Discord issue.',
				temporary_other:
					'Access to {{formattedCount}} servers is affected by a temporary Discord issue.',
				unknown_one: 'Discord access could not be updated for {{formattedCount}} server.',
				unknown_other: 'Discord access could not be updated for {{formattedCount}} servers.',
			},
		},
	},
	{
		discordCard: {
			connected: 'Verknüpftes Konto',
			linkDescription: 'Discord-Konto verknüpfen',
			userId: 'Discord-ID: {{id}}',
			authorizationRevoked: 'Autorisierung widerrufen',
			revokedDescription:
				'Du hast diese App aus deinen autorisierten Discord-Apps entfernt. Verknüpfe dein Konto erneut, um den Zugriff wiederherzustellen.',
			redirecting: 'Weiterleitung zu Discord…',
			relink: 'Discord-Konto erneut verknüpfen',
			refreshing: 'Wird aktualisiert…',
			refreshAccess: 'Discord-Zugriff aktualisieren',
			connectDescription:
				'Verknüpfe dein Discord-Konto, um Benachrichtigungen und Community-Funktionen zu nutzen.',
			link: 'Discord-Konto verknüpfen',
			linkFailed: 'Verknüpfung fehlgeschlagen',
			linkError: 'Ein Fehler ist aufgetreten',
			refreshStartError:
				'Die Aktualisierung des Discord-Zugriffs konnte nicht gestartet werden. Bitte versuche es später erneut.',
			refreshStatusError: 'Der Status des Discord-Zugriffs konnte nicht bestätigt werden',
			refreshed: 'Discord-Zugriff erfolgreich aktualisiert.',
			joined_one: '{{formattedCount}} Discord-Server erfolgreich beigetreten!',
			joined_other: '{{formattedCount}} Discord-Servern erfolgreich beigetreten!',
			refreshErrors: {
				authorization: 'Die Discord-Autorisierung muss möglicherweise erneuert werden',
				configuration: 'Problem mit der Discord-Serverkonfiguration',
				temporary: 'Discord ist vorübergehend nicht verfügbar',
				unknown: 'Discord-Zugriff nur unvollständig aktualisiert',
			},
			partialRefreshErrors: {
				authorization_one:
					'Der Zugriff auf {{formattedCount}} Server erfordert eine Discord-Autorisierung.',
				authorization_other:
					'Der Zugriff auf {{formattedCount}} Server erfordert eine Discord-Autorisierung.',
				configuration_one:
					'Ein Konfigurationsproblem betrifft den Zugriff auf {{formattedCount}} Server.',
				configuration_other:
					'Ein Konfigurationsproblem betrifft den Zugriff auf {{formattedCount}} Server.',
				temporary_one:
					'Eine vorübergehende Discord-Störung betrifft den Zugriff auf {{formattedCount}} Server.',
				temporary_other:
					'Eine vorübergehende Discord-Störung betrifft den Zugriff auf {{formattedCount}} Server.',
				unknown_one:
					'Der Discord-Zugriff konnte für {{formattedCount}} Server nicht aktualisiert werden.',
				unknown_other:
					'Der Discord-Zugriff konnte für {{formattedCount}} Server nicht aktualisiert werden.',
			},
		},
	},
	{
		discordCard: {
			connected: '연결된 계정',
			linkDescription: 'Discord 계정 연결',
			userId: 'Discord ID: {{id}}',
			authorizationRevoked: '인증 권한 취소됨',
			revokedDescription:
				'Discord의 승인된 앱에서 이 앱을 제거했습니다. 접근 권한을 복구하려면 계정을 다시 연결해 주세요.',
			redirecting: 'Discord로 이동 중…',
			relink: 'Discord 계정 다시 연결',
			refreshing: '갱신 중…',
			refreshAccess: 'Discord 접근 권한 갱신',
			connectDescription: 'Discord 계정을 연결하면 알림 및 커뮤니티 기능을 사용할 수 있습니다.',
			link: 'Discord 계정 연결',
			linkFailed: '연결 실패',
			linkError: '오류가 발생했습니다',
			refreshStartError: 'Discord 접근 권한 갱신을 시작하지 못했습니다. 나중에 다시 시도해 주세요.',
			refreshStatusError: 'Discord 접근 권한 상태를 확인하지 못했습니다',
			refreshed: 'Discord 접근 권한이 갱신되었습니다.',
			joined_one: 'Discord 서버 {{formattedCount}}개에 가입했습니다!',
			joined_other: 'Discord 서버 {{formattedCount}}개에 가입했습니다!',
			refreshErrors: {
				authorization: 'Discord 인증 권한을 갱신해야 할 수 있습니다',
				configuration: 'Discord 서버 설정에 문제가 있습니다',
				temporary: '일시적으로 Discord를 사용할 수 없습니다',
				unknown: 'Discord 접근 권한 갱신이 완료되지 않았습니다',
			},
			partialRefreshErrors: {
				authorization_one: '서버 {{formattedCount}}개에 접근하려면 Discord 인증이 필요합니다.',
				authorization_other: '서버 {{formattedCount}}개에 접근하려면 Discord 인증이 필요합니다.',
				configuration_one:
					'서버 설정 문제로 서버 {{formattedCount}}개의 접근 권한을 갱신하지 못했습니다.',
				configuration_other:
					'서버 설정 문제로 서버 {{formattedCount}}개의 접근 권한을 갱신하지 못했습니다.',
				temporary_one:
					'일시적인 Discord 문제로 서버 {{formattedCount}}개의 접근 권한을 갱신하지 못했습니다.',
				temporary_other:
					'일시적인 Discord 문제로 서버 {{formattedCount}}개의 접근 권한을 갱신하지 못했습니다.',
				unknown_one: '서버 {{formattedCount}}개의 Discord 접근 권한을 갱신하지 못했습니다.',
				unknown_other: '서버 {{formattedCount}}개의 Discord 접근 권한을 갱신하지 못했습니다.',
			},
		},
	}
)
