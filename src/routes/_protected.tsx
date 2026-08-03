import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_protected")({
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const [checked, setChecked] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      // Access requires a real Supabase session; data access is further gated by
      // the operator role in row-level security policies.
      if (typeof window !== "undefined") localStorage.removeItem("pin_authed");
      const { data } = await supabase.auth.getUser();
      if (!mounted) return;
      const ok = !!data.user;
      setAuthed(ok);
      setChecked(true);
      if (!ok) window.location.href = "/login";
    })();
    return () => {
      mounted = false;
    };
  }, []);

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