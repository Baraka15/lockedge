import { createFileRoute } from "@tanstack/react-router";
import { notify } from "@/lib/notifications.server";

export const Route = createFileRoute("/api/public/hooks/notify-test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { chat_id?: string } = {};
        try { body = await request.json(); } catch {}
        if (!body.chat_id) {
          return Response.json({ ok: false, error: "chat_id required" }, { status: 400 });
        }
        await notify({
          kind: "test",
          title: "Setup test ✅",
          body: "Your Telegram chat is wired up correctly.",
          chatId: body.chat_id,
        });
        return Response.json({ ok: true });
      },
    },
  },
});