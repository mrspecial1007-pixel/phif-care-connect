import { createFileRoute } from '@tanstack/react-router'
import { registerGatewayDevice } from '@/lib/sms-gateway.functions'

export const Route = createFileRoute('/api/public/gateway/register')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json()
          // Ensure pairingCode is provided since registration is now public
          if (!body.pairingCode) {
            return new Response(JSON.stringify({ error: 'Pairing code is required' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            })
          }
          
          const result = await registerGatewayDevice({ data: body })
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        } catch (error: any) {
          // Pass through the specific error message from the handler
          return new Response(JSON.stringify({ error: error.message || 'Registration failed' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          })
        }
      }
    }
  }
})