import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { unlockPharmacy } from "@/lib/auth.functions";
import { Lock, Mail, Pill } from "lucide-react";
import { toast } from "sonner";

export function UnlockScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const unlock = useServerFn(unlockPharmacy);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await unlock({ data: { email, password, remember } });
      if (!result.ok) {
        toast.error("البريد الإلكتروني أو كلمة المرور غير صحيحة");
        return;
      }
      await qc.invalidateQueries({ queryKey: ["session"] });
    } finally {
      setBusy(false);
      setPassword("");
    }
  }

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm p-6 space-y-6 shadow-lg">
        <div className="text-center space-y-2">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
            <Pill className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold">PHIF Tracker</h1>
          <p className="text-sm text-muted-foreground">تسجيل الدخول</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">البريد الإلكتروني</Label>
            <div className="relative">
              <Mail className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-11 pr-10 text-left"
                dir="ltr"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">كلمة المرور</Label>
            <div className="relative">
              <Lock className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-11 pr-10 text-left"
                dir="ltr"
                required
              />
            </div>
          </div>

          <div className="flex items-center gap-2 py-1">
            <Checkbox
              id="remember"
              checked={remember}
              onCheckedChange={(checked) => setRemember(checked === true)}
            />
            <Label htmlFor="remember" className="cursor-pointer text-sm font-normal">
              تذكرني
            </Label>
          </div>

          <Button type="submit" className="h-11 w-full text-base" disabled={busy || !email || !password}>
            {busy ? "جار التحقق..." : "تسجيل الدخول"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
