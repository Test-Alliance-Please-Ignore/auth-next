# Third-Party Apps OAuth Provider

This worker is the repo-owned OAuth provider for registered third-party applications.

## Public endpoints

### Discovery

- `GET /.well-known/oauth-authorization-server`

The provider exposes RFC 8414 metadata with:

- `issuer`
- `authorization_endpoint`
- `token_endpoint`
- `scopes_supported`
- `response_types_supported`
- `response_modes_supported`
- `grant_types_supported`
- `token_endpoint_auth_methods_supported`
- `revocation_endpoint`
- `code_challenge_methods_supported`

### Token endpoint

- `POST /oauth/token`

Supported grant handling:

- `authorization_code`
- `refresh_token`
- revocation via `token` form field, following RFC 7009 semantics

Supported client auth methods:

- `client_secret_basic`
- `client_secret_post`
- `none` for public clients

PKCE support:

- `code_challenge_method=plain`
- `code_challenge_method=S256`

Refresh behavior:

- refresh tokens are rotated on use
- the previous refresh token remains valid until first use of the new token
- token and grant props are preserved through the provider callback layer

## API handlers

The provider exposes authenticated API requests to the worker-owned API handlers:

- `GET /oauth/api/me`
- `GET /oauth/api/esi-proxy/*`

These handlers receive the token grant props through `ctx.props` after the provider validates the access token.

## Client metadata

Registered client metadata is stored through the shared admin RPC and exposed back to the admin UI.

Supported fields:

- `clientName`
- `redirectUris`
- `scopes`
- `tokenEndpointAuthMethod`
- `grantTypes`
- `responseTypes`

## Consent freshness

The consent flow requires a fresh authenticated session before consent is finalized. The current implementation uses the session creation timestamp as the freshness marker.

## Local OAuth client harness

The worker package includes a standalone OAuth client harness for dev-server integration testing.

Example:

```bash
pnpm -F third-party-apps oauth:harness auth \
	--issuer http://127.0.0.1:8787 \
	--client-id your-client-id \
	--redirect-uri http://127.0.0.1:9786/callback \
	--scope profile \
	--scope groups
```

Supported commands:

- `discover` - print the provider discovery document
- `auth` - run the PKCE authorization-code flow against a local callback server
- `token` - exchange an authorization code for tokens
- `refresh` - refresh an access token using a refresh token
- `me` - call the provider `GET /oauth/api/me` endpoint
- `call` - call an arbitrary provider API path with a bearer token
- `scenario-profile` - authorize and verify the profile and groups API response
- `scenario-esi-basic` - authorize and verify `me`, wallet, location, and online ESI proxy calls

Notes:

- the redirect URI must be a local loopback HTTP URL registered on the client
- `auth` uses PKCE by default
- token endpoint auth defaults to `client_secret_basic` unless `none` is selected or no secret is provided

Quick smoke test examples:

```bash
	pnpm -F third-party-apps oauth:scenario:profile \
		--issuer http://127.0.0.1:8787 \
		--client-id your-client-id \
		--client-secret your-client-secret
```

```bash
pnpm -F third-party-apps oauth:scenario:esi \
	--issuer http://127.0.0.1:8787 \
	--client-id your-client-id \
	--client-secret your-client-secret
```

The harness prints the authorization URL and waits for the local callback server to receive the redirect.
Open that URL in a browser, finish sign-in/consent, and the scenario will continue automatically.
