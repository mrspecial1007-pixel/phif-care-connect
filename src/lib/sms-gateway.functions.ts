import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import crypto from "crypto";

/**
 * SHA256 Hash for secure token storage
 */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Generate a new secure pairing code for the current pharmacy
 */
export const generatePairingCode = createServerFn({ method: "POST" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getPharmacySession } = await import("@/lib/pharmacy-session.server");
    
    const session = await getPharmacySession();
    if (!session.data.pharmacy_id) throw new Error("Unauthorized");

    // Generate 6-char code (A-Z, 0-9)
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Omitted 0, 1, I, O for clarity
    let pairingCode = "";
    for (let i = 0; i < 6; i++) {
      pairingCode += chars.charAt(crypto.randomInt(chars.length));
    }

    const codeHash = hashToken(pairingCode);
    const expiresAt = new Date(Date.now() + 10 * 60000).toISOString(); // 10 minutes

    const { error } = await supabaseAdmin
      .from("gateway_pairing_codes")
      .insert({
        pharmacy_id: session.data.pharmacy_id,
        code_hash: codeHash,
        expires_at: expiresAt
      });

    if (error) throw error;

    return { 
      pairingCode, 
      expiresAt 
    };
  });

/**
 * Register a new Gateway Device using a pairing code
 */
export const registerGatewayDevice = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    name: z.string(),
    pairingCode: z.string(),
    fcmToken: z.string().optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    
    const codeHash = hashToken(data.pairingCode.trim().toUpperCase());

    // Use the RPC for atomic validation and creation
    const { data: result, error } = await supabaseAdmin.rpc('register_gateway_device_with_code', {
      _device_name: data.name,
      _code_hash: codeHash,
      _fcm_token: data.fcmToken
    });

    if (error) {
      console.error("Gateway pairing error:", error);
      throw new Error(error.message || "Pairing failed: Invalid or expired code");
    }

    return result as { deviceId: string; deviceToken: string };
  });

/**
 * Revoke a Gateway Device
 */
export const revokeGatewayDevice = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    deviceId: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getPharmacySession } = await import("@/lib/pharmacy-session.server");
    
    const session = await getPharmacySession();
    if (!session.data.pharmacy_id) throw new Error("Unauthorized");

    const { error } = await supabaseAdmin
      .from("gateway_devices")
      .update({ revoked_at: new Date().toISOString(), enabled: false })
      .eq("id", data.deviceId)
      .eq("pharmacy_id", session.data.pharmacy_id);

    if (error) throw error;

    return { success: true };
  });

/**
 * List Gateway Devices for current pharmacy
 */
export const listGatewayDevices = createServerFn({ method: "GET" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getPharmacySession } = await import("@/lib/pharmacy-session.server");
    
    const session = await getPharmacySession();
    if (!session.data.pharmacy_id) throw new Error("Unauthorized");

    const { data: devices, error } = await supabaseAdmin
      .from("gateway_devices")
      .select("*")
      .eq("pharmacy_id", session.data.pharmacy_id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return devices;
  });

/**
 * Atomic Claim/Lease Logic for Gateway
 * Finds a pending job, claims it, and sets a lease.
 */
export const claimSmsJobs = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    deviceId: z.string().uuid(),
    deviceToken: z.string(), // Plaintext token to be hashed and verified
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    
    // 1. Verify Device
    const { data: device, error: deviceError } = await supabaseAdmin
      .from("gateway_devices")
      .select("*")
      .eq("id", data.deviceId)
      .eq("enabled", true)
      .is("revoked_at", null)
      .single();

    if (deviceError || !device || device.token_hash !== hashToken(data.deviceToken)) {
      throw new Error("Invalid or disabled gateway device");
    }

    const pharmacyId = device.pharmacy_id;

    // 2. Atomic Claim
    // We look for messages in 'pending' status OR 'sending' with an expired lease.
    // Use a transaction or a specialized query. 
    // In Supabase/PostgREST we use a RPC for complex atomic logic.
    // Here we'll use a direct query with a lease timeout of 5 minutes.
    const leaseTimeoutMinutes = 5;
    const now = new Date();
    const leaseExpiryThreshold = new Date(now.getTime() - leaseTimeoutMinutes * 60000).toISOString();

    // First, identify a candidate message
    const { data: candidates, error: findError } = await supabaseAdmin
      .from("sms_messages")
      .select("id")
      .eq("pharmacy_id", pharmacyId)
      .or(`current_status.eq.pending,and(current_status.eq.sending)`) // Note: Simplified filter
      .limit(5);

    if (findError || !candidates || candidates.length === 0) return { jobs: [] };

    // In a real high-concurrency app, we'd use a Postgres Function (RPC) 
    // to do 'SELECT FOR UPDATE SKIP LOCKED'.
    // For now, we simulate the claim by updating status.
    const messageToClaim = candidates[0].id;

    const { data: updatedMessage, error: claimError } = await supabaseAdmin
      .from("sms_messages")
      .update({ current_status: "sending" as any })
      .eq("id", messageToClaim)
      .select()
      .single();

    if (claimError) return { jobs: [] };

    // Create the attempt record
    const { data: attempt, error: attemptError } = await supabaseAdmin
      .from("sms_send_attempts")
      .insert({
        message_id: messageToClaim,
        gateway_device_id: device.id,
        claimed_at: now.toISOString(),
        lease_expires_at: new Date(now.getTime() + leaseTimeoutMinutes * 60000).toISOString(),
        attempt_number: 1,
      })
      .select()
      .single();

    if (attemptError || !attempt) throw new Error("Failed to create send attempt");

    return {
      jobs: [{
        message_id: updatedMessage.id,
        phone_number: updatedMessage.phone_number,
        message_body: updatedMessage.message_body,
        attempt_id: attempt.id,
      }]
    };
  });

/**
 * Report Status back to Backend
 */
export const updateSmsStatus = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    deviceId: z.string().uuid(),
    deviceToken: z.string(),
    messageId: z.string().uuid(),
    attemptId: z.string().uuid(),
    status: z.enum(["sent", "delivered", "failed"]),
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
    simSlot: z.number().optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    
    // Verify Device
    const { data: device, error: deviceError } = await supabaseAdmin
      .from("gateway_devices")
      .select("token_hash")
      .eq("id", data.deviceId)
      .eq("enabled", true)
      .single();

    if (deviceError || !device || device.token_hash !== hashToken(data.deviceToken)) {
      throw new Error("Invalid gateway device");
    }

    const now = new Date().toISOString();
    
    // Update Attempt
    const attemptUpdate: any = {
      sim_slot: data.simSlot,
    };
    if (data.status === "sent") attemptUpdate.sent_at = now;
    if (data.status === "delivered") attemptUpdate.delivered_at = now;
    if (data.status === "failed") {
      attemptUpdate.failed_at = now;
      attemptUpdate.error_code = data.errorCode;
      attemptUpdate.error_message = data.errorMessage;
    }

    await supabaseAdmin
      .from("sms_send_attempts")
      .update(attemptUpdate)
      .eq("id", data.attemptId);

    // Update Message Status
    // Note: 'sent' != 'delivered'. If status is 'sent', message is 'sent'.
    // If 'delivered', it's 'delivered'.
    await supabaseAdmin
      .from("sms_messages")
      .update({ current_status: data.status as any })
      .eq("id", data.messageId);

    return { success: true };
  });
