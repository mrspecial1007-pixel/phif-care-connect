import { Link, useLocation } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Pill, LayoutDashboard, Upload, LogOut, Users } from "lucide-react";
import { lockPharmacy } from "@/lib/auth.functions";
import { useSession } from "@/lib/queries";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const lock = useServerFn(lockPharmacy);
  const loc = useLocation();

  async function onLock() {
    await lock();
    await qc.invalidateQueries({ queryKey: ["session"] });
  }

  const nav = [
    { to: "/", label: "الرئيسية", icon: LayoutDashboard },
    { to: "/patients", label: "المرضى", icon: Users },
    { to: "/import", label: "استيراد", icon: Upload },
  ] as const;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <header className="sticky top-0 z-30 border-b bg-card/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Pill className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm leading-tight">PHIF Tracker</div>
            <div className="text-xs text-muted-foreground truncate">
              {session?.unlocked ? session.pharmacy.name : ""}
            </div>
          </div>
          <nav className="hidden md:flex gap-1">
            {nav.map((n) => {
              const active = loc.pathname === n.to || (n.to !== "/" && loc.pathname.startsWith(n.to));
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={`px-3 py-2 rounded-md text-sm font-medium ${
                    active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <Button variant="ghost" size="sm" onClick={onLock} title="إغلاق الجلسة">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-4">{children}</main>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t bg-card">
        <div className="grid grid-cols-3">
          {nav.map((n) => {
            const Icon = n.icon;
            const active = loc.pathname === n.to || (n.to !== "/" && loc.pathname.startsWith(n.to));
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex flex-col items-center py-2 text-xs ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-5 w-5 mb-1" />
                {n.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export function Gate({ children }: { children: ReactNode }) {
  const { data, isLoading } = useSession();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        جاري التحميل…
      </div>
    );
  }
  if (!data?.unlocked) {
    // Lazy import to keep bundle small
    const { UnlockScreen } = require("./UnlockScreen") as typeof import("./UnlockScreen");
    return <UnlockScreen />;
  }
  return <AppShell>{children}</AppShell>;
}