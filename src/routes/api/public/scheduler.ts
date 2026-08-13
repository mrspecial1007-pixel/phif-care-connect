import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/public/scheduler')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = request.headers.get('X-Scheduler-Secret');
        const expectedSecret = process.env['SCHEDULER_SECRET'];

        if (!secret || secret !== expectedSecret) {
          return new Response('Unauthorized', { status: 401 });
        }

        const { processScheduledNotifications } = await import('@/lib/notifications/scheduler.server');
        try {
          const result = await processScheduledNotifications();
          return Response.json({
            message: 'Scheduler executed',
            ...result
          });
        } catch (error: any) {
          console.error('Scheduler error:', error);
          return Response.json({ error: 'Internal Server Error' }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        const secret = request.headers.get('X-Scheduler-Secret');
        const expectedSecret = process.env['SCHEDULER_SECRET'];

        if (!secret || secret !== expectedSecret) {
          return new Response('Unauthorized', { status: 401 });
        }

        const { processScheduledNotifications } = await import('@/lib/notifications/scheduler.server');
        try {
          const result = await processScheduledNotifications();
          return Response.json({
            message: 'Scheduler executed',
            ...result
          });
        } catch (error: any) {
          console.error('Scheduler error:', error);
          return Response.json({ error: 'Internal Server Error' }, { status: 500 });
        }
      }
    }
  }
});
