import { createFileRoute } from '@tanstack/react-router'
import { registerGatewayDevice } from '@/lib/sms-gateway.functions'

export const Route = createFileRoute('/api/public/gateway/register')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json()
          const result = await registerGatewayDevice({ data: body })
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
