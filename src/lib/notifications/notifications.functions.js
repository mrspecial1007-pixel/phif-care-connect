import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
const subscriptionSchema = z.object({
    subscription: z.any(),
    userAgent: z.string().optional(),
});
export const saveSubscription = createServerFn({ method: "POST" })
    .inputValidator((d) => subscriptionSchema.parse(d))
    .handler(async ({ data }) => {
    const { getPharmacySession } = await import("@/lib/pharmacy-session.server");
    const session = await getPharmacySession();
    if (!session.data.pharmacy_id)
        throw new Error("Unauthorized");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing, error: searchError } = await supabaseAdmin
        .from("push_subscriptions")
        .select("id")
        .eq("pharmacy_id", session.data.pharmacy_id)
        .eq("subscription_json", data.subscription)
        .maybeSingle();
    if (searchError)
        throw searchError;
    if (existing) {
        await supabaseAdmin
            .from("push_subscriptions")
            .update({ is_active: true, user_agent: data.userAgent, updated_at: new Date().toISOString() })
            .eq("id", existing.id);
        return { ok: true, id: existing.id };
    }
    const { data: inserted, error: insertError } = await supabaseAdmin
        .from("push_subscriptions")
        .insert({
        pharmacy_id: session.data.pharmacy_id,
        subscription_json: data.subscription,
        user_agent: data.userAgent,
        notifications_enabled: true,
    })
        .select("id")
        .single();
    if (insertError)
        throw insertError;
    return { ok: true, id: inserted.id };
});
export const getSubscriptionSettings = createServerFn({ method: "GET" })
    .inputValidator((d) => z.object({ subscriptionId: z.string().uuid() }).parse(d))
    .handler(async ({ data }) => {
    const { getPharmacySession } = await import("@/lib/pharmacy-session.server");
    const session = await getPharmacySession();
    if (!session.data.pharmacy_id)
        throw new Error("Unauthorized");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: settings, error } = await supabaseAdmin
        .from("push_subscriptions")
        .select("*")
        .eq("id", data.subscriptionId)
        .eq("pharmacy_id", session.data.pharmacy_id)
        .single();
    if (error)
        throw error;
    return settings;
});
export const updateSubscriptionSettings = createServerFn({ method: "POST" })
    .inputValidator((d) => z.object({
    id: z.string().uuid(),
    settings: z.record(z.any())
}).parse(d))
    .handler(async ({ data }) => {
    const { getPharmacySession } = await import("@/lib/pharmacy-session.server");
    const session = await getPharmacySession();
    if (!session.data.pharmacy_id)
        throw new Error("Unauthorized");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
        .from("push_subscriptions")
        .update({
        ...data.settings,
        updated_at: new Date().toISOString()
    })
        .eq("id", data.id)
        .eq("pharmacy_id", session.data.pharmacy_id);
    if (error)
        throw error;
    return { ok: true };
});
export const deleteSubscription = createServerFn({ method: "POST" })
    .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
    .handler(async ({ data }) => {
    const { getPharmacySession } = await import("@/lib/pharmacy-session.server");
    const session = await getPharmacySession();
    if (!session.data.pharmacy_id)
        throw new Error("Unauthorized");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
        .from("push_subscriptions")
        .delete()
        .eq("id", data.id)
        .eq("pharmacy_id", session.data.pharmacy_id);
    if (error)
        throw error;
    return { ok: true };
});
export const sendTestNotification = createServerFn({ method: "POST" })
    .inputValidator((d) => z.object({ subscriptionId: z.string().uuid() }).parse(d))
    .handler(async ({ data }) => {
    const { getPharmacySession } = await import("@/lib/pharmacy-session.server");
    const session = await getPharmacySession();
    if (!session.data.pharmacy_id)
        throw new Error("Unauthorized");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sub } = await supabaseAdmin
        .from("push_subscriptions")
        .select("*")
        .eq("id", data.subscriptionId)
        .single();
    if (!sub)
        throw new Error("Subscription not found");
    const { pushNotification } = await import("./push.server");
    await pushNotification(sub.subscription_json, {
        title: "PHIF Tracker",
        body: "تم تفعيل إشعارات الهاتف بنجاح.",
        data: { url: "/settings" }
    });
    return { ok: true };
});
