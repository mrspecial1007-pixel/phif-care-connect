CREATE TABLE public.push_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id uuid REFERENCES public.pharmacies(id) ON DELETE CASCADE NOT NULL,
    subscription_json jsonb NOT NULL,
    user_agent text,
    is_active boolean DEFAULT true,
    
    -- Settings
    notifications_enabled boolean DEFAULT true,
    morning_summary_enabled boolean DEFAULT true,
    morning_summary_time time DEFAULT '09:00',
    due_today_enabled boolean DEFAULT true,
    due_today_time time DEFAULT '09:00',
    due_tomorrow_enabled boolean DEFAULT true,
    due_tomorrow_time time DEFAULT '19:00',
    overdue_enabled boolean DEFAULT true,
    overdue_time time DEFAULT '10:00',
    partial_enabled boolean DEFAULT true,
    partial_time time DEFAULT '11:00',
    
    quiet_hours_enabled boolean DEFAULT false,
    quiet_hours_start time DEFAULT '23:00',
    quiet_hours_end time DEFAULT '07:00',
    
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    
    -- Ensure one record per subscription per pharmacy
    UNIQUE(pharmacy_id, subscription_json)
);

-- Delivery log to prevent duplicates
CREATE TABLE public.notification_delivery_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id uuid REFERENCES public.push_subscriptions(id) ON DELETE CASCADE NOT NULL,
    notification_type text NOT NULL,
    delivery_date date NOT NULL,
    created_at timestamptz DEFAULT now(),
    UNIQUE(subscription_id, notification_type, delivery_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

GRANT SELECT, INSERT ON public.notification_delivery_log TO authenticated;
GRANT ALL ON public.notification_delivery_log TO service_role;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_delivery_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Pharmacies can manage their own subscriptions"
ON public.push_subscriptions
FOR ALL
TO authenticated
USING (pharmacy_id IN (
    SELECT id FROM public.pharmacies -- In this app, auth is shared via PIN session, but we use 'authenticated' role for DB access
));

CREATE POLICY "Pharmacies can manage their own delivery logs"
ON public.notification_delivery_log
FOR ALL
TO authenticated
USING (subscription_id IN (
    SELECT id FROM public.push_subscriptions
));

