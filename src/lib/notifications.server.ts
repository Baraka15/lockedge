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

/**
 * Fan a sure-bet alert out to every user who connected their own Telegram bot.
 * Each user's bot token is used only to message that user's chat.
 */
export async function notifySubscribers(edgePct: number, title: string, body: string) {
  const { data, error } = await (supabaseAdmin as any)
    .from("user_alert_settings")
    .select("user_id, telegram_bot_token, telegram_chat_id, min_edge_pct")
    .eq("enabled", true)
    .not("telegram_bot_token", "is", null)
    .not("telegram_chat_id", "is", null);
  if (error) { console.error("[notify] subscribers load failed", error); return; }
  const text = `*${title}*\n${body}`.trim();
  await Promise.allSettled(
    (data ?? [])
      .filter((s: any) => edgePct >= Number(s.min_edge_pct ?? 0))
      .map(async (s: any) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        try {
          const res = await fetch(`https://api.telegram.org/bot${s.telegram_bot_token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: s.telegram_chat_id, text, parse_mode: "Markdown", disable_web_page_preview: true }),
            signal: ctrl.signal,
          });
          const ok = res.ok;
          await (supabaseAdmin as any).from("user_alert_settings").update({
            last_sent_at: ok ? new Date().toISOString() : undefined,
            last_error: ok ? null : `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
          }).eq("user_id", s.user_id);
        } catch (e) {
          console.error("[notify] subscriber send failed", s.user_id, e);
        } finally { clearTimeout(t); }
      }),
  );
}