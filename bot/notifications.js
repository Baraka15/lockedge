/**
 * TELEGRAM NOTIFICATIONS
 * Real-time alerts for placements, errors, daily reports
 */

import { log } from "./logger.js";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

let lastNotificationTime = 0;
const NOTIFICATION_DEBOUNCE_MS = 500; // Min 500ms between notifications

/**
 * Send Telegram message
 */
async function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    log.warn("[Telegram] Not configured");
    return false;
  }

  try {
    // Debounce rapid notifications
    const now = Date.now();
    if (now - lastNotificationTime < NOTIFICATION_DEBOUNCE_MS) {
      return true; // Skip
    }
    lastNotificationTime = now;

    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "Markdown",
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return true;
  } catch (e) {
    log.error("[Telegram] Send failed", { error: e.message });
    return false;
  }
}

/**
 * NOTIFY interface
 * Formats and sends notifications based on kind
 */
export async function notify({ kind, title, body }) {
  let message = "";

  switch (kind) {
    case "startup":
      message = `🤖 *${title}*\n${body}`;
      break;
    case "status":
      message = `📊 *${title}*\n${body}`;
      break;
    case "arb_placed":
      message = `✅ *${title}*\n${body}`;
      break;
    case "odds_drift":
      message = `⚠️ *${title}*\n${body}`;
      break;
    case "rescue_hedge":
      message = `🛡️ *${title}*\n${body}`;
      break;
    case "auto_pause":
      message = `⛔ *${title}*\n${body}`;
      break;
    case "daily_report":
      message = `📈 *${title}*\n${body}`;
      break;
    case "error":
      message = `❌ *${title}*\n${body}`;
      break;
    default:
      message = `${title}\n${body}`;
  }

  return await sendTelegram(message);
}

/**
 * Send formatted daily report
 */
export async function sendDailyReport(performance) {
  const report = [
    "📅 *Daily Performance Report*",
    "",
    `Start: ${performance.startBankroll.toLocaleString()} UGX`,
    `Current: ${performance.currentBankroll.toLocaleString()} UGX`,
    `Gain: +${performance.dailyGain.toLocaleString()} UGX (${performance.dailyGainPct}%)`,
    `Target: ${performance.targetAmount.toLocaleString()} UGX (${performance.targetGrowthPct}%)`,
    `Status: ${performance.status}`,
  ].join("\n");

  return await sendTelegram(report);
}

export default { notify, sendDailyReport };