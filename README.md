# ConfessionFlow 🤫🚀

> **The Automated Social Media Publishing & Moderation Pipeline for Anonymous Confessions**

ConfessionFlow bridges the gap between raw, anonymous Google Sheet submissions and Instagram Professional posts. It automates ingestion, rigorous safety & PII moderation, AI grammar polishing & caption drafting with **Groq AI (LPU inference)**, deterministic 1080x1080 card graphics, admin review triage, and direct broadcasting via the **official Meta Content Publishing API**.

---

## 🌟 Key Features

- 🛡️ **Zero-Harm Moderation & PII Shield**:
  - Automatically identifies, alerts, and masks phone numbers (`9876543210` &rarr; `********10`), email addresses, social handles, and identity numbers.
  - Multi-tier classification (`LOW`, `MEDIUM`, `HIGH` risk).
- ⚡ **Groq AI (Ultra-Fast LPUs)**:
  - Cleans typos, fixes punctuation, formats paragraphs without inventing facts or drama.
  - Generates hooks, call-to-action captions, and contextual hashtags.
- 🎨 **1080x1080 HTML/CSS Post Card Engine**:
  - Deterministic rendering — zero AI-hallucinated spelling errors on the visual graphic.
  - Dynamic font scaling and line-height fitting based on character length.
  - 7 Built-in Templates: *Classic Monochrome*, *Dark Velvet*, *Minimalist Serif*, *Love & Romance*, *Campus & College*, *Funny & Relatable*, *Deep Story*.
- 🔒 **Safe-by-Default Policy**:
  - Auto-publish is **disabled by default**.
  - Pipeline enforces: `NEW` &rarr; `IMPORTED` &rarr; `PROCESSING` &rarr; `READY_FOR_REVIEW` &rarr; `APPROVED` &rarr; `PUBLISHING` &rarr; `PUBLISHED`.
- 🔁 **Double-Post & Concurrency Prevention**:
  - In-flight mutex locks and database constraints ensure no confession is ever published twice.
- 📊 **Commercial-Grade Dashboard**:
  - Rapid card triage review queue with bulk approve/reject.
  - Content publishing calendar with drag/drop reschedule capabilities.
  - Full activity log audit trail for every action.
- 🧪 **Zero-Friction Mock Mode (`MOCK_EXTERNAL_APIS=true`)**:
  - Develop and test the entire flow locally without requiring Meta developer accounts or live Google Service accounts right away.

---

## 🏗️ Architecture & Data Flow

```
[ Google Form / Sheet Submission ]
               │
               ▼ (POST /api/sheets/sync or Cron)
[ GoogleSheetsService ] ─── Idempotent Deduplication (Sheet ID + Row)
               │
               ▼
[ ModerationService ] ─── PII Masking & Risk Scoring (LOW / MEDIUM / HIGH)
               │
               ▼
[ AIService ] ─────────── Groq Llama 3.3 (Fact Preservation, Caption, Hashtags)
               │
               ▼
[ ImageService ] ──────── 1080x1080 HTML/CSS Engine + Playwright/SVG Snapshot
               │
               ▼
[ Admin Review Queue ] ── Triage, Edit, Approve, Reject (/review, /confessions/[id])
               │
        ┌──────┴────────┐
        ▼               ▼
[ Instant Publish ]  [ Scheduled Queue ] (Vercel Cron /api/cron/publish-scheduled)
        │               │
        └──────┬────────┘
               ▼
[ InstagramService ] ──── Official Meta Graph API v21.0 Content Publishing
               │
               ▼
[ Sync-Back & Log ] ──── Update Google Sheet Status + Write to Activity Log
```

---

## 🛠️ Tech Stack

- **Framework**: Next.js 14+ (App Router, Server Actions, Route Handlers)
- **Language**: TypeScript (Strict mode)
- **Styling**: Tailwind CSS, Lucide React icons
- **Database & Auth**: Supabase PostgreSQL + Supabase Auth
- **AI Engine**: Groq AI SDK (`llama-3.3-70b-versatile` / `llama-3.1-8b-instant`)
- **Image Generation**: Playwright Chromium / Standalone SVG Engine
- **Integrations**: Google Sheets API v4, Meta Graph API v21.0
- **Testing**: Vitest unit & integration test suite

---

## 🚀 Quick Start (Local Development)

