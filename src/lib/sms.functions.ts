import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import crypto from "crypto";

// Schema for creating an SMS request
const sendSmsSchema = z.object({
  patientId: z.string().uuid(),
  phoneNumber: z.string(),
  messageBody: z.string(),
  idempotencyKey: z.string(),
});

export const sendSmsRequest = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => sendSmsSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getPharmacySession } = await import("@/lib/pharmacy-session.server");
    const { writeAudit } = await import("@/lib/audit.server");
    
    const session = await getPharmacySession();
    if (!session.data.pharmacy_id) {
      throw new Error("Unauthorized: No active pharmacy session");
    }

    const pharmacyId = session.data.pharmacy_id;

    // Backend Idempotency: Insert logical message
    // If it exists, it returns the existing row.
    const { data: message, error: insertError } = await supabaseAdmin
      .from("sms_messages")
      .upsert(
        {
          patient_id: data.patientId,
          pharmacy_id: pharmacyId,
          phone_number: data.phoneNumber,
          message_body: data.messageBody,
          idempotency_key: data.idempotencyKey,
          created_by: pharmacyId,
          current_status: "pending" as any, // Only creating records via Gateway intent
        },
        { onConflict: "pharmacy_id, idempotency_key" }
      )
      .select()
      .single();

    if (insertError) {
      console.error("SMS Insert Error:", insertError);
      throw new Error("Failed to queue SMS message");
    }

    await writeAudit({
      pharmacy_id: pharmacyId,
      action: "sms_queued",
      entity: "sms_message",
      entity_id: message.id,
      after: { status: "pending", phone: data.phoneNumber },
    });

    // TODO: In a real implementation, trigger FCM wake signal here
    
    return { success: true, messageId: message.id };
  });

export const getSmsHistory = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ 
    patientId: z.string().uuid().optional(),
    status: z.string().optional(),
    limit: z.number().default(50)
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getPharmacySession } = await import("@/lib/pharmacy-session.server");
    
    const session = await getPharmacySession();
    if (!session.data.pharmacy_id) throw new Error("Unauthorized");

    let query = supabaseAdmin
      .from("sms_messages")
      .select(`
        *,
        patients (patient_name),
        sms_send_attempts (*)
      `)
      .eq("pharmacy_id", session.data.pharmacy_id)
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.patientId) query = query.eq("patient_id", data.patientId);
    if (data.status) query = query.eq("current_status", data.status as any);

    const { data: history, error } = await query;
    if (error) throw error;
    
    return history;
  });
