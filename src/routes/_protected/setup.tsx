import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bot, Check, MessageCircle, Send, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { describeNetworkError } from "@/lib/net";

export const Route = createFileRoute("/_protected/setup")({
  head: () => ({
    meta: [
      { title: "Telegram alert setup — LockEdge" },
      { name: "description", content: "Connect your own Telegram bot to receive sure-bet alerts in real time." },
      { property: "og:title", content: "Telegram alert setup — LockEdge" },
      { property: "og:description", content: "Connect your own Telegram bot to receive sure-bet alerts in real time." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SetupPage,
});

const sb = supabase as unknown as { from: (t: string) => any };

function SetupPage() {
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [minEdge, setMinEdge] = useState(1);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);

  useEffect(() => {
    sb.from("user_alert_settings").select("*").maybeSingle().then(({ data }: any) => {
      if (!data) return;
      setHasSaved(true);
      setToken(data.telegram_bot_token ?? "");
      setChatId(data.telegram_chat_id ?? "");
      setMinEdge(Number(data.min_edge_pct ?? 1));
      setEnabled(!!data.enabled);
    });
  }, []);

  const save = async () => {
    if (!/^\d+:[\w-]{30,}$/.test(token.trim())) { toast.error("That doesn't look like a bot token from @BotFather."); return; }
    if (!/^-?\d+$/.test(chatId.trim())) { toast.error("Chat id must be a number."); return; }
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await sb.from("user_alert_settings").upsert({
      user_id: u.user?.id,
      telegram_bot_token: token.trim(),
      telegram_chat_id: chatId.trim(),
      min_edge_pct: minEdge,
      enabled,
      setup_completed_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    setSaving(false);
    if (error) { toast.error(`Save failed: ${error.message}`); return; }
    setHasSaved(true);
    toast.success("Saved — you'll receive sure-bet alerts on Telegram.");
  };

  const test = async () => {
    setTesting(true);
    try {
      const res = await fetch(`https://api.telegram.org/bot${token.trim()}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId.trim(), text: "✅ LockEdge alerts are connected. Sure bets will arrive here in real time." }),
      });
      const j = await res.json();
      if (j.ok) toast.success("Test message sent — check Telegram.");
      else toast.error(j.description || "Telegram rejected the message. Did you press Start in your bot?");
    } catch (e) { toast.error(describeNetworkError(e)); }
    setTesting(false);
  };

  const steps = [
    { icon: Bot, title: "Create your bot", body: <>Open Telegram, search <b>@BotFather</b>, send <code>/newbot</code>, pick a name. Copy the token it gives you (looks like <code>123456:ABC…</code>).</> },
    { icon: MessageCircle, title: "Start your bot", body: <>Open your new bot and press <b>Start</b> (or send any message). Bots can only message people who started them.</> },
    { icon: Shield, title: "Find your chat id", body: <>Message <b>@userinfobot</b> — it replies with your numeric id. For a group, add your bot to the group and use the group id (starts with <code>-</code>).</> },
    { icon: Send, title: "Paste & test", body: <>Fill the form below, press <b>Send test</b>, then <b>Save</b>.</> },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Set up your real-time alerts</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every true sure bet the scanner finds is sent to your own Telegram bot within seconds. Placement is always manual.</p>
      </div>

      <ol className="grid gap-3 sm:grid-cols-2">
        {steps.map((s, i) => (
          <li key={i} className="rounded-lg border border-border bg-card p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
              <s.icon className="h-4 w-4 text-primary" /> {i + 1}. {s.title}
            </div>
            <p className="text-xs text-muted-foreground">{s.body}</p>
          </li>
        ))}
      </ol>

      <div className="space-y-4 rounded-lg border border-border bg-card p-5">
        <div className="space-y-1">
          <Label htmlFor="tok">Bot token</Label>
          <Input id="tok" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456789:AA…" autoComplete="off" />
          <p className="text-[11px] text-muted-foreground">Stored privately on your account — only you and the alert sender can read it.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="chat">Chat id</Label>
          <Input id="chat" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="e.g. 7168775421" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="edge">Minimum profit to alert (%)</Label>
          <Input id="edge" type="number" step="0.1" min={0} value={minEdge} onChange={(e) => setMinEdge(Number(e.target.value))} />
        </div>
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={enabled} onCheckedChange={setEnabled} /> Send alerts
        </label>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={test} disabled={testing || !token || !chatId}>{testing ? "Sending…" : "Send test"}</Button>
          <Button onClick={save} disabled={saving}><Check className="mr-1 h-4 w-4" />{saving ? "Saving…" : "Save"}</Button>
          {hasSaved && <Button variant="ghost" onClick={() => navigate({ to: "/dashboard" })}>Go to dashboard</Button>}
        </div>
      </div>
      {!hasSaved && (
        <p className="text-center text-xs text-muted-foreground">
          <Link to="/dashboard" className="underline">Skip for now</Link>
        </p>
      )}
    </div>
  );
}
