# Module `awire`

## Source

- Backend: `openapi3`
- Repository: `unknown`
- Pinned tag: ``unknown``
- Files: `openapi/awire.yaml`

## Channels

### `awirectl channels create-channel`

- Summary: Create a delivery channel.
- HTTP: `POST /api/v1/channels`
- Auth: required
- Body: required; media type `application/json`
- Flags: none

### `awirectl channels delete-channel`

- Summary: Delete an unused delivery channel.
- HTTP: `DELETE /api/v1/channels/{id}`
- Auth: required
- Body: none
- Flags:
  - `--id` (path, required): id
- Output: response media `application/json`

### `awirectl channels get-channel`

- Summary: Get one delivery channel.
- HTTP: `GET /api/v1/channels/{id}`
- Auth: required
- Body: none
- Flags:
  - `--id` (path, required): id
- Output: response media `application/json`

### `awirectl channels list-channels`

- Summary: List delivery channels.
- HTTP: `GET /api/v1/channels`
- Auth: required
- Body: none
- Flags: none
- Output: list path `channels`; columns `name`, `id`, `created_at`, `sign_secret`, `updated_at`, `webhook_url`; response media `application/json`

### `awirectl channels test-channel`

- Summary: Send a test card through a delivery channel.
- HTTP: `POST /api/v1/channels/{id}/test`
- Auth: required
- Body: none
- Flags:
  - `--id` (path, required): id
- Output: response media `application/json`

### `awirectl channels update-channel`

- Summary: Update a delivery channel.
- HTTP: `PUT /api/v1/channels/{id}`
- Auth: required
- Body: required; media type `application/json`
- Flags:
  - `--id` (path, required): id
- Output: response media `application/json`

## Repos

### `awirectl repos create-repo`

- Summary: Create a repository route.
- HTTP: `POST /api/v1/repos`
- Auth: required
- Body: required; media type `application/json`
- Flags: none

### `awirectl repos delete-repo`

- Summary: Delete a repository route.
- HTTP: `DELETE /api/v1/repos/{full_name}`
- Auth: required
- Body: none
- Flags:
  - `--full_name` (path, required): Repository full name. Slashes must be URL-encoded in raw HTTP paths.
- Output: response media `application/json`

### `awirectl repos get-repo`

- Summary: Get one repository route.
- HTTP: `GET /api/v1/repos/{full_name}`
- Auth: required
- Body: none
- Flags:
  - `--full_name` (path, required): Repository full name. Slashes must be URL-encoded in raw HTTP paths.
- Output: response media `application/json`

### `awirectl repos list-repos`

- Summary: List repository routes.
- HTTP: `GET /api/v1/repos`
- Auth: required
- Body: none
- Flags: none
- Output: list path `repos`; columns `channel_id`, `created_at`, `full_name`, `updated_at`, `webhook_secret`; response media `application/json`

### `awirectl repos update-repo`

- Summary: Update a repository route.
- HTTP: `PUT /api/v1/repos/{full_name}`
- Auth: required
- Body: required; media type `application/json`
- Flags:
  - `--full_name` (path, required): Repository full name. Slashes must be URL-encoded in raw HTTP paths.
- Output: response media `application/json`

## System

### `awirectl system get-whoami`

- Summary: Check the current awire API token.
- HTTP: `GET /api/v1/whoami`
- Auth: required
- Body: none
- Flags: none
- Output: response media `application/json`

