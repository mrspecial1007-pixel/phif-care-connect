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
          {
            foreignKeyName: "audit_log_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_products: {
        Row: {
          barcode: string | null
          brand_name: string
          brand_name_normalized: string
          created_at: string
          id: string
          is_active: boolean
          manufacturer: string | null
          package_size: number | null
          package_unit: string | null
          phif_code: string | null
          supplier: string | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          brand_name: string
          brand_name_normalized: string
          created_at?: string
          id?: string
          is_active?: boolean
          manufacturer?: string | null
          package_size?: number | null
          package_unit?: string | null
          phif_code?: string | null
          supplier?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          brand_name?: string
          brand_name_normalized?: string
          created_at?: string
          id?: string
          is_active?: boolean
          manufacturer?: string | null
          package_size?: number | null
          package_unit?: string | null
          phif_code?: string | null
          supplier?: string | null
          updated_at?: string
        }
        Relationships: []
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
            referencedRelation: "v_patient_pharmacy_access_unassigned"
            referencedColumns: ["patient_id"]
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
          {
            foreignKeyName: "communication_logs_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
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
            referencedRelation: "v_patient_pharmacy_access_unassigned"
            referencedColumns: ["patient_id"]
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
            referencedRelation: "v_patient_pharmacy_access_unassigned"
            referencedColumns: ["patient_id"]
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
            foreignKeyName: "dispensing_transactions_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
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
            foreignKeyName: "dispensing_transactions_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["current_cycle_id"]
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
            referencedRelation: "v_patient_pharmacy_access_unassigned"
            referencedColumns: ["patient_id"]
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
          {
            foreignKeyName: "dispensing_transactions_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
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
          revoked_at: string | null
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
          revoked_at?: string | null
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
          revoked_at?: string | null
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
          {
            foreignKeyName: "gateway_devices_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_pairing_codes: {
        Row: {
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          pharmacy_id: string
          used_at: string | null
        }
        Insert: {
          code_hash: string
          created_at?: string
          expires_at: string
          id?: string
          pharmacy_id: string
          used_at?: string | null
        }
        Update: {
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          pharmacy_id?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gateway_pairing_codes_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_pairing_codes_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_pairing_codes_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
        ]
      }
      medications: {
        Row: {
          active_ingredient: string
          active_ingredient_normalized: string
          atc_code: string | null
          created_at: string
          dosage_form: string
          dosage_form_normalized: string
          id: string
          notes: string | null
          route: string | null
          strength_denominator_unit: string | null
          strength_denominator_value: number | null
          strength_unit: string
          strength_value: number
          updated_at: string
        }
        Insert: {
          active_ingredient: string
          active_ingredient_normalized: string
          atc_code?: string | null
          created_at?: string
          dosage_form: string
          dosage_form_normalized: string
          id?: string
          notes?: string | null
          route?: string | null
          strength_denominator_unit?: string | null
          strength_denominator_value?: number | null
          strength_unit: string
          strength_value: number
          updated_at?: string
        }
        Update: {
          active_ingredient?: string
          active_ingredient_normalized?: string
          atc_code?: string | null
          created_at?: string
          dosage_form?: string
          dosage_form_normalized?: string
          id?: string
          notes?: string | null
          route?: string | null
          strength_denominator_unit?: string | null
          strength_denominator_value?: number | null
          strength_unit?: string
          strength_value?: number
          updated_at?: string
        }
        Relationships: []
      }
      patient_insurance_cards: {
        Row: {
          card_number: string
          created_at: string
          id: string
          linked_at: string
          patient_id: string
          retired_at: string | null
          source: string
          status: string
        }
        Insert: {
          card_number: string
          created_at?: string
          id?: string
          linked_at?: string
          patient_id: string
          retired_at?: string | null
          source?: string
          status?: string
        }
        Update: {
          card_number?: string
          created_at?: string
          id?: string
          linked_at?: string
          patient_id?: string
          retired_at?: string | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_insurance_cards_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_insurance_cards_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_pharmacy_access_unassigned"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "patient_insurance_cards_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_insurance_cards_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      patient_pharmacy_access: {
        Row: {
          created_at: string
          id: string
          patient_id: string
          pharmacy_id: string
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          patient_id: string
          pharmacy_id: string
          source?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          patient_id?: string
          pharmacy_id?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_pharmacy_access_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_pharmacy_access_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_pharmacy_access_unassigned"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "patient_pharmacy_access_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_pharmacy_access_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "patient_pharmacy_access_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_pharmacy_access_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_pharmacy_access_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
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
            referencedRelation: "v_patient_pharmacy_access_unassigned"
            referencedColumns: ["patient_id"]
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
          login_email: string | null
          name: string
          phone: string | null
          pin_hash: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          login_email?: string | null
          name: string
          phone?: string | null
          pin_hash: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          login_email?: string | null
          name?: string
          phone?: string | null
          pin_hash?: string
        }
        Relationships: []
      }
      pharmacy_users: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          last_login_at: string | null
          login_identifier: string
          password_hash: string
          permissions: Json
          pharmacy_id: string
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          login_identifier: string
          password_hash: string
          permissions?: Json
          pharmacy_id: string
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          login_identifier?: string
          password_hash?: string
          permissions?: Json
          pharmacy_id?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pharmacy_users_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pharmacy_users_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pharmacy_users_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
        ]
      }
      phif_actual_stock_links: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          pharmacy_id: string
          phif_invoice_item_id: string
          source_identity: string | null
          source_signature: string
          target_stock_item_id: string
          updated_actor: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          pharmacy_id: string
          phif_invoice_item_id: string
          source_identity?: string | null
          source_signature: string
          target_stock_item_id: string
          updated_actor: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          pharmacy_id?: string
          phif_invoice_item_id?: string
          source_identity?: string | null
          source_signature?: string
          target_stock_item_id?: string
          updated_actor?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "phif_actual_stock_links_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_actual_stock_links_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_actual_stock_links_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_actual_stock_links_phif_invoice_item_id_fkey"
            columns: ["phif_invoice_item_id"]
            isOneToOne: false
            referencedRelation: "phif_invoice_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_actual_stock_links_target_stock_item_id_fkey"
            columns: ["target_stock_item_id"]
            isOneToOne: false
            referencedRelation: "phif_stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_actual_stock_links_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "pharmacy_users"
            referencedColumns: ["id"]
          },
        ]
      }
      phif_actual_unit_decisions: {
        Row: {
          cost_unit: string
          created_at: string
          dispensing_unit: string
          id: string
          is_active: boolean
          pharmacy_id: string
          phif_invoice_item_id: string
          source_signature: string
          stock_signature: string
          updated_actor: string
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          cost_unit: string
          created_at?: string
          dispensing_unit: string
          id?: string
          is_active?: boolean
          pharmacy_id: string
          phif_invoice_item_id: string
          source_signature: string
          stock_signature: string
          updated_actor: string
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          cost_unit?: string
          created_at?: string
          dispensing_unit?: string
          id?: string
          is_active?: boolean
          pharmacy_id?: string
          phif_invoice_item_id?: string
          source_signature?: string
          stock_signature?: string
          updated_actor?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "phif_actual_unit_decisions_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_actual_unit_decisions_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_actual_unit_decisions_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_actual_unit_decisions_phif_invoice_item_id_fkey"
            columns: ["phif_invoice_item_id"]
            isOneToOne: false
            referencedRelation: "phif_invoice_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_actual_unit_decisions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "pharmacy_users"
            referencedColumns: ["id"]
          },
        ]
      }
      phif_bridge_sessions: {
        Row: {
          bridge_session_id: string
          created_at: string
          expires_at: string
          id: string
          last_checked_at: string | null
          pharmacy_id: string
          status: string
          updated_at: string
        }
        Insert: {
          bridge_session_id: string
          created_at?: string
          expires_at: string
          id?: string
          last_checked_at?: string | null
          pharmacy_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          bridge_session_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          last_checked_at?: string | null
          pharmacy_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "phif_bridge_sessions_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_bridge_sessions_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_bridge_sessions_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
        ]
      }
      phif_invoice_items: {
        Row: {
          active_ingredient: string | null
          brand: string | null
          created_at: string
          id: string
          metadata: Json
          phif_financial_fields: Json
          phif_invoice_id: string
          phif_item_id: string | null
          quantity: number | null
          source_classification: string | null
          strength: string | null
          supplier: string | null
        }
        Insert: {
          active_ingredient?: string | null
          brand?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          phif_financial_fields?: Json
          phif_invoice_id: string
          phif_item_id?: string | null
          quantity?: number | null
          source_classification?: string | null
          strength?: string | null
          supplier?: string | null
        }
        Update: {
          active_ingredient?: string | null
          brand?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          phif_financial_fields?: Json
          phif_invoice_id?: string
          phif_item_id?: string | null
          quantity?: number | null
          source_classification?: string | null
          strength?: string | null
          supplier?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "phif_invoice_items_phif_invoice_id_fkey"
            columns: ["phif_invoice_id"]
            isOneToOne: false
            referencedRelation: "phif_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      phif_invoices: {
        Row: {
          beneficiary_name: string | null
          created_at: string
          dispensing_date: string | null
          dispensing_time: string | null
          id: string
          insurance_card_number: string | null
          invoice_key: string
          invoice_number: string | null
          metadata: Json
          patient_id: string | null
          pharmacy_id: string
          review_note: string | null
          review_status: string
          reviewed_at: string | null
          status: string | null
          sync_run_id: string | null
          synced_at: string
        }
        Insert: {
          beneficiary_name?: string | null
          created_at?: string
          dispensing_date?: string | null
          dispensing_time?: string | null
          id?: string
          insurance_card_number?: string | null
          invoice_key: string
          invoice_number?: string | null
          metadata?: Json
          patient_id?: string | null
          pharmacy_id: string
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          status?: string | null
          sync_run_id?: string | null
          synced_at?: string
        }
        Update: {
          beneficiary_name?: string | null
          created_at?: string
          dispensing_date?: string | null
          dispensing_time?: string | null
          id?: string
          insurance_card_number?: string | null
          invoice_key?: string
          invoice_number?: string | null
          metadata?: Json
          patient_id?: string | null
          pharmacy_id?: string
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          status?: string | null
          sync_run_id?: string | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "phif_invoices_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_invoices_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_pharmacy_access_unassigned"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "phif_invoices_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_invoices_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "phif_invoices_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_invoices_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_invoices_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_invoices_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "phif_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      phif_manual_sync_operations: {
        Row: {
          actor_id: string
          expires_at: string
          finished_at: string | null
          id: string
          kind: string
          pharmacy_id: string
          session_record_id: string
          started_at: string
          status: string
        }
        Insert: {
          actor_id: string
          expires_at?: string
          finished_at?: string | null
          id?: string
          kind: string
          pharmacy_id: string
          session_record_id: string
          started_at?: string
          status?: string
        }
        Update: {
          actor_id?: string
          expires_at?: string
          finished_at?: string | null
          id?: string
          kind?: string
          pharmacy_id?: string
          session_record_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "phif_manual_sync_operations_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "pharmacy_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_manual_sync_operations_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_manual_sync_operations_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_manual_sync_operations_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_manual_sync_operations_session_record_id_fkey"
            columns: ["session_record_id"]
            isOneToOne: false
            referencedRelation: "phif_bridge_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      phif_medication_follow_ups: {
        Row: {
          baseline_invoice_ids: string[]
          is_stopped: boolean
          medication_identity_key: string
          patient_id: string
          pharmacy_id: string
          reactivated_at: string | null
          reason: string | null
          stopped_at: string | null
          updated_at: string
        }
        Insert: {
          baseline_invoice_ids?: string[]
          is_stopped?: boolean
          medication_identity_key: string
          patient_id: string
          pharmacy_id: string
          reactivated_at?: string | null
          reason?: string | null
          stopped_at?: string | null
          updated_at?: string
        }
        Update: {
          baseline_invoice_ids?: string[]
          is_stopped?: boolean
          medication_identity_key?: string
          patient_id?: string
          pharmacy_id?: string
          reactivated_at?: string | null
          reason?: string | null
          stopped_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "phif_medication_follow_ups_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_medication_follow_ups_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_pharmacy_access_unassigned"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "phif_medication_follow_ups_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_medication_follow_ups_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "phif_medication_follow_ups_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_medication_follow_ups_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_medication_follow_ups_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
        ]
      }
      phif_order_receipt_sync: {
        Row: {
          fetched_at: string
          pharmacy_id: string
        }
        Insert: {
          fetched_at: string
          pharmacy_id: string
        }
        Update: {
          fetched_at?: string
          pharmacy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "phif_order_receipt_sync_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: true
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_order_receipt_sync_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: true
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_order_receipt_sync_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: true
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
        ]
      }
      phif_order_receipts: {
        Row: {
          batch: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          confirmed_received_on: string | null
          first_received_observed_at: string | null
          id: string
          line_id: string
          medicine: string
          order_created_at: string | null
          order_id: string
          order_number: string
          pharmacy_id: string
          status: string
          version: number
        }
        Insert: {
          batch?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_received_on?: string | null
          first_received_observed_at?: string | null
          id?: string
          line_id: string
          medicine: string
          order_created_at?: string | null
          order_id: string
          order_number: string
          pharmacy_id: string
          status: string
          version?: number
        }
        Update: {
          batch?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_received_on?: string | null
          first_received_observed_at?: string | null
          id?: string
          line_id?: string
          medicine?: string
          order_created_at?: string | null
          order_id?: string
          order_number?: string
          pharmacy_id?: string
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "phif_order_receipts_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "pharmacy_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_order_receipts_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_order_receipts_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_order_receipts_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
        ]
      }
      phif_order_snapshots: {
        Row: {
          fetched_at: string
          pharmacy_id: string
          report: Json
          saved_at: string
          saved_by: string
          version: number
        }
        Insert: {
          fetched_at: string
          pharmacy_id: string
          report: Json
          saved_at?: string
          saved_by: string
          version: number
        }
        Update: {
          fetched_at?: string
          pharmacy_id?: string
          report?: Json
          saved_at?: string
          saved_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "phif_order_snapshots_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: true
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_order_snapshots_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: true
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_order_snapshots_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: true
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_order_snapshots_saved_by_fkey"
            columns: ["saved_by"]
            isOneToOne: false
            referencedRelation: "pharmacy_users"
            referencedColumns: ["id"]
          },
        ]
      }
      phif_report_box_settings: {
        Row: {
          base_unit: string
          id: string
          item_identity: string
          pharmacy_id: string
          supplier_quantity_unit: string | null
          supplier_unit_exceptions: Json
          units_per_box: number
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          base_unit: string
          id?: string
          item_identity: string
          pharmacy_id: string
          supplier_quantity_unit?: string | null
          supplier_unit_exceptions?: Json
          units_per_box: number
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          base_unit?: string
          id?: string
          item_identity?: string
          pharmacy_id?: string
          supplier_quantity_unit?: string | null
          supplier_unit_exceptions?: Json
          units_per_box?: number
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "phif_report_box_settings_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_report_box_settings_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_report_box_settings_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_report_box_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "pharmacy_users"
            referencedColumns: ["id"]
          },
        ]
      }
      phif_stock_items: {
        Row: {
          active_ingredient: string | null
          batch_id: string | null
          batch_number: string | null
          brand_name: string | null
          brand_product_id: string | null
          company_name: string | null
          content_hash: string
          cost_price: number | null
          created_at: string
          dosage_unit: string | null
          expiry_date: string | null
          factory_price: number | null
          generic_ingredient_id: string | null
          id: string
          is_current: boolean
          package_quantity: number | null
          pharmacy_id: string
          raw_metadata: Json
          sale_price: number | null
          source_pharmacy_id: string | null
          source_quantity_unit: string | null
          source_stock_id: string
          stock_quantity: number | null
          strength: string | null
          strips_quantity: number | null
          supplier_id: string | null
          supplier_name: string | null
          sync_run_id: string | null
          synced_at: string
        }
        Insert: {
          active_ingredient?: string | null
          batch_id?: string | null
          batch_number?: string | null
          brand_name?: string | null
          brand_product_id?: string | null
          company_name?: string | null
          content_hash: string
          cost_price?: number | null
          created_at?: string
          dosage_unit?: string | null
          expiry_date?: string | null
          factory_price?: number | null
          generic_ingredient_id?: string | null
          id?: string
          is_current?: boolean
          package_quantity?: number | null
          pharmacy_id: string
          raw_metadata?: Json
          sale_price?: number | null
          source_pharmacy_id?: string | null
          source_quantity_unit?: string | null
          source_stock_id: string
          stock_quantity?: number | null
          strength?: string | null
          strips_quantity?: number | null
          supplier_id?: string | null
          supplier_name?: string | null
          sync_run_id?: string | null
          synced_at?: string
        }
        Update: {
          active_ingredient?: string | null
          batch_id?: string | null
          batch_number?: string | null
          brand_name?: string | null
          brand_product_id?: string | null
          company_name?: string | null
          content_hash?: string
          cost_price?: number | null
          created_at?: string
          dosage_unit?: string | null
          expiry_date?: string | null
          factory_price?: number | null
          generic_ingredient_id?: string | null
          id?: string
          is_current?: boolean
          package_quantity?: number | null
          pharmacy_id?: string
          raw_metadata?: Json
          sale_price?: number | null
          source_pharmacy_id?: string | null
          source_quantity_unit?: string | null
          source_stock_id?: string
          stock_quantity?: number | null
          strength?: string | null
          strips_quantity?: number | null
          supplier_id?: string | null
          supplier_name?: string | null
          sync_run_id?: string | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "phif_stock_items_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_stock_items_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_stock_items_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_stock_items_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "phif_stock_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      phif_stock_sync_runs: {
        Row: {
          created_at: string
          error_count: number
          error_message: string | null
          finished_at: string | null
          id: string
          imported_records: number
          pharmacy_id: string
          started_at: string
          status: string
          total_records: number
        }
        Insert: {
          created_at?: string
          error_count?: number
          error_message?: string | null
          finished_at?: string | null
          id?: string
          imported_records?: number
          pharmacy_id: string
          started_at?: string
          status?: string
          total_records?: number
        }
        Update: {
          created_at?: string
          error_count?: number
          error_message?: string | null
          finished_at?: string | null
          id?: string
          imported_records?: number
          pharmacy_id?: string
          started_at?: string
          status?: string
          total_records?: number
        }
        Relationships: [
          {
            foreignKeyName: "phif_stock_sync_runs_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_stock_sync_runs_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_stock_sync_runs_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
        ]
      }
      phif_sync_runs: {
        Row: {
          created_at: string
          duplicate_count: number
          failed_count: number
          finished_at: string | null
          id: string
          new_count: number
          pharmacy_id: string
          started_at: string
          status: string
        }
        Insert: {
          created_at?: string
          duplicate_count?: number
          failed_count?: number
          finished_at?: string | null
          id?: string
          new_count?: number
          pharmacy_id: string
          started_at?: string
          status?: string
        }
        Update: {
          created_at?: string
          duplicate_count?: number
          failed_count?: number
          finished_at?: string | null
          id?: string
          new_count?: number
          pharmacy_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "phif_sync_runs_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_sync_runs_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phif_sync_runs_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
        ]
      }
      prescription_items: {
        Row: {
          created_at: string
          days_supply: number | null
          dose_instructions: string | null
          id: string
          line_number: number
          medication_id: string | null
          pharmacy_id: string
          prescription_id: string
          quantity_prescribed: number | null
          quantity_unit: string | null
          raw_text: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          days_supply?: number | null
          dose_instructions?: string | null
          id?: string
          line_number: number
          medication_id?: string | null
          pharmacy_id: string
          prescription_id: string
          quantity_prescribed?: number | null
          quantity_unit?: string | null
          raw_text: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          days_supply?: number | null
          dose_instructions?: string | null
          id?: string
          line_number?: number
          medication_id?: string | null
          pharmacy_id?: string
          prescription_id?: string
          quantity_prescribed?: number | null
          quantity_unit?: string | null
          raw_text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prescription_items_medication_id_fkey"
            columns: ["medication_id"]
            isOneToOne: false
            referencedRelation: "medications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescription_items_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescription_items_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescription_items_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescription_items_prescription_id_fkey"
            columns: ["prescription_id"]
            isOneToOne: false
            referencedRelation: "prescriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      prescriptions: {
        Row: {
          created_at: string
          external_ref: string | null
          id: string
          notes: string | null
          patient_id: string
          pharmacy_id: string
          prescriber_name: string | null
          prescription_date: string
          source: string
          status: string
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          external_ref?: string | null
          id?: string
          notes?: string | null
          patient_id: string
          pharmacy_id: string
          prescriber_name?: string | null
          prescription_date: string
          source: string
          status?: string
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          external_ref?: string | null
          id?: string
          notes?: string | null
          patient_id?: string
          pharmacy_id?: string
          prescriber_name?: string | null
          prescription_date?: string
          source?: string
          status?: string
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prescriptions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_pharmacy_access_unassigned"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "prescriptions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "v_patient_status"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "prescriptions_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
        ]
      }
      product_medication_mappings: {
        Row: {
          confidence: string
          created_at: string
          created_by_pharmacy_id: string | null
          effective_from: string
          effective_to: string | null
          id: string
          medication_id: string
          product_id: string
          source: string
          units_per_package: number | null
          updated_at: string
        }
        Insert: {
          confidence: string
          created_at?: string
          created_by_pharmacy_id?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          medication_id: string
          product_id: string
          source: string
          units_per_package?: number | null
          updated_at?: string
        }
        Update: {
          confidence?: string
          created_at?: string
          created_by_pharmacy_id?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          medication_id?: string
          product_id?: string
          source?: string
          units_per_package?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_medication_mappings_created_by_pharmacy_id_fkey"
            columns: ["created_by_pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_medication_mappings_created_by_pharmacy_id_fkey"
            columns: ["created_by_pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_medication_mappings_created_by_pharmacy_id_fkey"
            columns: ["created_by_pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_medication_mappings_medication_id_fkey"
            columns: ["medication_id"]
            isOneToOne: false
            referencedRelation: "medications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_medication_mappings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "commercial_products"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_messages: {
        Row: {
          created_at: string
          created_by: string
          current_status: Database["public"]["Enums"]["sms_status"]
          id: string
          idempotency_key: string
          is_archived: boolean | null
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
          is_archived?: boolean | null
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
          is_archived?: boolean | null
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
            foreignKeyName: "sms_messages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
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
            referencedRelation: "v_patient_pharmacy_access_unassigned"
            referencedColumns: ["patient_id"]
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
          {
            foreignKeyName: "sms_messages_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
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
      user_operation_log: {
        Row: {
          action: string
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          metadata: Json
          pharmacy_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          metadata?: Json
          pharmacy_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          metadata?: Json
          pharmacy_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_operation_log_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_operation_log_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_operation_log_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_operation_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "pharmacy_users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_patient_pharmacy_access_unassigned: {
        Row: {
          created_at: string | null
          insurance_card_number: string | null
          patient_id: string | null
          patient_name: string | null
        }
        Insert: {
          created_at?: string | null
          insurance_card_number?: string | null
          patient_id?: string | null
          patient_name?: string | null
        }
        Update: {
          created_at?: string | null
          insurance_card_number?: string | null
          patient_id?: string | null
          patient_name?: string | null
        }
        Relationships: []
      }
      v_patient_status: {
        Row: {
          active_tracks_count: number | null
          address: string | null
          birth_date: string | null
          current_cycle_id: string | null
          current_cycle_started_at: string | null
          current_cycle_status:
            | Database["public"]["Enums"]["cycle_status"]
            | null
          follow_up_suspended_at: string | null
          follow_up_suspension_reason: string | null
          gender: string | null
          id: string | null
          insurance_card_number: string | null
          is_archived: boolean | null
          is_favorite: boolean | null
          is_follow_up_suspended: boolean | null
          is_shared: boolean | null
          last_dispensing_date: string | null
          last_pharmacy_id: string | null
          last_pharmacy_name: string | null
          national_id: string | null
          next_due_date: string | null
          notes: string | null
          patient_id: string | null
          patient_name: string | null
          patient_name_normalized: string | null
          pharmacy_count: number | null
          phone: string | null
          remaining_days: number | null
          review_status: Database["public"]["Enums"]["review_status"] | null
          tracks: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "dispensing_transactions_pharmacy_id_fkey"
            columns: ["last_pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispensing_transactions_pharmacy_id_fkey"
            columns: ["last_pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispensing_transactions_pharmacy_id_fkey"
            columns: ["last_pharmacy_id"]
            isOneToOne: false
            referencedRelation: "v_pharmacies_public"
            referencedColumns: ["id"]
          },
        ]
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
      v_pharmacies_public: {
        Row: {
          id: string | null
          name: string | null
        }
        Insert: {
          id?: string | null
          name?: string | null
        }
        Update: {
          id?: string | null
          name?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _apply_phif_stock_snapshots: {
        Args: { p_items: Json; p_pharmacy_id: string; p_sync_run_id: string }
        Returns: number
      }
      _phif_manual_sync_actor: {
        Args: { p_actor_id: string; p_pharmacy_id: string }
        Returns: undefined
      }
      _phif_scope_actual_identity: {
        Args: { p_item_id: string; p_pharmacy_id: string; p_target_id: string }
        Returns: Json
      }
      _phif_scope_form: { Args: { p_value: string }; Returns: string }
      _phif_scope_item_form: { Args: { p_item: Json }; Returns: string }
      _phif_scope_item_identity: {
        Args: { p_item_id: string; p_pharmacy_id: string; p_target_id?: string }
        Returns: Json
      }
      _phif_scope_strength: { Args: { p_value: string }; Returns: string }
      _phif_scope_text: {
        Args: { p_ingredient?: boolean; p_value: string }
        Returns: string
      }
      begin_phif_manual_sync: {
        Args: {
          p_actor_id: string
          p_kind: string
          p_pharmacy_id: string
          p_session_record_id: string
        }
        Returns: Json
      }
      complete_phif_orders_sync: {
        Args: {
          p_actor_id: string
          p_expected_version: number
          p_operation_id: string
          p_pharmacy_id: string
          p_report: Json
        }
        Returns: number
      }
      fail_phif_manual_sync: {
        Args: {
          p_actor_id: string
          p_operation_id: string
          p_pharmacy_id: string
        }
        Returns: string
      }
      observe_phif_order_receipts: {
        Args: { p_actor_id: string; p_pharmacy_id: string; p_report: Json }
        Returns: undefined
      }
      phif_actual_canonical_unit: { Args: { p_value: string }; Returns: string }
      register_gateway_device_with_code: {
        Args: { _code_hash: string; _device_name: string; _fcm_token?: string }
        Returns: Json
      }
      replace_phif_stock_snapshots: {
        Args: { p_items: Json; p_pharmacy_id: string; p_sync_run_id: string }
        Returns: number
      }
      set_phif_actual_identity_link: {
        Args: {
          p_actor: string
          p_expected_members: Json
          p_identity: string
          p_item_id: string
          p_pharmacy_id: string
          p_revoke?: boolean
          p_signature: string
          p_target_id: string
          p_user_id: string
        }
        Returns: Json
      }
      set_phif_actual_stock_link: {
        Args: {
          p_actor: string
          p_expected_version: number
          p_item_id: string
          p_pharmacy_id: string
          p_revoke?: boolean
          p_signature: string
          p_target_id: string
          p_user_id: string
        }
        Returns: {
          created_at: string
          id: string
          is_active: boolean
          pharmacy_id: string
          phif_invoice_item_id: string
          source_identity: string | null
          source_signature: string
          target_stock_item_id: string
          updated_actor: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "phif_actual_stock_links"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_phif_actual_units: {
        Args: {
          p_actor: string
          p_cost_unit: string
          p_dispensing_unit: string
          p_pharmacy_id: string
          p_revoke?: boolean
          p_rows: Json
          p_user_id: string
        }
        Returns: number
      }
      set_phif_medication_follow_up: {
        Args: {
          p_identity_key: string
          p_invoice_ids: string[]
          p_is_stopped: boolean
          p_patient_id: string
          p_pharmacy_id: string
          p_reason: string
        }
        Returns: undefined
      }
      set_phif_order_receipt_date: {
        Args: {
          p_actor_id: string
          p_expected_version: number
          p_line_id: string
          p_order_id: string
          p_pharmacy_id: string
          p_received_on: string
        }
        Returns: Json
      }
      set_phif_report_box_setting: {
        Args: {
          p_actor_id: string
          p_base_unit: string
          p_expected_version: number
          p_identity: string
          p_pharmacy_id: string
          p_units_per_box: number
        }
        Returns: Json
      }
      set_phif_report_supplier_unit: {
        Args: {
          p_actor_id: string
          p_exceptions: Json
          p_expected_version: number
          p_identity: string
          p_pharmacy_id: string
          p_unit: string
        }
        Returns: Json
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
