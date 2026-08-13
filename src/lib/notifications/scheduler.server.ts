import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { pushNotification } from "./push.server";

export async function processScheduledNotifications() {
  // Use Libya timezone (UTC+2)
  const now = new Date();
  const libyaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Tripoli' }));
  
  const currentHour = libyaTime.getHours().toString().padStart(2, '0');
  const currentMinute = libyaTime.getMinutes().toString().padStart(2, '0');
  const currentTime = `${currentHour}:${currentMinute}:00`;
  const today = libyaTime.toISOString().split('T')[0];

  let subscriptionsChecked = 0;
  let notificationsSent = 0;
  let duplicatesSkipped = 0;

  // 1. Get all active subscriptions that are enabled
  const { data: subscriptions } = await (supabaseAdmin as any)
    .from("push_subscriptions")
    .select("*")
    .eq("notifications_enabled", true)
    .eq("is_active", true);

  if (!subscriptions || subscriptions.length === 0) {
    return { subscriptionsChecked: 0, notificationsSent: 0, duplicatesSkipped: 0 };
  }

  subscriptionsChecked = subscriptions.length;

  // 2. Load operational data for counts
  // We need counts for: due today, due tomorrow, overdue 1-2, partial
  // Excluding archived, suspended, and "Old Follow-up" (> 50 days)
  const { data: beneficiaries } = await (supabaseAdmin as any)
    .from("v_patient_status")
    .select("patient_id, next_due_date, remaining_days, is_archived, is_follow_up_suspended, active_tracks")
    .eq("is_archived", false)
    .eq("is_follow_up_suspended", false)
    .gte("remaining_days", -50);

  if (!beneficiaries) {
    return { subscriptionsChecked, notificationsSent: 0, duplicatesSkipped: 0 };
  }

  const dueToday = beneficiaries.filter((b: any) => b.remaining_days === 0).length;
  const dueTomorrow = beneficiaries.filter((b: any) => b.remaining_days === 1).length;
  const overdue12 = beneficiaries.filter((b: any) => b.remaining_days === -1 || b.remaining_days === -2).length;
  const partialCount = beneficiaries.filter((b: any) => (b.active_tracks?.length || 0) > 1).length;

  for (const sub of subscriptions) {
    // Check quiet hours
    if (sub.quiet_hours_enabled) {
      const start = sub.quiet_hours_start;
      const end = sub.quiet_hours_end;
      if (isTimeBetween(currentTime, start, end)) continue;
    }

    const tasks = [
      {
        type: 'morning_summary',
        payload: {
          title: 'PHIF Tracker',
          body: `لديك ${dueToday} مستفيدًا مستحقين اليوم و${overdue12} متأخرين منذ يوم أو يومين.`,
          url: '/'
        }
      },
      {
        type: 'due_today',
        payload: {
          title: 'مستحقون اليوم',
          body: `لديك ${dueToday} مستفيدًا موعد صرفهم اليوم.`,
          url: '/?filter=due_today'
        }
      },
      {
        type: 'due_tomorrow',
        payload: {
          title: 'مستحقون غدًا',
          body: `لديك ${dueTomorrow} مستفيدين موعد صرفهم غدًا.`,
          url: '/?filter=due_tomorrow'
        }
      },
      {
        type: 'overdue',
        payload: {
          title: 'متأخرون عن الصرف',
          body: `لديك ${overdue12} مستفيدين متأخرين عن موعد الصرف منذ يوم أو يومين.`,
          url: '/?filter=overdue'
        }
      },
      {
        type: 'partial',
        payload: {
          title: 'صرف جزئي',
          body: `يوجد ${partialCount} مستفيدين لديهم صرف متبقي يحتاج متابعة.`,
          url: '/?filter=partial'
        }
      }
    ];

    for (const task of tasks) {
      const result = await processType(sub, task.type, currentTime, today, task.payload);
      if (result === 'sent') notificationsSent++;
      else if (result === 'skipped') duplicatesSkipped++;
    }
  }

  return { subscriptionsChecked, notificationsSent, duplicatesSkipped };
}

async function processType(sub: any, type: string, currentTime: string, today: string, payload: any) {
  const enabledKey = `${type}_enabled`;
  const timeKey = `${type}_time`;
  
  if (!sub[enabledKey]) return 'disabled';
  
  // Scheduled time from DB (HH:mm:ss or HH:mm)
  const scheduledTime = sub[timeKey].slice(0, 5);
  const currentHHmm = currentTime.slice(0, 5);
  
  // If we're exactly at the minute or within a 15-minute window after (for reliability)
  // we check if it was already delivered today.
  const [schedH, schedM] = scheduledTime.split(':').map(Number);
  const [currH, currM] = currentHHmm.split(':').map(Number);
  
  const schedMinutes = schedH * 60 + schedM;
  const currMinutes = currH * 60 + currM;
  
  // Allow a 15-minute window for the cron to pick it up
  if (currMinutes < schedMinutes || currMinutes > schedMinutes + 15) {
    return 'out_of_window';
  }

  // Check delivery log to avoid duplicates (idempotency)
  const { data: alreadySent } = await (supabaseAdmin as any)
    .from("notification_delivery_log")
    .select("id")
    .eq("subscription_id", sub.id)
    .eq("notification_type", type)
    .eq("delivery_date", today)
    .maybeSingle();

  if (alreadySent) return 'skipped';

  // Send
  try {
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
      
    return 'sent';
  } catch (err) {
    console.error(`Failed to send ${type} notification to sub ${sub.id}:`, err);
    return 'error';
  }
}

function isTimeBetween(current: string, start: string, end: string) {
  if (start < end) {
    return current >= start && current <= end;
  } else {
    // Over midnight
    return current >= start || current <= end;
  }
}
