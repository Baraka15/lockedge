import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { describeNetworkError } from "@/lib/net";
import { supabaseConfigError } from "@/lib/supabase-config";
import {
  MAX_PIN_ATTEMPTS,
  attemptsLeft,
  isPinEnabled,
  isUnlocked,
  lockNow,
  markUnlocked,
  verifyPin,
} from "@/lib/pin-lock";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [
    { title: "Sign in — LockEdge" },
    { name: "description", content: "Sign in securely to your LockEdge live arbitrage feed." },
    { property: "og:title", content: "Sign in — LockEdge" },
    { property: "og:description", content: "Access your live arbitrage feed and Telegram alert settings." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [mode, setMode] = useState<"password" | "pin">("password");
  const [pin, setPin] = useState("");
  const [pinLeft, setPinLeft] = useState(MAX_PIN_ATTEMPTS);
  const configError = supabaseConfigError();

  useEffect(() => {
    if (configError) {
      setErrorMsg(configError);
      return;
    }
    // Quick-unlock is only offered when a real Supabase session already exists
    // on this device; the PIN never grants access on its own.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (data.session && isPinEnabled() && !isUnlocked()) {
          setMode("pin");
          setPinLeft(attemptsLeft());
        }
      })
      .catch((err) => {
        // Offline / unreachable backend: keep the password form usable.
        console.error("[login] getSession failed", err);
      });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session && isUnlocked()) navigate({ to: "/dashboard", replace: true });
    });
    return () => subscription.unsubscribe();
  }, [navigate, configError]);

  const fail = (err: unknown) => {
    const message =
      err instanceof Error && err.message === "Invalid login credentials"
        ? "That email and password don't match. Use \"Forgot password?\" to set a new one."
        : describeNetworkError(err);
    setErrorMsg(message);
    toast.error(message);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (configError) {
      setErrorMsg(configError);
      return;
    }
    setLoading(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        fail(error);
      } else {
        markUnlocked();
        toast.success("Signed in");
        navigate({ to: "/dashboard", replace: true });
      }
    } catch (err) {
      console.error("[login] signIn failed", err);
      fail(err);
    } finally {
      setLoading(false);
    }
  };

  const onForgotPassword = async () => {
    if (!email.trim()) {
      setErrorMsg("Enter your email first, then tap \"Forgot password?\".");
      return;
    }
    setResetting(true);
    setErrorMsg(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        fail(error);
      } else {
        toast.success("Reset link sent — check your inbox.");
        setErrorMsg("Reset link sent. Check your inbox for the password reset email.");
      }
    } catch (err) {
      console.error("[login] reset failed", err);
      fail(err);
    } finally {
      setResetting(false);
    }
  };

  const onPinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (await verifyPin(pin)) {
      toast.success("Unlocked");
      navigate({ to: "/dashboard", replace: true });
      return;
    }
    const left = attemptsLeft();
    setPinLeft(left);
    setPin("");
    if (left <= 0) {
      lockNow();
      await supabase.auth.signOut();
      setMode("password");
      setErrorMsg("Too many wrong PINs. Sign in with your email and password.");
      return;
    }
    setErrorMsg(`Incorrect PIN. ${left} ${left === 1 ? "try" : "tries"} left.`);
  };

  const errorBox = errorMsg ? (
    <p
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {errorMsg}
    </p>
  ) : null;

  if (mode === "pin") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <form
          onSubmit={onPinSubmit}
          className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-card p-6 shadow-sm"
        >
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Quick unlock</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your PIN to reopen the dashboard on this device.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pin">PIN</Label>
            <Input
              id="pin"
              type="password"
              inputMode="numeric"
              autoFocus
              required
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          {errorBox}
          <Button type="submit" className="w-full" disabled={pin.length < 4}>
            Unlock
          </Button>
          <button
            type="button"
            onClick={() => {
              setMode("password");
              setErrorMsg(null);
            }}
            className="w-full text-center text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
          >
            Use email and password instead
          </button>
          <p className="text-center text-[11px] text-muted-foreground">
            {pinLeft} of {MAX_PIN_ATTEMPTS} attempts remaining
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-card p-6 shadow-sm"
      >
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Operator access only. Sign in with your email and password.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoFocus
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {errorBox}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </Button>
        <button
          type="button"
          onClick={onForgotPassword}
          disabled={resetting}
          className="w-full text-center text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
        >
          {resetting ? "Sending reset link..." : "Forgot password?"}
        </button>
        <p className="text-center text-xs text-muted-foreground">
          No account?{" "}
          <Link to="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
            Create one
          </Link>
        </p>
      </form>
    </div>
  );
}