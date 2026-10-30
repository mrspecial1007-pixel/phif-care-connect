import { createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type MouseEvent, type ComponentPropsWithoutRef } from "react";
import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { useSession } from "@/lib/queries";
import { todayISOLocal } from "@/lib/date";
import { canReturnToDashboard, dashboardScope, readDashboardView, saveDashboardView, type DashboardView } from "@/lib/dashboard-navigation.helpers";
import { ArrowRight } from "lucide-react";

function tabStorage() { try { return window.sessionStorage; } catch { return undefined; } }
type Visit = {
  view: DashboardView; update: (change: (previous: DashboardView) => DashboardView) => void;
  recordListPosition: (mode: "listScrollTop" | "detailScrollTop", top: number) => void;
  restoreWindow: () => void; flush: () => void; scope: string; entry: string; index: number;
};
const DashboardVisit = createContext<Visit | null>(null);
export const useDashboardVisit = () => useContext(DashboardVisit)!;

export function DashboardVisitProvider({ scope, entry, index, children }: { scope: string; entry: string; index: number; children: ReactNode }) {
  const [view, setView] = useState(() => readDashboardView(scope, entry, todayISOLocal(), tabStorage()));
  const latest = useRef(view), leaving = useRef(false), restored = useRef(false), restoring = useRef(true), alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const persist = useCallback(() => saveDashboardView(scope, entry, latest.current, tabStorage()), [scope, entry]);
  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(persist, 120);
  }, [persist]);
  const update = useCallback((change: (previous: DashboardView) => DashboardView) => {
    if (leaving.current) return;
    const previous = latest.current, next = change(previous);
    if (!previous.preparationList.open && next.preparationList.open) next.scrollY = window.scrollY;
    latest.current = next; setView(latest.current); persist();
  }, [persist]);
  const recordListPosition = useCallback((mode: "listScrollTop" | "detailScrollTop", top: number) => {
    if (leaving.current) return;
    latest.current = { ...latest.current, preparationList: { ...latest.current.preparationList, [mode]: top } }; schedule();
  }, [schedule]);
  useEffect(() => {
    alive.current = true;
    const record = () => {
      if (leaving.current || restoring.current || latest.current.preparationList.open || window.location.pathname !== "/") return;
      latest.current = { ...latest.current, scrollY: window.scrollY }; schedule();
    };
    window.addEventListener("scroll", record, { passive: true });
    window.addEventListener("pagehide", persist);
    return () => { alive.current = false; window.removeEventListener("scroll", record); window.removeEventListener("pagehide", persist); clearTimeout(timer.current); persist(); };
  }, [persist, schedule]);
  const restoreWindow = useCallback(() => {
    if (restored.current) return;
    restored.current = true;
    const top = latest.current.scrollY;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (alive.current && !leaving.current) window.scrollTo({ top, behavior: "instant" });
      restoring.current = false;
    }));
  }, []);
  const flush = useCallback(() => {
    if (!latest.current.preparationList.open) latest.current = { ...latest.current, scrollY: window.scrollY };
    clearTimeout(timer.current); persist(); leaving.current = true;
  }, [persist]);
  return <DashboardVisit.Provider value={{ view, update, recordListPosition, restoreWindow, flush, scope, entry, index }}>{children}</DashboardVisit.Provider>;
}

const ordinaryClick = (event: MouseEvent<HTMLAnchorElement>) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.defaultPrevented
  && (!event.currentTarget.target || event.currentTarget.target === "_self");
export const PatientProfileLink = forwardRef<HTMLAnchorElement, Omit<ComponentPropsWithoutRef<"a">, "href"> & { patientId: string }>(function PatientProfileLink({ patientId, children, onClick, ...props }, ref) {
  const visit = useContext(DashboardVisit);
  return <Link {...props} ref={ref} to="/patients/$id" params={{ id: patientId }}
    state={visit ? () => ({ dashboardOrigin: { scope: visit.scope, entry: visit.entry, index: visit.index, patientId } }) : undefined}
    onClick={event => { onClick?.(event); if (visit && ordinaryClick(event)) visit.flush(); }}>{children}</Link>;
});

export function PatientDashboardBackLink({ patientId }: { patientId: string }) {
  const router = useRouter(), location = useLocation(), { data: session } = useSession();
  const state = location.state as any;
  return <Link to="/" className="text-sm text-muted-foreground inline-flex items-center gap-1" onClick={event => {
    if (ordinaryClick(event) && canReturnToDashboard(state.dashboardOrigin, dashboardScope(session), patientId, state.__TSR_index)) {
      event.preventDefault(); router.history.back();
    }
  }}><ArrowRight className="h-4 w-4 rotate-180" /> عودة</Link>;
}
