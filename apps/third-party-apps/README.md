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
