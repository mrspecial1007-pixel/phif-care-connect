import { createServerFn } from "@tanstack/react-start";

export const runNotificationScheduler = createServerFn({ method: "POST" })
  .handler(async () => {
    // This function would be called by a cron job
    // We'll implement the logic to check all active subscriptions and send notifications
    const { processScheduledNotifications } = await import("./scheduler.server");
    await processScheduledNotifications();
    return { ok: true };
  });