### 1. Clone & Install Dependencies
```bash
git clone <your-repo>
cd confessionflow
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

By default, `MOCK_EXTERNAL_APIS=true` is enabled in `.env.local`. This allows you to immediately test all features without third-party credentials.

### 3. Seed Demo Data
```bash
npm run seed
```
This loads 7 post templates, default branding, and sample confessions with various risk profiles into the local database store.

### 4. Run the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

- Click **"Enter Demo Admin Session"** on the login page.
- Test the dashboard, click **"Sync Now"**, review submissions, preview 1080x1080 cards, and trigger publishing!

---

## 🧪 Running Automated Tests

```bash
npm test
```
Runs the test suite verifying:
- PII masking and detection rules
- Confession state machine transitions
- Google Sheets column mapping
- AI text cleaning and caption generation
- 1080x1080 card fitting and HTML escaping
- Instagram duplicate publish prevention

---

## 🔑 Integration Guides (Production Setup)

### 1. Groq AI Setup
1. Sign up at [Groq Console](https://console.groq.com/).
2. Generate an API Key under **API Keys**.
3. Add to your `.env.local`:
   ```env
   AI_PROVIDER=groq
   GROQ_API_KEY=gsk_...
   GROQ_MODEL=llama-3.3-70b-versatile
   ```
4. Set `MOCK_EXTERNAL_APIS=false`.

### 2. Google Sheets API Setup
1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project and enable **Google Sheets API**.
3. Navigate to **IAM & Admin** &rarr; **Service Accounts** &rarr; **Create Service Account**.
4. Create a JSON key and download it.
5. Share your Google Sheet with the Service Account email (Editor permissions).
6. Set in `.env.local`:
   ```env
   GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id
   GOOGLE_SHEETS_SHEET_NAME=Form Responses 1
   GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
   GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
   ```

### 3. Meta / Instagram Graph API Setup
Use the official Meta Content Publishing API for Instagram Professional (Business or Creator) accounts:
1. Ensure your Instagram account is switched to a **Business** or **Creator** account.
2. Link your Instagram account to a **Facebook Page**.
3. Open [Meta for Developers](https://developers.facebook.com/) and create a **Business** app.
4. Add the **Instagram Graph API** product.
5. In Graph API Explorer, request the following permissions:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
   - `pages_read_engagement`
6. Generate a **Long-Lived User Access Token**.
7. Retrieve your `INSTAGRAM_ACCOUNT_ID` via:
   `GET https://graph.facebook.com/v21.0/me/accounts` &rarr; `GET /{page-id}?fields=instagram_business_account`
8. Set in `.env.local`:
   ```env
   INSTAGRAM_ACCOUNT_ID=your_instagram_account_id
   INSTAGRAM_ACCESS_TOKEN=your_long_lived_token
   ```

### 4. Supabase PostgreSQL Setup
1. Create a new project at [Supabase](https://supabase.com).
2. Run migrations located in `supabase/migrations/001_initial_schema.sql` and `002_seed_data.sql` in the **SQL Editor**.
3. Under **Storage**, create a public bucket named `instagram-posts`.
4. Copy your project credentials into `.env.local`:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

---

## ⏰ Cron Setup (Vercel & Automated Workflows)

ConfessionFlow includes two protected cron endpoints:
- `POST /api/cron/sync` (Polls Google Sheets for new rows every 5 minutes)
- `POST /api/cron/publish-scheduled` (Checks and publishes due posts every minute)

Both endpoints require the `CRON_SECRET` bearer header or `x-cron-secret` header.

### Vercel Cron Configuration (`vercel.json`):
```json
{
  "crons": [
    {
      "path": "/api/cron/sync",
      "schedule": "*/5 * * * *"
    },
    {
      "path": "/api/cron/publish-scheduled",
      "schedule": "* * * * *"
    }
  ]
}
```

---

## 🔒 Security Summary

- **Never Client-Exposed**: Service account private keys, Instagram access tokens, Groq API keys, and Supabase service role keys are strictly handled server-side.
- **Strict HTML Sanitization**: User-submitted text is escaped before injecting into DOM templates to eliminate XSS.
- **Idempotency Locks**: Concurrency mutexes prevent multiple rapid button presses from creating duplicate posts on Instagram.
- **Controlled Retries**: Publishing attempts max out at 3 retries before transitioning to `FAILED_REQUIRES_ACTION`.

---

## 📄 License
MIT © ConfessionFlow
