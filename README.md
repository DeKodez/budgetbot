<p align="center">
  <img width="512" height="512" alt="image" src="https://github.com/user-attachments/assets/9c89c324-a5d6-44c9-ba1f-74131cf85c13" />
</p>


# 💸 BudgetBot – Telegram Expense Tracker (Cloudflare Workers + D1)

BudgetBot is a lightweight Telegram bot for tracking shared expenses between two users. It runs fully serverless on Cloudflare Workers with Cloudflare D1 as the database.

It supports:

- Daily & monthly budgets
- Different weekday vs weekend daily budgets
- Category-based expense tracking
- Unlimited “Other” category
- Button-based category input
- Singapore timezone (Asia/Singapore)
- Secure user whitelist
- JSON APIs for daily & monthly summaries

---

## Architecture
```
Telegram ──HTTPS──▶ Cloudflare Worker (TypeScript)
                         │
                         └──▶ Cloudflare D1 (SQLite-like DB)
```
No servers to manage, no containers, no background processes.

---

## Features

- /start – Show help and category keyboard  
- /add – Add an expense using category buttons  
- /today – Daily spending vs daily budget  
- /month – Monthly spending vs full monthly budget  

Budgets:
- Daily budgets (shared):
  - Weekday budget
  - Weekend budget
- Monthly budgets per category
- “Other” category is uncapped

APIs:
- GET /api/summary/daily?date=YYYY-MM-DD
- GET /api/summary/monthly?year=YYYY&month=MM

---

## 🛠 Tech Stack

- Cloudflare Workers (TypeScript)
- Cloudflare D1 (SQLite-compatible)
- Telegram Bot API
- Wrangler CLI

---

## Setup Instructions

### 1. Install dependencies

```
npm install -g wrangler
```

Login to Cloudflare:
```
wrangler login
```
---

### 2. Initialize project
```
wrangler init budgetbot  
cd budgetbot
```
Choose:
- ✅ TypeScript
- ❌ No template
- ❌ No dependencies

---

### 3. Create D1 database
```
wrangler d1 create budgetbot-db
```
Copy the database_id into wrangler.jsonc:
```
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "budgetbot-db",
    "database_id": "PASTE_ID_HERE"
  }
]
```
---

### 4. Apply database schema

If using migrations:
```
wrangler d1 migrations apply DB --remote
```
Or directly apply:
```
wrangler d1 execute DB --remote --file=./migrations/0001_init.sql
```
---

### 5. Set secrets
```
wrangler secret put TELEGRAM_BOT_TOKEN  
wrangler secret put TELEGRAM_WEBHOOK_SECRET  
wrangler secret put ALLOWED_USER_IDS  
```
ALLOWED_USER_IDS should be:
```
<user_id1>,<user_id2>,...
```
---

### 6. Run locally (optional)
```
wrangler dev
```
Health check:

http://127.0.0.1:8787/healthz

---

### 7. Deploy
```
wrangler deploy
```
You’ll get a public URL like:

https://budgetbot.<your-account>.workers.dev

---

### 8. Configure Telegram Webhook
```
export TELEGRAM_BOT_TOKEN=YOUR_REAL_TOKEN

curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://budgetbot.<your-account>.workers.dev/telegram-webhook/YOUR_SECRET"
```
Verify:
```
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```
---

## Configuration

All budgets & categories are defined in:

**src/index.ts**

```
### Categories

const CATEGORIES = {
  Breakfast: { type: "daily" },
  Lunch: { type: "daily" },
  Dinner: { type: "daily" },
  Groceries: { type: "monthly" },
  Rent: { type: "monthly" },
  Other: { type: "other" },
};

### Daily Budgets

const WEEKDAY_DAILY_BUDGET = 50.0;  
const WEEKEND_DAILY_BUDGET = 80.0;

### Monthly Budgets

const MONTHLY_CATEGORY_BUDGETS = {
  Groceries: 400.0,
  Rent: 1500.0,
};
```
---

## Security Notes

- All secrets are stored using wrangler secret.
- Only whitelisted Telegram users can interact with the bot.
- Webhook endpoint is protected by a secret URL path.

---

## Example API Responses

Daily summary:

GET /api/summary/daily

Returns daily budget, spending, remaining amount, and breakdown by category.

Monthly summary:

GET /api/summary/monthly

Returns:
- Monthly daily-bucket budget
- Fixed monthly budgets
- Total budget vs total spent vs remaining

---

## Intended Use

This project is designed for personal/shared budgeting between two users. Could be used for more I think but it may not be suitable for large groups. 

