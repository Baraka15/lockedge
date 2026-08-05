import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { isPinEnabled, removePin, setPin } from "@/lib/pin-lock";

export function PinSettingsCard() {
  const [enabled, setEnabled] = useState(false);
  const [pin, setPinValue] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => setEnabled(isPinEnabled()), []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.trim().length < 4) {
      toast.error("PIN must be at least 4 digits.");
      return;
    }
    if (pin.trim() !== confirm.trim()) {
      toast.error("PINs don't match.");
      return;
    }
    await setPin(pin);
    setPinValue("");
    setConfirm("");
    setEnabled(true);
    toast.success("Quick-unlock PIN saved on this device.");
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Quick-unlock PIN</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {enabled
          ? "PIN unlock is on for this device. It's a shortcut over your signed-in session — email and password still work as usual."
          : "Set a PIN to reopen the dashboard fast on this device without retyping your password."}
      </p>
      <form onSubmit={save} className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="new-pin" className="text-xs">
            {enabled ? "New PIN" : "PIN"}
          </Label>
          <Input
            id="new-pin"
            inputMode="numeric"
            autoComplete="off"
            type="password"
            value={pin}
            onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-pin" className="text-xs">
            Confirm PIN
          </Label>
          <Input
            id="confirm-pin"
            inputMode="numeric"
            autoComplete="off"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" size="sm">
            Save PIN
          </Button>
          {enabled && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                removePin();
                setEnabled(false);
                toast.success("PIN unlock turned off on this device.");
              }}
            >
              Turn off PIN
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}