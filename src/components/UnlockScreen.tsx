import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { unlockPharmacy } from "@/lib/auth.functions";
import { usePharmacies } from "@/lib/queries";
import { Pill, Lock } from "lucide-react";

export function UnlockScreen() {
  const { data: pharmacies, isLoading } = usePharmacies();
  const [pharmacyId, setPharmacyId] = useState<string>("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const unlock = useServerFn(unlockPharmacy);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const selected = pharmacyId || pharmacies?.[0]?.id;
    if (!selected) return;
    setBusy(true);
    try {
      const res = await unlock({ data: { pharmacy_id: selected, pin } });
      if (!res.ok) {
        if (res.error === "invalid_pin") toast.error("رمز PIN غير صحيح");
        else if (res.error === "too_many_attempts") toast.error("محاولات كثيرة، انتظر دقيقة");
        else toast.error("تعذر الدخول");
      } else {
        toast.success(`مرحباً في ${res.pharmacy.name}`);
        await qc.invalidateQueries({ queryKey: ["session"] });
      }
    } finally {
      setBusy(false);
      setPin("");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-accent/40 via-background to-secondary p-4">
      <Card className="w-full max-w-sm p-6 space-y-5 shadow-lg">
        <div className="text-center space-y-2">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
            <Pill className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold">PHIF Tracker</h1>
          <p className="text-sm text-muted-foreground">إدارة صرف التأمين الصحي</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>اختر الصيدلية</Label>
            <div className="grid gap-2">
              {isLoading && <div className="text-sm text-muted-foreground">جاري التحميل…</div>}
              {pharmacies?.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPharmacyId(p.id)}
                  className={`text-right rounded-lg border p-3 transition ${
                    (pharmacyId || pharmacies[0]?.id) === p.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <div className="font-medium">{p.name}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pin">رمز PIN</Label>
            <Input
              id="pin"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••"
              className="text-center text-lg tracking-widest"
              maxLength={20}
              required
            />
          </div>

          <Button type="submit" className="w-full h-12 text-base" disabled={busy || !pin}>
            <Lock className="h-4 w-4 ml-2" />
            {busy ? "جاري التحقق…" : "دخول"}
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            رمز البداية الافتراضي: <span className="font-mono">1234</span>
          </p>
        </form>
      </Card>
    </div>
  );
}