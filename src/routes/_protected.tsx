import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isUnlocked } from "@/lib/pin-lock";
import { describeNetworkError, isNetworkFailure } from "@/lib/net";
import { supabaseConfigError } from "@/lib/supabase-config";

export const Route = createFileRoute("/_protected")({
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const [checked, setChecked] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null);

  const check = useCallback(async () => {
    setBlockedMsg(null);
    setChecked(false);

    const configError = supabaseConfigError();
    if (configError) {
      setBlockedMsg(configError);
      setChecked(true);
      return;
    }

    // Access requires a real Supabase session; data access is further gated by
    // the operator role in row-level security policies.
    if (typeof window !== "undefined") localStorage.removeItem("pin_authed");

    try {
      const { data, error } = await supabase.auth.getUser();
      // A transport failure must NOT be treated as "signed out" — that causes a
      // redirect loop back to /login with an opaque "Failed to fetch".
      if (error && isNetworkFailure(error)) {
        setBlockedMsg(describeNetworkError(error));
        setChecked(true);
        return;
      }
      // Session is the real gate; the PIN is only a device-local quick lock.
      const ok = !!data.user && isUnlocked();
      setAuthed(ok);
      setChecked(true);
      if (!ok) window.location.href = "/login";
    } catch (err) {
      console.error("[protected] auth check failed", err);
      setBlockedMsg(describeNetworkError(err));
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (blockedMsg) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-foreground">Can't verify your session</h1>
          <p role="alert" className="text-sm text-muted-foreground">
            {blockedMsg}
          </p>
          <div className="flex justify-center gap-2">
            <button
              onClick={() => void check()}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Try again
            </button>
            <a
              href="/login"
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Sign in
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }
  if (!authed) return null;
  return <Outlet />;
}
