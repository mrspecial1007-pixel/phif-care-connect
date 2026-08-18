import { createFileRoute } from '@tanstack/react-router'
import { claimSmsJobs } from '@/lib/sms-gateway.functions'

export const Route = createFileRoute('/api/public/gateway/jobs')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const deviceId = request.headers.get('X-Gateway-ID')
          const deviceToken = request.headers.get('X-Gateway-Token')
          
          if (!deviceId || !deviceToken) {
            return new Response('Missing credentials', { status: 401 })
          }

          const result = await claimSmsJobs({ 
            data: { deviceId, deviceToken } 
          })

          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          })
        }
      }
    }
  }
})
