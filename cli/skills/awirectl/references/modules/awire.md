# Module `awire`

## Source

- Backend: `openapi3`
- Repository: `unknown`
- Pinned tag: ``unknown``
- Files: `openapi/awire.yaml`

## Channels

### `awirectl channels create`

- Summary: Create a delivery channel.
- HTTP: `POST /api/v1/channels`
- Auth: required
- Body: required; media type `application/json`
- Flags: none

### `awirectl channels delete`

- Summary: Delete an unused delivery channel.
- HTTP: `DELETE /api/v1/channels/{id}`
- Auth: required
- Body: none
- Flags:
  - `--id` (path, required): id
- Output: response media `application/json`
- Notes:
  - Channel must have zero attached repos before deletion.
- Known errors:
  - HTTP 404: Channel id does not exist
  - HTTP 409: Channel still referenced by one or more repos (response includes repos[])
- Example: `awirectl channels delete --id 2b2ed599-697c-4e83-93f4-92f18f5254e9 -o json`

### `awirectl channels get`

- Summary: Get one delivery channel.
- HTTP: `GET /api/v1/channels/{id}`
- Auth: required
- Body: none
- Flags:
  - `--id` (path, required): id
- Output: response media `application/json`

### `awirectl channels list`

- Summary: List delivery channels.
- HTTP: `GET /api/v1/channels`
- Auth: required
- Body: none
- Flags: none
- Output: list path `channels`; columns `name`, `id`, `created_at`, `sign_secret`, `updated_at`, `webhook_url`; response media `application/json`

### `awirectl channels test`

- Summary: Send a test card through a delivery channel.
- HTTP: `POST /api/v1/channels/{id}/test`
- Auth: required
- Body: none
- Shortcuts:
  - `awirectl ping`
- Flags:
  - `--channel_id` (path, required): Delivery channel ID
- Output: response media `application/json`
- Example:

```
awirectl channels test --channel_id 2b2ed599-697c-4e83-93f4-92f18f5254e9 -o json
awirectl ping --channel_id 2b2ed599-697c-4e83-93f4-92f18f5254e9 -o json
```

### `awirectl channels update`

- Summary: Update a delivery channel.
- HTTP: `PUT /api/v1/channels/{id}`
- Auth: required
- Body: required; media type `application/json`
- Flags:
  - `--id` (path, required): id
- Output: response media `application/json`

## Repos

### `awirectl repos create`

- Summary: Create a repository route.
- HTTP: `POST /api/v1/repos`
- Auth: required
- Body: required; media type `application/json`
- Flags: none
- Prerequisites:
  - Create a delivery channel first: awirectl channels create --set name=... --set webhook_url=...
- Example:

```
awirectl repos create \
  --set full_name=octocat/Hello-World \
  --set channel_id=2b2ed599-697c-4e83-93f4-92f18f5254e9 \
  --set 'events=["pull_request.opened"]'
```

### `awirectl repos delete`

- Summary: Delete a repository route.
- HTTP: `DELETE /api/v1/repos/{full_name}`
- Auth: required
- Body: none
- Flags:
  - `--full_name` (path, required): Repository full name. Slashes must be URL-encoded in raw HTTP paths.
- Output: response media `application/json`

### `awirectl repos get`

- Summary: Get one repository route.
- HTTP: `GET /api/v1/repos/{full_name}`
- Auth: required
- Body: none
- Flags:
  - `--full_name` (path, required): Repository full name. Slashes must be URL-encoded in raw HTTP paths.
- Output: response media `application/json`

### `awirectl repos list`

- Summary: List repository routes.
- HTTP: `GET /api/v1/repos`
- Auth: required
- Body: none
- Flags: none
- Output: list path `repos`; columns `channel_id`, `created_at`, `full_name`, `updated_at`, `webhook_secret`; response media `application/json`

### `awirectl repos update`

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

