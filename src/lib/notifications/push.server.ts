import webpush from 'web-push';

const publicVapidKey = process.env['VAPID_PUBLIC_KEY'] || 'BDpNHZ8PR7jNQlQqZ9ttKvlr6sMnPEqIbF2il9jtH-9jYFy5xIlmgTOITnxde6sDryRp79lQb25F9VRJ9UPme3s';
const privateVapidKey = process.env['VAPID_PRIVATE_KEY'] || 'dOIokTloUA4OPFn4jLbRI5Cb6RvTARUkMc53j516Z2A';

if (publicVapidKey && privateVapidKey) {
  webpush.setVapidDetails(
    'mailto:support@phif-tracker.lovable.app',
    publicVapidKey,
    privateVapidKey
  );
}

export async function pushNotification(subscription: any, payload: { title: string; body: string; data?: any; icon?: string }) {
  if (!privateVapidKey) {
    console.warn('VAPID_PRIVATE_KEY not set. Push notification skipped.');
    return;
  }
  
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
  } catch (error: any) {
    if (error.statusCode === 404 || error.statusCode === 410) {
      console.log('Subscription expired or removed:', error.statusCode);
    } else {
      console.error('Error sending push notification:', error);
    }
  }
}
