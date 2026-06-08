/**
 * Server-side notification service. Telegram via raw Bot API.
 * No-op silently if TELEGRAM_BOT_TOKEN is not set.
 * Always writes a row to public.notifications for the audit trail.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DEFAULT_CHAT_ID = "7168775421";

export interface NotifyInput {
  kind: string;
  title?: string;
  body?: string;
  payload?: Record<string, unknown>;
  chatId?: string;
}

export async function notify({ kind, title, body, payload = {}, chatId }: NotifyInput) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const target = chatId || process.env.TELEGRAM_CHAT_ID || DEFAULT_CHAT_ID;
  const text = `*${title ?? kind}*\n${body ?? ""}`.trim();

  let status: "sent" | "failed" | "skipped" = "skipped";
  let error: string | null = null;

  if (!token) {
    error = "TELEGRAM_BOT_TOKEN not set";
  } else {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
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
      error = e instanceof Error ? e.message : String(e);
    }
  }

  try {
    await supabaseAdmin.from("notifications").insert({
      channel: "telegram",
      kind,
      title: title ?? kind,
      body: body ?? null,
      payload: payload as never,
      status,
      error,
      sent_at: status === "sent" ? new Date().toISOString() : null,
    });
  } catch (e) {
    console.error("[notify] audit log failed", e);
  }
}