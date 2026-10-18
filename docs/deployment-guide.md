# Deployment

## Environment

Copy `.env.example` to `.env`. Set a unique `JWT_SECRET` and a 32-byte base64 `CREDENTIALS_KEY`. Set `ADMIN_PASSWORD` to at least 12 characters for the first setup, then remove it from the environment if you do not want the setup command to know it.

`CORS_ORIGIN` must be the frontend origin. The API binds `PORT`, default 4000.

Keep `STORAGE_ROOT` and `ROBOT_ROOT` on a volume that is backed up with the database and is writable only by the API user and the robot account. Anyone who can write the robot outbox can complete a robot job. That is the trust boundary of the file handoff. Prefer the authenticated robot API when the robot can call HTTP.

## Docker Compose

Docker was not installed on the development machine. The compose file is provided for a host that has it:

```powershell
docker compose up --build
```

The API health check calls `/api/health`. Run `npm run setup` once inside the API container, or an equivalent migration job, before users sign in. Change the MySQL passwords in the compose environment first.

## Process model

Run at least one API process and one worker process. The worker polls on `WORKER_POLL_MS`. Several workers can run; a job is claimed by one conditional update.

## Logging and recovery

The API logs unexpected errors as JSON with the message and code. It does not return stack traces. Secret-like fields are redacted before audit metadata is stored.

See `docs/database-schema.md` for dump and restore commands. Restore the storage directory as well. Keep `CREDENTIALS_KEY` in the secret store, not in the database backup.

## Hardening before production

- Use a least-privilege database account.
- Put TLS in front of the API.
- Replace the development MariaDB passwords.
- Rotate robot tokens if they were displayed in a shared log.
- Review the multer 1.x upload dependency and upgrade it when the application is upgraded.

## Public sign-up

Self sign-up is on by default (`ALLOW_SIGNUP=true`) so the "Try URAP free" button works out of the box. New accounts join the default tenant as `SIGNUP_ROLE` (default `project_manager`, never `administrator`) and only see their own projects. On a server reachable from the internet, set `ALLOW_SIGNUP=false` unless you want anyone to be able to create an account, or use a more limited `SIGNUP_ROLE` such as `viewer`. Sign-up attempts are limited to `SIGNUP_RATE_LIMIT_MAX` (default 10) per `SIGNUP_RATE_LIMIT_WINDOW_MS` (default one hour) per client address. If the API runs behind a reverse proxy, every client shares the proxy's address unless Express `trust proxy` is configured.
