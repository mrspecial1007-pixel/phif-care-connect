import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const deleteOrArchiveSmsMessage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getPharmacySession } = await import("@/lib/pharmacy-session.server");
    
    const session = await getPharmacySession();
    if (!session.data.pharmacy_id) throw new Error("Unauthorized");

    // Get message
    const { data: msg, error: fetchError } = await supabaseAdmin
      .from("sms_messages")
      .select("*, sms_send_attempts(*)")
      .eq("id", data.id)
      .eq("pharmacy_id", session.data.pharmacy_id)
      .single();
    
    if (fetchError || !msg) throw new Error("Message not found or unauthorized");

    // 1. Handoff: Delete
    if (msg.current_status === "handoff") {
      await supabaseAdmin.from("sms_messages").delete().eq("id", data.id);
      return { action: "deleted" };
    }

    // 2. Sent/Delivered: Archive
    if (msg.current_status === "sent" || msg.current_status === "delivered") {
      await supabaseAdmin.from("sms_messages").update({ is_archived: true }).eq("id", data.id);
      return { action: "archived" };
    }

    // 3. Pending/Failed: Conditional Delete
    if (msg.current_status === "pending" || msg.current_status === "failed") {
      // Check for active lease
      const hasActiveLease = msg.sms_send_attempts.some((a: any) => 
        a.lease_expires_at && new Date(a.lease_expires_at) > new Date()
      );
      
      if (hasActiveLease) {
        throw new Error("لا يمكن حذف الرسالة لأنها قيد المعالجة بواسطة جهاز الإرسال.");
      }

      // Safe to delete 
      await supabaseAdmin.from("sms_messages").delete().eq("id", data.id);
      return { action: "deleted" };
    }

    throw new Error("Status not supported for management");
  });
