# steadier

A responsive habit tracker built with Flask, SQLite, HTML, CSS, and vanilla JavaScript. The Flask-served [index.html](./index.html) is the app entry point. User accounts keep their habits, completion history, mood check-ins, and journal entries separate.

Use Python 3.10 or later.

## Run locally on Windows

Open PowerShell in this folder:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$env:SECRET_KEY = (python -c "import secrets; print(secrets.token_hex(32))")
$env:FLASK_DEBUG = "1"
python app.py
```

Open <http://127.0.0.1:5000> for the full habit app, or <http://127.0.0.1:5000/overview> for the redesigned overview connected to the same API and database. Flask debug mode reloads the backend when Python files change; refresh the browser to see HTML, CSS, or JavaScript edits. Keep the generated `SECRET_KEY` in your PowerShell session while using the app; choose a protected, persistent secret when deploying. The SQLite database is created in `instance\habits.sqlite3` by default. Set `HABIT_TRACK_DATABASE` to use another local path.

## Administrator setup

New accounts always receive the `user` role. To create the first administrator on a fresh install, set these variables before starting the server:

```powershell
$env:ADMIN_EMAIL = "admin@example.com"
$env:ADMIN_NAME = "Workspace Admin"
$env:ADMIN_PASSWORD = "use-a-unique-password-of-at-least-10-characters"
python app.py
```

The environment bootstrap runs once and records that it has been applied. Remove the administrator variables after setup. To promote an already registered account instead, run this once from this folder:

```powershell
python app.py promote-admin admin@example.com
```

Administrators can view workspace totals, promote or demote accounts, create, rename, and delete any user's habits, and delete accounts with their associated data from the Overview's Admin console. The last administrator cannot be demoted or deleted. Regular accounts can manage only their own habits and data.

## Deploy to Vercel with Neon

The app uses local SQLite by default for development. On Vercel, configure `DATABASE_URL` with the pooled connection string from your Neon project; PostgreSQL tables are initialized automatically. The serverless filesystem is not used for production data.

1. In Vercel, import the GitHub repository and set **Root Directory** to `habit track`.
2. Create a Neon project and copy its pooled PostgreSQL connection string into the Vercel `DATABASE_URL` environment variable.
3. Add a long, random `SECRET_KEY`. To bootstrap the first admin, also set `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD`.
4. Deploy. Visit `/overview` for the redesigned dashboard or `/` for the full habit tracker. After the first successful admin setup, remove the `ADMIN_*` values and redeploy.

Use the pooled Neon URL for serverless deployments. Configure the environment variables for Production (and Preview if you want preview deployments to use a separate database). Never commit database URLs, passwords, or secret keys.

## What's included

- Account registration, login, logout, hashed passwords, and profile/password updates.
- User/admin roles, one-time environment bootstrap or CLI promotion, and administrator account management.
- Per-user habit CRUD, categories, schedules, icons, colors, preferred times, reminders, and completion history.
- Personalized dashboard with daily completion progress, weekly activity and goals, next-step actions, streaks, XP/levels, and milestone badges.
- Weekly/monthly charts, habit consistency summaries, mood tracking, daily journaling, and a focus timer.
- Light/dark themes and an assistant endpoint designed to accept a provider implementation later.
- CSRF-protected state-changing routes and private, parameterized SQLite queries.

Browser notifications require permission and the app to remain open in that browser. The assistant uses local, pre-written guidance and does not connect to an AI service. This app is for habit reflection, not medical care.

## Run tests

```powershell
python -m unittest discover -s tests
```
