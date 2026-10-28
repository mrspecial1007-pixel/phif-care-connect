import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { confirmPhifTrackerIdentity } from "@/lib/phif-tracker-user.functions";
import type { PhifTrackerAccess } from "@/lib/phif-tracker-user.server";

export function PhifTrackerIdentityNotice({ access }: { access?: PhifTrackerAccess }) {
  const [open, setOpen] = useState(false), [identifier, setIdentifier] = useState(""), [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const confirm = useServerFn(confirmPhifTrackerIdentity), qc = useQueryClient();
  if (!access || access.ready) return null;
  return <div className="space-y-2 border-y border-amber-200 py-2 text-xs text-amber-950" dir="rtl">
    <p>{access.message}</p>
    {access.reason === "identity_required" && <Button variant="outline" size="sm" onClick={() => setOpen(true)}><ShieldCheck className="size-4" />توثيق مستخدم Tracker</Button>}
    <Dialog open={open} onOpenChange={value => { if (!busy) { setOpen(value); setPin(""); setError(null); } }}>
      <DialogContent className="max-w-sm" dir="rtl"><DialogHeader><DialogTitle>توثيق مستخدم Tracker</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={async event => {
          event.preventDefault(); if (busy) return; setBusy(true); setError(null);
          try {
            await confirm({ data: { identifier, pin } }); setPin("");
            await qc.invalidateQueries({ queryKey: ["session"] });
            for (const key of ["phif_orders_access", "phif_stock_summary", "phif_session_status"])
              void qc.invalidateQueries({ queryKey: [key] });
            setOpen(false);
          } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر توثيق المستخدم"); }
          finally { setBusy(false); }
        }}>
          <label className="block text-sm">معرّف المستخدم<Input dir="ltr" autoComplete="username" value={identifier} onChange={event => setIdentifier(event.target.value)} disabled={busy} required /></label>
          <label className="block text-sm">PIN المستخدم<Input type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={event => setPin(event.target.value)} disabled={busy} required /></label>
          {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
          <Button type="submit" disabled={busy || !identifier.trim() || !pin} className="w-full">{busy ? "جارٍ التحقق..." : "توثيق الحساب"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}
