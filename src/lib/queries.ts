import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { currentSession } from "@/lib/auth.functions";
import {
  listPatientStatuses,
  getPatient,
  getPatientHistory,
  getPatientDueTracks,
  getPatientTimeline,
  listDispensingTransactions,
} from "@/lib/reads.functions";

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
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data, error } = await supabase
        .from("v_pharmacies_public" as never)
        .select("id, name")
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; name: string }[];
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
  tracks:
    | { 
        id?: string; 
        next_due_date: string | null; 
        remaining_days?: number | null; 
        status: string;
      }[]
    | null;
  last_pharmacy_id: string | null;
  last_pharmacy_name: string | null;
  last_dispensing_date: string | null;
  pharmacy_count: number;
  is_shared: boolean;
};

export function usePatientStatuses() {
  return useQuery({
    queryKey: ["patient_status"],
    queryFn: async (): Promise<PatientStatusRow[]> =>
      (await listPatientStatuses()) as unknown as PatientStatusRow[],
    staleTime: 15_000,
  });
}

export function usePatient(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ["patient", id],
    queryFn: async () => await getPatient({ data: { id: id! } }),
  });
}

export function usePatientHistory(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ["patient_history", id],
    queryFn: async () => await getPatientHistory({ data: { id: id! } }),
  });
}

export function usePatientDueTracks(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ["patient_due_tracks", id],
    queryFn: async () => await getPatientDueTracks({ data: { id: id! } }),
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
      const rows = (await listDispensingTransactions({
        data: {
          startDate: options.startDate,
          endDate: options.endDate,
          type: options.type,
        },
      })) as unknown as DispensingTransactionRow[];
      let results = rows;
      if (options.pharmacyId && options.pharmacyId !== "all") {
        results = results.filter((r) => r.pharmacy_id === options.pharmacyId);
      }
      if (options.search) {
        const q = options.search.toLowerCase();
        results = results.filter(
          (r) =>
            r.patient_name.toLowerCase().includes(q) ||
            (r.insurance_card_number && r.insurance_card_number.includes(q)),
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
      const rows = (await listPatientStatuses()) as unknown as PatientStatusRow[];
      return rows.find((r) => r.patient_id === id) ?? null;
    },
  });
}

export function usePatientTimeline(id: string) {
  return useQuery({
    queryKey: ["patient_timeline", id],
    queryFn: async () => await getPatientTimeline({ data: { id } }),
  });
}
