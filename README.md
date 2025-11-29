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
wrangler secret put TELEGRAM_HEADER_SECRET
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

https://budgetbot.your-account.workers.dev

---

### 8. Configure Telegram Webhook
```
export TELEGRAM_BOT_TOKEN=YOUR_REAL_TOKEN

curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://budgetbot.<your-account>.workers.dev/telegram-webhook/YOUR_SECRET" \
  -d "secret_token=YOUR_HEADER_SECRET"
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
  ...
};
```
---

## Budget Model & Categories

This bot uses three types of categories to give us flexibility in how we budget and track our spending. We designed it this way because we personally needed:

- A **shared daily budget** for small, repeated things like food and coffee  
- **Per-category monthly budgets** for bigger recurring items  
- An **uncapped "Other" bucket** for exceptions or one-off spends  

---

### Category Types

There are three kinds of categories in the code:

#### 1. Daily Categories (`type: "daily"`)

- These all draw from a single **shared daily budget**.
- The daily budget is different for **weekdays vs weekends**:
  - `WEEKDAY_DAILY_BUDGET` (e.g. SGD 50)
  - `WEEKEND_DAILY_BUDGET` (e.g. SGD 80)
- Examples: `Breakfast`, `Lunch`, `Dinner`, `Coffee`, `Snacks`.
- The bot treats all of these as “daily spending” and compares them against the day’s budget based on **Singapore local date**.

#### 2. Monthly Categories (`type: "monthly"`)

- Each of these has its **own monthly budget** in `MONTHLY_CATEGORY_BUDGETS`.
- Intended for recurring or larger expenses where you want a fixed cap.
- Examples: `Groceries`, `Rent`, `Transport`, `Entertainment`, `Shopping`.

#### 3. Other Categories (`type: "other"`)

- These have **no budget limit**.
- They are shown in the monthly summary but **do not count** toward the capped budget totals.
- Useful for one-off or exceptional purchases (e.g. gifts, special events).

---

### How the Budgets Are Computed

#### 1. Daily Budgets (Weekday / Weekend)

- For any SG-local date:
  - **Mon–Fri** → `WEEKDAY_DAILY_BUDGET`
  - **Sat–Sun** → `WEEKEND_DAILY_BUDGET`
- `/today`:
  - Uses today’s **Singapore date**
  - Sums all **daily category expenses**
  - Returns:
    - Daily budget
    - Spent amount
    - Remaining amount
    - Category breakdown

#### 2. Monthly Daily-Bucket Budget

- For a given month:
  - Counts weekdays and weekends
  - Computes:

    ```
    monthly_daily_budget =
      (weekdays * WEEKDAY_DAILY_BUDGET) +
      (weekends * WEEKEND_DAILY_BUDGET)
    ```

- Used in `/month` to compare:
  - Total daily spending vs total planned daily budget

#### 3. Monthly Category Budgets

- For each entry in `MONTHLY_CATEGORY_BUDGETS`:
  - The bot shows: `spent / budget`
- Also computes:
  - Total fixed monthly budget
  - Total fixed monthly spending

#### 4. Overall Tracked Budget

The overall “budget vs spent” includes:

- The **monthly daily-bucket budget**
- The **sum of all fixed monthly category budgets**

"Other" categories are tracked but excluded from capped totals.

We structured the bot this way because it matches our personal budgeting style:
- Flexible daily spending
- Fixed monthly commitments
- A safe uncapped bucket for everything else

---

## Customizing Categories and Budgets

All configuration lives near the top of `src/index.ts`.

---

### 1. Adding or Changing Categories

Find this block:

```ts
const CATEGORIES: Record<
  string,
  { type: "daily" | "monthly" | "other" }
> = {
  Breakfast: { type: "daily" },
  Lunch: { type: "daily" },
  Dinner: { type: "daily" },
  Coffee: { type: "daily" },
  Snacks: { type: "daily" },

  Groceries: { type: "monthly" },
  Rent: { type: "monthly" },
  Transport: { type: "monthly" },
  Entertainment: { type: "monthly" },
  Shopping: { type: "monthly" },

  Other: { type: "other" },
};
```

Add in new categories like these:

```
Labubu: { type: "daily" },
KlarnaPayment: { type: "monthly" },
Mortgage: { type: "other" },
```

Then change the budget in these blocks:

```
### Daily Budgets

const WEEKDAY_DAILY_BUDGET = 100.0; // Labubu has type "daily", and is tracked here
const WEEKEND_DAILY_BUDGET = 200.0;

### Monthly Budgets

const MONTHLY_CATEGORY_BUDGETS = {
  KlarnaPayment: 0.0,  // I am defaulting on them
  Rent: 99999.0,  // cheapest apartment in Singapore
  ...
};
```

---

## Security Notes

- All secrets are stored securely using `wrangler secret` and are never committed to the repository.
- Only explicitly whitelisted Telegram user IDs can interact with the bot.
- The webhook endpoint is protected by a private secret URL path and Telegram header verification.
- No public read or write HTTP APIs are exposed; all data access happens internally via the Telegram bot.
- All database access is parameterized to prevent SQL injection.
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

