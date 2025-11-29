export interface Env {
	DB: D1Database;
	TELEGRAM_BOT_TOKEN: string;
	TELEGRAM_WEBHOOK_SECRET: string;
	TELEGRAM_HEADER_SECRET: string;
	ALLOWED_USER_IDS: string; // comma-separated numeric IDs
  }
  
  /**
   * CATEGORY & BUDGET CONFIGURATION
   * --------------------------------
   */
  
  // Categories:
  //   type "daily"   -> counts into daily bucket (weekday/weekend budgets)
  //   type "monthly" -> has its own monthly budget (see MONTHLY_CATEGORY_BUDGETS)
  //   type "other"   -> uncapped (no budget limit)
  const CATEGORIES: Record<
	string,
	{ type: "daily" | "monthly" | "other" }
  > = {
	// Daily bucket categories (meals/drinks)
	Meals: { type: "daily" },
	Drinks: { type: "daily" },

	// Monthly budget categories
	Groceries: { type: "monthly" },
	Utilities: { type: "monthly" },
	Transport: { type: "monthly" },
	Declan: { type: "monthly" },
	Myat: { type: "monthly" },
  
	// Unlimited
	Other: { type: "other" },
  };
  
  // Daily budgets (SGD)
  const WEEKDAY_DAILY_BUDGET = 50.0; // Mon–Fri
  const WEEKEND_DAILY_BUDGET = 80.0; // Sat–Sun
  
  // Monthly budgets for "monthly" categories
  // Keys must exactly match CATEGORIES entries with type "monthly"
  const MONTHLY_CATEGORY_BUDGETS: Record<string, number> = {
	Groceries: 300.0,
	Utilities: 150.0,
	Transport: 218.0,
	Declan: 100.0,
	Myat: 200.0,
  };
  
  // Precomputed category lists for queries
  const DAILY_CATEGORIES = Object.entries(CATEGORIES)
	.filter(([, meta]) => meta.type === "daily")
	.map(([name]) => name);
  
  const MONTHLY_CATEGORIES = Object.entries(CATEGORIES)
	.filter(([, meta]) => meta.type === "monthly")
	.map(([name]) => name);
  
  const OTHER_CATEGORIES = Object.entries(CATEGORIES)
	.filter(([, meta]) => meta.type === "other")
	.map(([name]) => name);
  
  // Timezone for everything
  const SG_TIMEZONE = "Asia/Singapore";
  
  // ---------- Helper: parse allowed user IDs from env ----------
  
  function parseAllowedUserIds(env: Env): Set<number> {
	const raw = env.ALLOWED_USER_IDS || "";
	const ids = raw
	  .split(",")
	  .map((s) => s.trim())
	  .filter(Boolean)
	  .map((s) => Number(s))
	  .filter((n) => Number.isFinite(n));
  
	return new Set(ids);
  }
  
  // ---------- Helpers: time & calendar (SG) ----------
  
  /**
   * Get current timestamp in UTC plus its SG-local date/month strings.
   */
  function nowSgLocal() {
	const nowUtc = new Date();
  
	// Use Intl.DateTimeFormat to get SG-local parts
	const formatter = new Intl.DateTimeFormat("en-CA", {
	  timeZone: SG_TIMEZONE,
	  year: "numeric",
	  month: "2-digit",
	  day: "2-digit",
	});
  
	const parts = formatter.formatToParts(nowUtc);
	const year = parts.find((p) => p.type === "year")?.value;
	const month = parts.find((p) => p.type === "month")?.value;
	const day = parts.find((p) => p.type === "day")?.value;
  
	if (!year || !month || !day) {
	  throw new Error("Failed to compute SG local date");
	}
  
	const tsSgDate = `${year}-${month}-${day}`; // YYYY-MM-DD
	const tsSgMonth = `${year}-${month}`; // YYYY-MM
  
	return {
	  tsUtc: nowUtc.toISOString(),
	  tsSgDate,
	  tsSgMonth,
	  year: Number(year),
	  month: Number(month),
	};
  }
  
  /**
   * For API: convert arbitrary YYYY-MM-DD string into normalized SG date string.
   */
  function normalizeSgDateString(dateStr: string): string | null {
	// Very simple validation: must be YYYY-MM-DD
	if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
	return dateStr;
  }
  
  /**
   * Count weekdays/weekends in a given month (local calendar).
   */
  function countWeekdaysWeekends(year: number, month: number): {
	weekdays: number;
	weekends: number;
  } {
	const daysInMonth = new Date(year, month, 0).getDate(); // JS month is 1-based here
	let weekdays = 0;
	let weekends = 0;
  
	for (let day = 1; day <= daysInMonth; day++) {
	  const d = new Date(Date.UTC(year, month - 1, day)); // use UTC; weekday unaffected
	  const weekday = d.getUTCDay(); // 0=Sun, 6=Sat
	  if (weekday === 0 || weekday === 6) {
		weekends++;
	  } else {
		weekdays++;
	  }
	}
	return { weekdays, weekends };
  }
  
  /**
   * Get daily budget for a given date string (YYYY-MM-DD) treating it as SG date.
   */
  function dailyBudgetForSgDateString(dateStr: string): number {
	const [year, month, day] = dateStr.split("-").map(Number);
	const d = new Date(Date.UTC(year, month - 1, day));
	const weekday = d.getUTCDay(); // 0=Sun, 6=Sat
	if (weekday === 0 || weekday === 6) {
	  return WEEKEND_DAILY_BUDGET;
	}
	return WEEKDAY_DAILY_BUDGET;
  }
  
  /**
   * Monthly daily-bucket budget = weekdays * weekday_daily_budget + weekends * weekend_daily_budget
   */
  function monthlyDailyBucketBudget(year: number, month: number): number {
	const { weekdays, weekends } = countWeekdaysWeekends(year, month);
	return weekdays * WEEKDAY_DAILY_BUDGET + weekends * WEEKEND_DAILY_BUDGET;
  }
  
  // ---------- D1 Helpers ----------
  
  async function insertExpense(
	env: Env,
	userId: number,
	category: string,
	amount: number
  ): Promise<void> {
	const now = nowSgLocal();
	await env.DB.prepare(
	  `
	  INSERT INTO expenses (ts_utc, ts_sg_date, ts_sg_month, user_id, category, amount)
	  VALUES (?, ?, ?, ?, ?, ?)
	`
	)
	  .bind(now.tsUtc, now.tsSgDate, now.tsSgMonth, userId, category, amount)
	  .run();
  }
  
  async function getUserState(
	env: Env,
	userId: number
  ): Promise<{ step: string; category: string | null } | null> {
	const res = await env.DB.prepare(
	  `SELECT step, category FROM user_state WHERE user_id = ?`
	)
	  .bind(userId)
	  .first<{ step: string; category: string | null }>();
  
	return res ?? null;
  }
  
  async function setUserState(
	env: Env,
	userId: number,
	step: string,
	category: string | null
  ): Promise<void> {
	await env.DB.prepare(
	  `
	  INSERT INTO user_state (user_id, step, category)
	  VALUES (?, ?, ?)
	  ON CONFLICT(user_id) DO UPDATE SET
		step = excluded.step,
		category = excluded.category
	`
	)
	  .bind(userId, step, category)
	  .run();
  }
  
  async function clearUserState(env: Env, userId: number): Promise<void> {
	await env.DB.prepare(`DELETE FROM user_state WHERE user_id = ?`)
	  .bind(userId)
	  .run();
  }
  
  /**
   * Sum of expenses for a specific sg_date and subset of categories.
   */
  async function sumForDate(
	env: Env,
	sgDate: string,
	categories: string[]
  ): Promise<{ total: number; byCategory: Record<string, number> }> {
	if (!categories.length) return { total: 0, byCategory: {} };
  
	const placeholders = categories.map(() => "?").join(",");
	const stmt = `
	  SELECT category, SUM(amount) AS total
	  FROM expenses
	  WHERE ts_sg_date = ? AND category IN (${placeholders})
	  GROUP BY category
	`;
	const binds = [sgDate, ...categories];
	const { results } = await env.DB.prepare(stmt).bind(...binds).all();
  
	let total = 0;
	const byCategory: Record<string, number> = {};
	for (const row of results as any[]) {
	  const cat = row.category as string;
	  const amt = Number(row.total ?? 0);
	  byCategory[cat] = amt;
	  total += amt;
	}
	return { total, byCategory };
  }
  
  /**
   * Sum of expenses for a specific sg_month and subset of categories.
   */
  async function sumForMonth(
	env: Env,
	sgMonth: string,
	categories: string[]
  ): Promise<{ total: number; byCategory: Record<string, number> }> {
	if (!categories.length) return { total: 0, byCategory: {} };
  
	const placeholders = categories.map(() => "?").join(",");
	const stmt = `
	  SELECT category, SUM(amount) AS total
	  FROM expenses
	  WHERE ts_sg_month = ? AND category IN (${placeholders})
	  GROUP BY category
	`;
	const binds = [sgMonth, ...categories];
	const { results } = await env.DB.prepare(stmt).bind(...binds).all();
  
	let total = 0;
	const byCategory: Record<string, number> = {};
	for (const row of results as any[]) {
	  const cat = row.category as string;
	  const amt = Number(row.total ?? 0);
	  byCategory[cat] = amt;
	}
  
	const grandTotal = Object.values(byCategory).reduce((a, b) => a + b, 0);
	return { total: grandTotal, byCategory };
  }
  
  // ---------- Telegram helpers ----------
  
  async function telegramApi(
	env: Env,
	method: string,
	payload: Record<string, unknown>
  ) {
	const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
	const resp = await fetch(url, {
	  method: "POST",
	  headers: { "Content-Type": "application/json" },
	  body: JSON.stringify(payload),
	});
	if (!resp.ok) {
	  console.error("Telegram API error:", resp.status, await resp.text());
	}
  }
  
  async function sendMessage(
	env: Env,
	chatId: number,
	text: string,
	replyMarkup?: Record<string, unknown>
  ) {
	const payload: Record<string, unknown> = {
	  chat_id: chatId,
	  text,
	  parse_mode: "Markdown",
	};
	if (replyMarkup) {
	  payload.reply_markup = replyMarkup;
	}
	await telegramApi(env, "sendMessage", payload);
  }
  
  function buildCategoryKeyboard(): Record<string, unknown> {
	const names = Object.keys(CATEGORIES);
	const rows: string[][] = [];
	let row: string[] = [];
	for (const name of names) {
	  row.push(name);
	  if (row.length === 3) {
		rows.push(row);
		row = [];
	  }
	}
	if (row.length) rows.push(row);
  
	return {
	  keyboard: rows,
	  resize_keyboard: true,
	  one_time_keyboard: true,
	};
  }
  
  // ---------- Telegram update handler ----------
  
  async function handleTelegramUpdate(env: Env, update: any) {
	const message = update.message ?? update.edited_message;
	if (!message) return;
  
	const from = message.from ?? {};
	const chat = message.chat ?? {};
	const userId = from.id as number | undefined;
	const chatId = chat.id as number | undefined;
	const textRaw = (message.text as string | undefined) ?? "";
  
	if (!userId || !chatId) return;
  
	// Whitelist check
	const allowed = parseAllowedUserIds(env);
	if (!allowed.has(userId)) {
	  // silently ignore
	  return;
	}
  
	const text = textRaw.trim();
  
	// Commands
	if (text.startsWith("/")) {
	  await clearUserState(env, userId);
  
	  const cmd = text.split(/\s+/)[0];
	  if (cmd === "/start") {
		await handleStart(env, chatId);
	  } else if (cmd === "/add") {
		await handleAdd(env, chatId, userId);
	  } else if (cmd === "/today") {
		await handleToday(env, chatId);
	  } else if (cmd === "/month") {
		await handleMonth(env, chatId);
	  } else {
		await sendMessage(
		  env,
		  chatId,
		  "Unknown command. Available commands: /add, /today, /month"
		);
	  }
	  return;
	}
  
	// Conversation state
	const state = await getUserState(env, userId);
  
	if (state?.step === "choose_category") {
	  if (text in CATEGORIES) {
		await setUserState(env, userId, "await_amount", text);
		await sendMessage(
		  env,
		  chatId,
		  `You chose *${text}*.\n\nPlease enter the amount (e.g. \`12.50\` or \`-5\` for refund).`
		);
	  } else {
		await sendMessage(
		  env,
		  chatId,
		  "Please tap one of the category buttons:",
		  buildCategoryKeyboard()
		);
	  }
	  return;
	}
  
	if (state?.step === "await_amount" && state.category) {
	  const cat = state.category;
	  const amount = Number(text);
	  if (!Number.isFinite(amount)) {
		await sendMessage(
		  env,
		  chatId,
		  "Please enter a valid number (e.g. `12.50` or `-5`)."
		);
		return;
	  }
  
	  // Insert expense; negative numbers allowed
	  await insertExpense(env, userId, cat, amount);
	  await clearUserState(env, userId);
	  await sendMessage(
		env,
		chatId,
		`Recorded *${amount.toFixed(2)}* in category *${cat}*.\nUse /today or /month to see your spending.`
	  );
	  return;
	}
  
	// No state & no command: hint usage
	await sendMessage(
	  env,
	  chatId,
	  "Use /add to record an expense, /today for today's summary, or /month for this month's summary."
	);
  }
  
  // ---------- Telegram command handlers ----------
  
  async function handleStart(env: Env, chatId: number) {
	await sendMessage(
	  env,
	  chatId,
	  [
		"Hi! I'm your expense tracker bot.",
		"",
		"*Commands:*",
		"• /add – Add a new expense",
		"• /today – See today's spending vs daily budget",
		"• /month – See this month's spending vs budget",
		"",
		"Daily budgets use *Singapore time* and have different limits",
		"for weekdays and weekends. The *Other* category has no budget cap.",
	  ].join("\n"),
	  buildCategoryKeyboard()
	);
  }
  
  async function handleAdd(env: Env, chatId: number, userId: number) {
	await setUserState(env, userId, "choose_category", null);
	await sendMessage(env, chatId, "Choose a category:", buildCategoryKeyboard());
  }
  
  async function handleToday(env: Env, chatId: number) {
	const now = nowSgLocal();
	const sgDate = now.tsSgDate;
	const budget = dailyBudgetForSgDateString(sgDate);
	const { total: spent, byCategory } = await sumForDate(
	  env,
	  sgDate,
	  DAILY_CATEGORIES
	);
	const remaining = budget - spent;
  
	const breakdownLines: string[] = [];
	for (const cat of DAILY_CATEGORIES) {
	  if (byCategory[cat] !== undefined) {
		breakdownLines.push(`- ${cat}: ${byCategory[cat].toFixed(2)}`);
	  }
	}
	const breakdownText =
	  breakdownLines.length > 0 ? breakdownLines.join("\n") : "_No daily spending yet._";
  
	const msg = [
	  "*Today's Daily Budget (SG time)*",
	  `Date: \`${sgDate}\``,
	  "",
	  `Budget: ${budget.toFixed(2)}`,
	  `Spent (daily categories): ${spent.toFixed(2)}`,
	  `Remaining: ${remaining.toFixed(2)}`,
	  "",
	  "*Breakdown (daily categories):*",
	  breakdownText,
	].join("\n");
  
	await sendMessage(env, chatId, msg);
  }
  
  async function handleMonth(env: Env, chatId: number) {
	const now = nowSgLocal();
	await sendMonthSummary(env, chatId, now.year, now.month);
  }
  
  async function sendMonthSummary(
	env: Env,
	chatId: number,
	year: number,
	month: number
  ) {
	const sgMonth = `${year}-${String(month).padStart(2, "0")}`;
  
	const monthlyDaily = monthlyDailyBucketBudget(year, month);
	const { total: spentDaily } = await sumForMonth(
	  env,
	  sgMonth,
	  DAILY_CATEGORIES
	);
	const { total: spentMonthly, byCategory: byCatMonthly } = await sumForMonth(
	  env,
	  sgMonth,
	  MONTHLY_CATEGORIES
	);
	const { total: spentOther } = await sumForMonth(
	  env,
	  sgMonth,
	  OTHER_CATEGORIES
	);
  
	const fixedBudgetTotal = Object.values(MONTHLY_CATEGORY_BUDGETS).reduce(
	  (a, b) => a + b,
	  0
	);
	const totalBudgetTracked = monthlyDaily + fixedBudgetTotal;
	const totalSpentTracked = spentDaily + spentMonthly;
	const remainingTracked = totalBudgetTracked - totalSpentTracked;
  
	const { weekdays, weekends } = countWeekdaysWeekends(year, month);
  
	const linesMonthly: string[] = [];
	for (const cat of MONTHLY_CATEGORIES) {
	  const amt = byCatMonthly[cat] ?? 0;
	  const budget = MONTHLY_CATEGORY_BUDGETS[cat] ?? 0;
	  if (budget > 0) {
		linesMonthly.push(`- ${cat}: ${amt.toFixed(2)} / ${budget.toFixed(2)}`);
	  } else {
		linesMonthly.push(`- ${cat}: ${amt.toFixed(2)}`);
	  }
	}
	const breakdownMonthly =
	  linesMonthly.length > 0
		? linesMonthly.join("\n")
		: "_No fixed-monthly-category spending yet._";
  
	const msg = [
	  "*Monthly Summary (SG time)*",
	  `Period: \`${year}-${String(month).padStart(2, "0")}\``,
	  "",
	  "*Daily bucket:*",
	  `- Weekdays: ${weekdays} × ${WEEKDAY_DAILY_BUDGET.toFixed(2)}`,
	  `- Weekends: ${weekends} × ${WEEKEND_DAILY_BUDGET.toFixed(2)}`,
	  `  → Monthly daily budget: ${monthlyDaily.toFixed(2)}`,
	  `  → Spent (daily categories): ${spentDaily.toFixed(2)}`,
	  "",
	  "*Fixed monthly categories:*",
	  `- Total fixed monthly budget: ${fixedBudgetTotal.toFixed(2)}`,
	  `- Spent (fixed monthly categories): ${spentMonthly.toFixed(2)}`,
	  breakdownMonthly,
	  "",
	  "*Other (uncapped):*",
	  `- Spent in Other-type categories: ${spentOther.toFixed(2)}`,
	  "",
	  "*Overall (tracked vs capped budget):*",
	  `- Total budget (daily + fixed monthly): ${totalBudgetTracked.toFixed(
		2
	  )}`,
	  `- Total spent (daily + fixed monthly): ${totalSpentTracked.toFixed(2)}`,
	  `- Remaining (tracked budget): ${remainingTracked.toFixed(2)}`,
	].join("\n");
  
	await sendMessage(env, chatId, msg);
  }
  
  // ---------- HTTP API handlers ----------
  
  function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
	  status,
	  headers: { "Content-Type": "application/json" },
	});
  }
  
  // GET /api/summary/daily?date=YYYY-MM-DD
  async function apiDailySummary(env: Env, url: URL): Promise<Response> {
	const dateStr = url.searchParams.get("date");
	let sgDate: string;
	if (dateStr) {
	  const norm = normalizeSgDateString(dateStr);
	  if (!norm) {
		return jsonResponse(
		  { error: "Invalid date format, use YYYY-MM-DD" },
		  400
		);
	  }
	  sgDate = norm;
	} else {
	  sgDate = nowSgLocal().tsSgDate;
	}
  
	const budget = dailyBudgetForSgDateString(sgDate);
	const { total: spent, byCategory } = await sumForDate(
	  env,
	  sgDate,
	  DAILY_CATEGORIES
	);
	const remaining = budget - spent;
  
	return jsonResponse({
	  date: sgDate,
	  timezone: SG_TIMEZONE,
	  budget_daily: budget,
	  spent_daily: spent,
	  remaining_daily: remaining,
	  by_category: byCategory,
	});
  }
  
  // GET /api/summary/monthly?year=YYYY&month=MM
  async function apiMonthlySummary(env: Env, url: URL): Promise<Response> {
	const now = nowSgLocal();
	const year = Number(url.searchParams.get("year") ?? now.year);
	const month = Number(url.searchParams.get("month") ?? now.month);
	if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
	  return jsonResponse({ error: "Invalid year or month" }, 400);
	}
	const sgMonth = `${year}-${String(month).padStart(2, "0")}`;
  
	const monthlyDaily = monthlyDailyBucketBudget(year, month);
	const { total: spentDaily, byCategory: byCatDaily } = await sumForMonth(
	  env,
	  sgMonth,
	  DAILY_CATEGORIES
	);
	const { total: spentMonthly, byCategory: byCatMonthly } = await sumForMonth(
	  env,
	  sgMonth,
	  MONTHLY_CATEGORIES
	);
	const { total: spentOther, byCategory: byCatOther } = await sumForMonth(
	  env,
	  sgMonth,
	  OTHER_CATEGORIES
	);
  
	const fixedBudgetTotal = Object.values(MONTHLY_CATEGORY_BUDGETS).reduce(
	  (a, b) => a + b,
	  0
	);
	const totalBudgetTracked = monthlyDaily + fixedBudgetTotal;
	const totalSpentTracked = spentDaily + spentMonthly;
	const remainingTracked = totalBudgetTracked - totalSpentTracked;
  
	const { weekdays, weekends } = countWeekdaysWeekends(year, month);
  
	return jsonResponse({
	  year,
	  month,
	  timezone: SG_TIMEZONE,
	  weekdays,
	  weekends,
	  weekday_daily_budget: WEEKDAY_DAILY_BUDGET,
	  weekend_daily_budget: WEEKEND_DAILY_BUDGET,
	  monthly_daily_budget: monthlyDaily,
	  fixed_monthly_budgets: MONTHLY_CATEGORY_BUDGETS,
	  spent_daily: spentDaily,
	  spent_daily_by_category: byCatDaily,
	  spent_monthly: spentMonthly,
	  spent_monthly_by_category: byCatMonthly,
	  spent_other: spentOther,
	  spent_other_by_category: byCatOther,
	  total_budget_tracked: totalBudgetTracked,
	  total_spent_tracked: totalSpentTracked,
	  remaining_tracked: remainingTracked,
	});
  }
  
  // ---------- Worker entrypoint ----------
  
  export default {
	async fetch(request: Request, env: Env): Promise<Response> {
	  const url = new URL(request.url);
  
	  // Telegram webhook: POST /telegram-webhook/<secret>
	  if (
		request.method === "POST" &&
		url.pathname === `/telegram-webhook/${env.TELEGRAM_WEBHOOK_SECRET}`
	  ) {
		const headerToken = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
		if (headerToken !== env.TELEGRAM_HEADER_SECRET) {
		return new Response("Unauthorized", { status: 401 });
		}
		const update = await request.json();
		await handleTelegramUpdate(env, update);
		return jsonResponse({ ok: true });
	  }
  
	  // HTTP APIs
	  if (request.method === "GET" && url.pathname === "/api/summary/daily") {
		return apiDailySummary(env, url);
	  }
	  if (request.method === "GET" && url.pathname === "/api/summary/monthly") {
		return apiMonthlySummary(env, url);
	  }
  
	  if (request.method === "GET" && url.pathname === "/healthz") {
		return jsonResponse({ status: "ok" });
	  }
  
	  return new Response("Not found", { status: 404 });
	},
  };
  