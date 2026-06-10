import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const ACCESS_PIN = "8267"; // change this to your preferred PIN

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Enter PIN — Sure Bets" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    if (pin.trim() === ACCESS_PIN) {
      localStorage.setItem("pin_authed", "1");
      toast.success("Access granted");
      navigate({ to: "/dashboard", replace: true });
    } else {
      toast.error("Wrong PIN");
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-card p-6 shadow-sm"
      >
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Enter PIN</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Quick access to your arb dashboard. Default PIN:{" "}
            <span className="font-mono font-semibold text-foreground">{ACCESS_PIN}</span>
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pin">PIN</Label>
          <Input
            id="pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoFocus
            required
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Checking..." : "Unlock"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          <Link to="/signup" className="underline-offset-4 hover:underline">Use email sign-up instead</Link>
        </p>
      </form>
    </div>
  );
}