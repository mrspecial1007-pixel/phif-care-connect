import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { currentSession } from "@/lib/auth.functions";

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: () => currentSession(),
    staleTime: 30_000,
  });
}

export function usePharmacies() {
  return useQuery({
    queryKey: ["pharmacies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pharmacies")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

export type PatientStatusRow = {
  patient_id: string;
  patient_name: string;
  insurance_card_number: string | null;
  national_id: string | null;
  phone: string | null;
  review_status: "ok" | "needs_review";
  current_cycle_id: string | null;
  current_cycle_status: "Waiting" | "Partial" | "Completed" | "Remaining" | null;
  current_cycle_started_at: string | null;
  next_due_date: string | null;
  remaining_days: number | null;
  last_pharmacy_id: string | null;
  last_pharmacy_name: string | null;
  last_dispensing_date: string | null;
  pharmacy_count: number;
  is_shared: boolean;
};

export function usePatientStatuses() {
  return useQuery({
    queryKey: ["patient_status"],
    queryFn: async (): Promise<PatientStatusRow[]> => {
      const { data, error } = await supabase
        .from("v_patient_status" as never)
        .select("*")
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as PatientStatusRow[];
    },
    staleTime: 15_000,
  });
}

export function usePatient(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ["patient", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patients")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function usePatientHistory(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ["patient_history", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dispensing_transactions")
        .select("id, dispensing_date, transaction_type, items_dispensed, notes, pharmacy_id, cycle_id, pharmacies(name)")
        .eq("patient_id", id!)
        .order("dispensing_date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePatientCycles(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ["patient_cycles", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dispensing_cycles")
        .select("id, status, started_at, completed_at, next_due_date")
        .eq("patient_id", id!)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export type ActivityLog = {
  id: string;
  created_at: string;
  pharmacy_id: string;
  pharmacy_name: string;
  action_type: string;
  details: any;
};

export function useActivityLogs() {
  return useQuery({
    queryKey: ["activity_logs"],
    queryFn: async (): Promise<ActivityLog[]> => {
      const { data, error } = await supabase
        .from("audit_log")
        .select(`
          id, 
          created_at, 
          pharmacy_id, 
          action_type, 
          details,
          pharmacies:pharmacy_id(name)
        `)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []).map((d: any) => ({
        ...d,
        pharmacy_name: d.pharmacies?.name || "صيدلية غير معروفة",
      }));
    },
  });
}

export function usePatientDetail(id: string) {
  return useQuery({
    queryKey: ["patient_detail", id],
    queryFn: async (): Promise<PatientStatusRow | null> => {
      const { data, error } = await supabase
        .from("v_patient_status" as never)
        .select("*")
        .eq("patient_id", id)
        .maybeSingle();
      if (error) throw error;
      return data as any as PatientStatusRow;
    },
  });
}

export function usePatientTimeline(id: string) {
  return useQuery({
    queryKey: ["patient_timeline", id],
    queryFn: async () => {
      const [{ data: trans }, { data: comms }] = await Promise.all([
        supabase
          .from("dispensing_transactions")
          .select("id, created_at, dispensing_date, transaction_type, pharmacies(name), notes")
          .eq("patient_id", id)
          .order("created_at", { ascending: false }),
        supabase
          .from("communication_logs")
          .select("id, created_at, channel, action_type, pharmacies(name)")
          .eq("patient_id", id)
          .order("created_at", { ascending: false }),
      ]);
      
      const events = [
        ...(trans || []).map(t => ({
          id: t.id,
          date: t.created_at,
          type: "dispense",
          title: t.transaction_type === "Completed" ? "صرف كامل" : "صرف جزئي",
          pharmacy: t.pharmacies?.name,
          details: t.notes
        })),
        ...(comms || []).map(c => ({
          id: c.id,
          date: c.created_at,
          type: "comm",
          title: c.action_type,
          pharmacy: c.pharmacies?.name
        }))
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      return events;
    }
  });
}
