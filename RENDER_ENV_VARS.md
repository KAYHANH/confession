# ConfessionFlow — Render Environment Variables

## Required for Production (Set in Render Dashboard → Environment)

### Auth Security (MANDATORY)
```
AUTH_SECRET=<generate with: openssl rand -hex 32>
ADMIN_EMAIL=admin@confessionflow.io
ADMIN_PASSWORD=<your-strong-password>
```

### Instagram / Meta
```
INSTAGRAM_ACCOUNT_ID=<your-ig-business-account-id>
INSTAGRAM_ACCESS_TOKEN=<your-long-lived-page-access-token>
META_APP_ID=<your-meta-app-id>
META_APP_SECRET=<your-meta-app-secret>
```

### Google Sheets
```
GOOGLE_SERVICE_ACCOUNT_EMAIL=<service-account@project.iam.gserviceaccount.com>
GOOGLE_PRIVATE_KEY=<-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY----->
GOOGLE_SHEET_ID=<your-spreadsheet-id>
```

### Groq AI (for duplicate detection / moderation)
```
GROQ_API_KEY=<your-groq-api-key>
```

### Supabase (optional — if using Supabase for DB/storage)
```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

### Growth Intelligence & Analytics
```
ENABLE_GROWTH_INTELLIGENCE=true
ENABLE_ANALYTICS_COLLECTION=true
INSTAGRAM_API_VERSION=v21.0
```

### Instagram Login Scopes (Permissions required on Meta App)
The Meta App and user access token require the following Instagram Login scopes:
- `instagram_business_basic` (account profile and media info)
- `instagram_business_content_publish` (posting single cards & carousels)
- `instagram_business_manage_insights` (insights & performance analytics)

### Cron Security
```
CRON_SECRET=<generate with: openssl rand -hex 32>
```
Endpoints:
- `POST /api/cron/auto-publish` (publishing schedule runner)
- `POST /api/cron/sync` (Google Sheets sync runner)
- `POST /api/cron/instagram-analytics` (Growth Intelligence performance snapshot collector, recommended */15 * * * *)

## Generate Secrets (run locally)
```bash
# AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# CRON_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Notes
- `AUTH_SECRET` and `ADMIN_PASSWORD` are REQUIRED. Without them production login will refuse all requests.
- `CRON_SECRET` is required for GitHub Actions cron jobs to call `/api/cron/*` routes.
- Never commit `.env.local` to git. It is in `.gitignore`.
