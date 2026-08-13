import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/public/scheduler')({
  server: {
    handlers: {
      GET: async () => {
        const { processScheduledNotifications } = await import('@/lib/notifications/scheduler.server');
        try {
          await processScheduledNotifications();
          return new Response('Notifications processed successfully', { status: 200 });
        } catch (error: any) {
          console.error('Scheduler error:', error);
          return new Response('Internal Server Error', { status: 500 });
        }
      },
      POST: async () => {
        const { processScheduledNotifications } = await import('@/lib/notifications/scheduler.server');
        try {
          await processScheduledNotifications();
          return new Response('Notifications processed successfully', { status: 200 });
        } catch (error: any) {
          console.error('Scheduler error:', error);
          return new Response('Internal Server Error', { status: 500 });
        }
      }
    }
  }
});
