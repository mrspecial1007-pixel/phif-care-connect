import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { pushNotification } from "./push.server";

export async function processScheduledNotifications() {
  const now = new Date();
  const currentHour = now.getHours().toString().padStart(2, '0');
  const currentMinute = now.getMinutes().toString().padStart(2, '0');
  const currentTime = `${currentHour}:${currentMinute}:00`;
  const today = now.toISOString().split('T')[0];

  // 1. Get all active subscriptions that are enabled
  const { data: subscriptions } = await (supabaseAdmin as any)
    .from("push_subscriptions")
    .select("*")
    .eq("notifications_enabled", true)
    .eq("is_active", true);

  if (!subscriptions || subscriptions.length === 0) return;

  // 2. Load operational data for counts
  // We need counts for: due today, due tomorrow, overdue 1-2, partial
  const { data: beneficiaries } = await (supabaseAdmin as any)
    .from("v_patient_status")
    .select("patient_id, next_due_date, remaining_days, is_archived, is_follow_up_suspended, active_tracks")
    .eq("is_archived", false)
    .eq("is_follow_up_suspended", false);

  if (!beneficiaries) return;

  const dueToday = beneficiaries.filter((b: any) => b.remaining_days === 0).length;
  const dueTomorrow = beneficiaries.filter((b: any) => b.remaining_days === 1).length;
  const overdue12 = beneficiaries.filter((b: any) => b.remaining_days === -1 || b.remaining_days === -2).length;
  
  // Partial dispensing is inferred from active_tracks count > 1 or specific types
  // For simplicity here, we'll count those with multiple active tracks
  const partialCount = beneficiaries.filter((b: any) => (b.active_tracks?.length || 0) > 1).length;

  for (const sub of subscriptions) {
    // Check quiet hours
    if (sub.quiet_hours_enabled) {
      const start = sub.quiet_hours_start;
      const end = sub.quiet_hours_end;
      if (isTimeBetween(currentTime, start, end)) continue;
    }

    // Process each notification type
    await processType(sub, 'morning_summary', currentTime, today, {
      title: 'PHIF Tracker',
      body: `لديك ${dueToday} مستفيدًا مستحقين اليوم و${overdue12} متأخرين منذ يوم أو يومين.`,
      url: '/'
    });

    await processType(sub, 'due_today', currentTime, today, {
      title: 'مستحقون اليوم',
      body: `لديك ${dueToday} مستفيدًا موعد صرفهم اليوم.`,
      url: '/?filter=due_today'
    });

    await processType(sub, 'due_tomorrow', currentTime, today, {
      title: 'مستحقون غدًا',
      body: `لديك ${dueTomorrow} مستفيدين موعد صرفهم غدًا.`,
      url: '/?filter=due_tomorrow'
    });

    await processType(sub, 'overdue', currentTime, today, {
      title: 'متأخرون عن الصرف',
      body: `لديك ${overdue12} مستفيدين متأخرين عن موعد الصرف منذ يوم أو يومين.`,
      url: '/?filter=overdue'
    });

    await processType(sub, 'partial', currentTime, today, {
      title: 'صرف جزئي',
      body: `يوجد ${partialCount} مستفيدين لديهم صرف متبقي يحتاج متابعة.`,
      url: '/?filter=partial'
    });
  }
}

async function processType(sub: any, type: string, currentTime: string, today: string, payload: any) {
  const enabledKey = `${type}_enabled`;
  const timeKey = `${type}_time`;
  
  if (!sub[enabledKey]) return;
  
  // Match time (simple minute matching)
  const scheduledTime = sub[timeKey].slice(0, 5);
  if (scheduledTime !== currentTime.slice(0, 5)) return;

  // Check delivery log to avoid duplicates
  const { data: alreadySent } = await (supabaseAdmin as any)
    .from("notification_delivery_log")
    .select("id")
    .eq("subscription_id", sub.id)
    .eq("notification_type", type)
    .eq("delivery_date", today)
    .maybeSingle();

  if (alreadySent) return;

  // Send
  await pushNotification(sub.subscription_json, {
    title: payload.title,
    body: payload.body,
    data: { url: payload.url }
  });

  // Log delivery
  await (supabaseAdmin as any)
    .from("notification_delivery_log")
    .insert({
      subscription_id: sub.id,
      notification_type: type,
      delivery_date: today
    });
}

function isTimeBetween(current: string, start: string, end: string) {
  if (start < end) {
    return current >= start && current <= end;
  } else {
    // Over midnight
    return current >= start || current <= end;
  }
}
