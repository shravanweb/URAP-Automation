# Installation

## Prerequisites

- Node.js 22 or newer
- A MySQL 8 or MariaDB 10.6+ server
- Optional: Docker Desktop, UiPath Studio and Robot

This workspace was built with Node.js 22.23.2. Docker and UiPath Robot were not installed.

## Local MariaDB used for verification

The server binary is MariaDB 11.4.13, downloaded from `https://archive.mariadb.org/mariadb-11.4/winx64-packages/mariadb-11.4.13-winx64.zip` and extracted to `Desktop\UI Path\.tools\mariadb-11.4.13-winx64`.

```powershell
& "C:\Users\Shravan\Desktop\UI Path\.tools\mariadb-11.4.13-winx64\bin\mysql_install_db.exe" --datadir="C:\Users\Shravan\Desktop\UI Path\.tools\mariadb-data" --password="urap_root_dev" --port=3307
& "C:\Users\Shravan\Desktop\UI Path\.tools\mariadb-11.4.13-winx64\bin\mysqld.exe" --defaults-file="C:\Users\Shravan\Desktop\UI Path\.tools\mariadb-data\my.ini" --console
```

In another terminal, as root:

```powershell
& "C:\Users\Shravan\Desktop\UI Path\.tools\mariadb-11.4.13-winx64\bin\mysql.exe" -u root -p -P 3307 -h 127.0.0.1 -e "CREATE USER IF NOT EXISTS 'urap'@'127.0.0.1' IDENTIFIED BY 'urap_dev_password'; GRANT ALL PRIVILEGES ON *.* TO 'urap'@'127.0.0.1'; FLUSH PRIVILEGES;"
```

The local root and application passwords above are for this development machine. Replace them before any shared deployment. Production should not grant `ALL PRIVILEGES ON *.*`.

## Application

```powershell
cd "C:\Users\Shravan\Desktop\UI Path\universal-rpa\backend"
npm install
npm run setup
npm start
```

Web automation needs a browser. Run once in `backend` (downloads Chromium, about 150 MB, into `%LOCALAPPDATA%\ms-playwright`):

```powershell
npx playwright install chromium
```

Or set `BROWSER_CHANNEL=msedge` in `.env` to use the installed Microsoft Edge.

OCR downloads English language data into `data\ocr-cache` the first time it runs. On a machine without internet, copy `eng.traineddata` into a folder and set `OCR_LANG_PATH`.

Desktop automation uses the built-in Windows PowerShell; nothing to install. See `desktop-automation.md`.

`npm run setup` applies `database/schema.sql`, any new files in `database/migrations`, and `database/seed.sql`, (an existing database gets `003_action_center` for Action Center tasks; the reseed adds the PostgreSQL, Google Sheets, and Credential connectors), then creates the administrator from `ADMIN_EMAIL` and `ADMIN_PASSWORD` if that user does not exist.

```powershell
cd "C:\Users\Shravan\Desktop\UI Path\universal-rpa\backend"
npm run worker
```

```powershell
cd "C:\Users\Shravan\Desktop\UI Path\universal-rpa\frontend"
npm install
npm run dev
```

Open `http://localhost:5173` and sign in with the administrator email and password from `.env`.

## Tests

```powershell
cd "C:\Users\Shravan\Desktop\UI Path\universal-rpa\backend"
npm test
cd ..\frontend
npm test
```

Backend tests reset the `urap_test` database. Set `TEST_DATABASE_URL` only to a disposable database.

## Troubleshooting

- `Executable doesn't exist ... ms-playwright`: run `npx playwright install chromium` in `backend`, or set `BROWSER_CHANNEL`.
- `DESKTOP_UNSUPPORTED`: desktop steps run only on Windows (or with `DESKTOP_DRIVER=mock`).
- A job stays `SUSPENDED`: it waits for an Action Center task; complete it under Action Center.

- `CREDENTIALS_KEY must be a base64-encoded 32-byte key`: generate 32 random bytes and base64-encode them.
- `ECONNREFUSED 127.0.0.1:3307`: the MariaDB process is not running.
- Login says the email or password is invalid: run `npm run setup` after `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set.
- A job stays `QUEUED`: the worker process is not running, or the workflow execution type is `uipath` and no robot result has arrived.
- A robot stays unavailable: it has not called `POST /api/robot/heartbeat` in the last 60 seconds.
