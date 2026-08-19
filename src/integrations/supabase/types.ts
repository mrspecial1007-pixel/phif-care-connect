export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          after: Json | null
          before: Json | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          ip: string | null
          pharmacy_id: string | null
        }
        Insert: {
          action: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          ip?: string | null
          pharmacy_id?: string | null
        }
        Update: {
          action?: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          ip?: string | null
          pharmacy_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_logs: {
        Row: {
          action_type: string
          channel: string
          created_at: string
          id: string
          patient_id: string
          patient_status: string | null
          pharmacy_id: string | null
          phone_number: string
          remaining_days: number | null
        }
        Insert: {
          action_type: string
          channel: string
          created_at?: string
          id?: string
          patient_id: string
          patient_status?: string | null
          pharmacy_id?: string | null
          phone_number: string
          remaining_days?: number | null
        }
        Update: {
          action_type?: string
          channel?: string
          created_at?: string
          id?: string
          patient_id?: string
          patient_status?: string | null
          pharmacy_id?: string | null
          phone_number?: string
          remaining_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_logs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_logs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_logs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "communication_logs_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_logs_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      dispensing_cycles: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          next_due_date: string | null
          patient_id: string
          started_at: string
          status: Database["public"]["Enums"]["cycle_status"]
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          next_due_date?: string | null
          patient_id: string
          started_at: string
          status: Database["public"]["Enums"]["cycle_status"]
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          next_due_date?: string | null
          patient_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["cycle_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispensing_cycles_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispensing_cycles_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispensing_cycles_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      dispensing_due_tracks: {
        Row: {
          created_at: string
          id: string
          last_dispensing_date: string
          next_due_date: string
          patient_id: string
          source_transaction_id: string | null
          status: Database["public"]["Enums"]["cycle_status"]
          stream_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_dispensing_date: string
          next_due_date: string
          patient_id: string
          source_transaction_id?: string | null
          status?: Database["public"]["Enums"]["cycle_status"]
          stream_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_dispensing_date?: string
          next_due_date?: string
          patient_id?: string
          source_transaction_id?: string | null
          status?: Database["public"]["Enums"]["cycle_status"]
          stream_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispensing_due_tracks_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispensing_due_tracks_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispensing_due_tracks_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "dispensing_due_tracks_source_transaction_id_fkey"
            columns: ["source_transaction_id"]
            isOneToOne: false
            referencedRelation: "dispensing_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      dispensing_transactions: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          cycle_id: string | null
          dispensing_date: string
          id: string
          idempotency_key: string | null
          is_cancelled: boolean | null
          items_dispensed: number | null
          items_remaining: number | null
          notes: string | null
          patient_id: string
          pharmacy_id: string
          stream_id: string | null
          transaction_type: Database["public"]["Enums"]["tx_type"]
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          cycle_id?: string | null
          dispensing_date?: string
          id?: string
          idempotency_key?: string | null
          is_cancelled?: boolean | null
          items_dispensed?: number | null
          items_remaining?: number | null
          notes?: string | null
          patient_id: string
          pharmacy_id: string
          stream_id?: string | null
          transaction_type: Database["public"]["Enums"]["tx_type"]
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          cycle_id?: string | null
          dispensing_date?: string
          id?: string
          idempotency_key?: string | null
          is_cancelled?: boolean | null
          items_dispensed?: number | null
          items_remaining?: number | null
          notes?: string | null
          patient_id?: string
          pharmacy_id?: string
          stream_id?: string | null
          transaction_type?: Database["public"]["Enums"]["tx_type"]
        }
        Relationships: [
          {
            foreignKeyName: "dispensing_transactions_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispensing_transactions_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispensing_transactions_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "dispensing_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispensing_transactions_fulfilled_track_id_fkey"
            columns: ["stream_id"]
            isOneToOne: false
            referencedRelation: "dispensing_due_tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispensing_transactions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispensing_transactions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispensing_transactions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "dispensing_transactions_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispensing_transactions_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_devices: {
        Row: {
          created_at: string
          enabled: boolean
          fcm_token: string | null
          id: string
          last_seen_at: string | null
          name: string
          pharmacy_id: string
          status: string
          token_hash: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          fcm_token?: string | null
          id?: string
          last_seen_at?: string | null
          name: string
          pharmacy_id: string
          status?: string
          token_hash: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          fcm_token?: string | null
          id?: string
          last_seen_at?: string | null
          name?: string
          pharmacy_id?: string
          status?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "gateway_devices_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_devices_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          address: string | null
          archived_at: string | null
          birth_date: string | null
          created_at: string
          follow_up_suspended_at: string | null
          follow_up_suspension_reason: string | null
          gender: string | null
          id: string
          insurance_card_number: string | null
          is_archived: boolean | null
          is_favorite: boolean | null
          is_follow_up_suspended: boolean | null
          national_id: string | null
          notes: string | null
          patient_name: string
          patient_name_normalized: string
          phone: string | null
          possible_duplicate_of: string | null
          review_status: Database["public"]["Enums"]["review_status"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          birth_date?: string | null
          created_at?: string
          follow_up_suspended_at?: string | null
          follow_up_suspension_reason?: string | null
          gender?: string | null
          id?: string
          insurance_card_number?: string | null
          is_archived?: boolean | null
          is_favorite?: boolean | null
          is_follow_up_suspended?: boolean | null
          national_id?: string | null
          notes?: string | null
          patient_name: string
          patient_name_normalized: string
          phone?: string | null
          possible_duplicate_of?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          birth_date?: string | null
          created_at?: string
          follow_up_suspended_at?: string | null
          follow_up_suspension_reason?: string | null
          gender?: string | null
          id?: string
          insurance_card_number?: string | null
          is_archived?: boolean | null
          is_favorite?: boolean | null
          is_follow_up_suspended?: boolean | null
          national_id?: string | null
          notes?: string | null
          patient_name?: string
          patient_name_normalized?: string
          phone?: string | null
          possible_duplicate_of?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patients_possible_duplicate_of_fkey"
            columns: ["possible_duplicate_of"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patients_possible_duplicate_of_fkey"
            columns: ["possible_duplicate_of"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patients_possible_duplicate_of_fkey"
            columns: ["possible_duplicate_of"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      pharmacies: {
        Row: {
          address: string | null
          created_at: string
          id: string
          name: string
          phone: string | null
          pin_hash: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          name: string
          phone?: string | null
          pin_hash: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
          pin_hash?: string
        }
        Relationships: []
      }
      sms_messages: {
        Row: {
          created_at: string
          created_by: string
          current_status: Database["public"]["Enums"]["sms_status"]
          id: string
          idempotency_key: string
          message_body: string
          patient_id: string
          pharmacy_id: string
          phone_number: string
        }
        Insert: {
          created_at?: string
          created_by: string
          current_status?: Database["public"]["Enums"]["sms_status"]
          id?: string
          idempotency_key: string
          message_body: string
          patient_id: string
          pharmacy_id: string
          phone_number: string
        }
        Update: {
          created_at?: string
          created_by?: string
          current_status?: Database["public"]["Enums"]["sms_status"]
          id?: string
          idempotency_key?: string
          message_body?: string
          patient_id?: string
          pharmacy_id?: string
          phone_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_messages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "sms_messages_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_send_attempts: {
        Row: {
          attempt_number: number
          claimed_at: string | null
          created_at: string
          delivered_at: string | null
          error_code: string | null
          error_message: string | null
          failed_at: string | null
          gateway_device_id: string | null
          id: string
          lease_expires_at: string | null
          message_id: string
          requested_at: string
          sent_at: string | null
          sim_slot: number | null
        }
        Insert: {
          attempt_number?: number
          claimed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          gateway_device_id?: string | null
          id?: string
          lease_expires_at?: string | null
          message_id: string
          requested_at?: string
          sent_at?: string | null
          sim_slot?: number | null
        }
        Update: {
          attempt_number?: number
          claimed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          gateway_device_id?: string | null
          id?: string
          lease_expires_at?: string | null
          message_id?: string
          requested_at?: string
          sent_at?: string | null
          sim_slot?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_send_attempts_gateway_device_id_fkey"
            columns: ["gateway_device_id"]
            isOneToOne: false
            referencedRelation: "gateway_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_send_attempts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "sms_messages"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_patient_status: {
        Row: {
          active_tracks_count: number | null
          address: string | null
          birth_date: string | null
          follow_up_suspended_at: string | null
          follow_up_suspension_reason: string | null
          gender: string | null
          id: string | null
          insurance_card_number: string | null
          is_archived: boolean | null
          is_favorite: boolean | null
          is_follow_up_suspended: boolean | null
          last_dispensing_date: string | null
          last_pharmacy_id: string | null
          last_pharmacy_name: string | null
          national_id: string | null
          next_due_date: string | null
          notes: string | null
          patient_id: string | null
          patient_name: string | null
          patient_name_normalized: string | null
          phone: string | null
          remaining_days: number | null
          tracks: Json | null
        }
        Insert: {
          active_tracks_count?: never
          address?: string | null
          birth_date?: string | null
          follow_up_suspended_at?: string | null
          follow_up_suspension_reason?: string | null
          gender?: string | null
          id?: string | null
          insurance_card_number?: string | null
          is_archived?: boolean | null
          is_favorite?: boolean | null
          is_follow_up_suspended?: boolean | null
          last_dispensing_date?: never
          last_pharmacy_id?: never
          last_pharmacy_name?: never
          national_id?: string | null
          next_due_date?: never
          notes?: string | null
          patient_id?: string | null
          patient_name?: string | null
          patient_name_normalized?: string | null
          phone?: string | null
          remaining_days?: never
          tracks?: never
        }
        Update: {
          active_tracks_count?: never
          address?: string | null
          birth_date?: string | null
          follow_up_suspended_at?: string | null
          follow_up_suspension_reason?: string | null
          gender?: string | null
          id?: string | null
          insurance_card_number?: string | null
          is_archived?: boolean | null
          is_favorite?: boolean | null
          is_follow_up_suspended?: boolean | null
          last_dispensing_date?: never
          last_pharmacy_id?: never
          last_pharmacy_name?: never
          national_id?: string | null
          next_due_date?: never
          notes?: string | null
          patient_id?: string | null
          patient_name?: string | null
          patient_name_normalized?: string | null
          phone?: string | null
          remaining_days?: never
          tracks?: never
        }
        Relationships: []
      }
      v_pharmacies: {
        Row: {
          created_at: string | null
          id: string | null
          name: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          name?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          name?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      cycle_status: "Waiting" | "Partial" | "Completed"
      review_status: "ok" | "needs_review"
      sms_status:
        | "pending"
        | "sending"
        | "sent"
        | "delivered"
        | "failed"
        | "cancelled"
        | "handoff"
      tx_type: "Partial" | "Remaining" | "Completed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      cycle_status: ["Waiting", "Partial", "Completed"],
      review_status: ["ok", "needs_review"],
      sms_status: [
        "pending",
        "sending",
        "sent",
        "delivered",
        "failed",
        "cancelled",
        "handoff",
      ],
      tx_type: ["Partial", "Remaining", "Completed"],
    },
  },
} as const
