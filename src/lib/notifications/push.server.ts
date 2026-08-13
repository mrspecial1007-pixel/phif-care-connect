import webpush from 'web-push';

const publicVapidKey = process.env['VAPID_PUBLIC_KEY'] || 'BCR5TfX7E8Jk0kH0gZ9_6mB2q5p5L9yX5TjX7E8Jk0kH0gZ9_6mB2q5p5L9yX5Tj'; // Placeholders
const privateVapidKey = process.env['VAPID_PRIVATE_KEY'];

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
      // We could mark as inactive here if we had the ID
    } else {
      console.error('Error sending push notification:', error);
    }
  }
}
