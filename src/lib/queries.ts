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
  is_favorite: boolean;
  is_follow_up_suspended: boolean;
  follow_up_suspension_reason: string | null;
  current_cycle_id: string | null;
  current_cycle_status: "Waiting" | "Partial" | "Completed" | "Remaining" | null;
  current_cycle_started_at: string | null;
  next_due_date: string | null;
  remaining_days: number | null;
  active_tracks_count: number;
  tracks: { next_due_date: string; remaining_days: number; status: string }[];
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
        .select("id, dispensing_date, transaction_type, items_dispensed, notes, pharmacy_id, cycle_id, pharmacies!dispensing_transactions_pharmacy_id_fkey(name)")
        .eq("patient_id", id!)
        .order("dispensing_date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePatientDueTracks(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ["patient_due_tracks", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dispensing_due_tracks")
        .select("*")
        .eq("patient_id", id!)
        .neq("status", "Completed")
        .order("next_due_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export type DispensingTransactionRow = {
  id: string;
  patient_id: string;
  patient_name: string;
  insurance_card_number: string | null;
  pharmacy_id: string;
  pharmacy_name: string;
  transaction_type: "Partial" | "Remaining" | "Completed";
  items_dispensed: number | null;
  items_remaining: number | null;
  notes: string | null;
  dispensing_date: string;
  created_at: string;
  is_cancelled?: boolean;
  cancellation_reason?: string | null;
};

export function useDispensingTransactions(options: {
  startDate?: string;
  endDate?: string;
  pharmacyId?: string;
  type?: string;
  search?: string;
}) {
  return useQuery({
    queryKey: ["dispensing_transactions", options],
    queryFn: async (): Promise<DispensingTransactionRow[]> => {
      let query = supabase
        .from("dispensing_transactions")
        .select(`
          id,
          patient_id,
          transaction_type,
          items_dispensed,
          items_remaining,
          notes,
          dispensing_date,
          created_at,
          pharmacy_id,
          is_cancelled,
          cancellation_reason,
          patients(patient_name, insurance_card_number, national_id),
          pharmacies!dispensing_transactions_pharmacy_id_fkey(name)
        `)
        .order("dispensing_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (options.startDate) {
        query = query.gte("dispensing_date", `${options.startDate}T00:00:00Z`);
      }
      if (options.endDate) {
        query = query.lte("dispensing_date", `${options.endDate}T23:59:59Z`);
      }
      if (options.pharmacyId && options.pharmacyId !== "all") {
        query = query.eq("pharmacy_id", options.pharmacyId);
      }
      if (options.type && options.type !== "all") {
        query = query.eq("transaction_type", options.type as any);
      }

      const { data, error } = await query.limit(1000);
      if (error) throw error;

      let results = (data || []).map((d: any) => ({
        id: d.id,
        patient_id: d.patient_id,
        patient_name: d.patients?.patient_name || "مستفيد غير معروف",
        insurance_card_number: d.patients?.insurance_card_number,
        pharmacy_id: d.pharmacy_id,
        pharmacy_name: d.pharmacies?.name || "صيدلية غير معروفة",
        transaction_type: d.transaction_type,
        items_dispensed: d.items_dispensed,
        items_remaining: d.items_remaining,
        notes: d.notes,
        dispensing_date: d.dispensing_date,
        created_at: d.created_at,
        is_cancelled: d.is_cancelled,
        cancellation_reason: d.cancellation_reason,
      }));

      if (options.search) {
        const s = options.search.toLowerCase();
        results = results.filter(r => 
          r.patient_name.toLowerCase().includes(s) || 
          (r.insurance_card_number && r.insurance_card_number.includes(s))
        );
      }

      return results;
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
          pharmacies:pharmacy_id!audit_log_pharmacy_id_fkey(name)
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
          .select("id, created_at, dispensing_date, transaction_type, pharmacies!dispensing_transactions_pharmacy_id_fkey(name), notes, is_cancelled, cancellation_reason")
          .eq("patient_id", id)
          .order("created_at", { ascending: false }),
        supabase
          .from("communication_logs")
          .select("id, created_at, channel, action_type, pharmacies!communication_logs_pharmacy_id_fkey(name)")
          .eq("patient_id", id)
          .order("created_at", { ascending: false }),
      ]);
      
      const events = [
        ...(trans || []).map(t => ({
          id: t.id,
          date: t.created_at,
          type: "dispense",
          title: t.is_cancelled ? "ملغاة" : (t.transaction_type === "Completed" ? "صرف كامل" : "صرف جزئي"),
          pharmacy: t.pharmacies?.name,
          details: t.is_cancelled ? `[ملغاة: ${t.cancellation_reason}] ${t.notes || ""}` : t.notes,
          is_cancelled: t.is_cancelled
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
