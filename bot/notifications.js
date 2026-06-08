/**
 * Telegram notifications — no-op if TELEGRAM_BOT_TOKEN is not set.
 * Also writes a row to public.notifications so the dashboard can audit.
 */
import { sb } from "./supabase.js";
import { log } from "./logger.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT = process.env.TELEGRAM_CHAT_ID || "7168775421";

export async function notify({ kind, title, body, payload = {}, chatId }) {
  const target = chatId || DEFAULT_CHAT;
  const text = `*${title ?? kind}*\n${body ?? ""}`.trim();

  let status = "pending";
  let error = null;

  if (!TOKEN) {
    status = "skipped";
    error = "TELEGRAM_BOT_TOKEN not set";
  } else if (!target) {
    status = "skipped";
    error = "no chat_id configured";
  } else {
    try {
      const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: target, text, parse_mode: "Markdown" }),
      });
      if (!res.ok) {
        status = "failed";
        error = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
      } else {
        status = "sent";
      }
    } catch (e) {
      status = "failed";
      error = e.message;
    }
  }

  try {
    await sb.from("notifications").insert({
      channel: "telegram",
      kind,
      title: title ?? kind,
      body: body ?? null,
      payload,
      status,
      error,
      sent_at: status === "sent" ? new Date().toISOString() : null,
    });
  } catch (e) {
    log.warn("[notify] failed to log notification", { error: e.message });
  }
}