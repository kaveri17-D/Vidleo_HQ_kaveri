-- 009_proxy_daily_rollups.sql

CREATE TABLE IF NOT EXISTS public.proxy_daily_rollups (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    rollup_date date NOT NULL DEFAULT CURRENT_DATE,
    provider_name text NOT NULL,
    
    total_probes integer DEFAULT 0,
    successful_probes integer DEFAULT 0,
    failed_probes integer DEFAULT 0,
    burn_events integer DEFAULT 0,
    
    -- We store the exact cost calculated at that moment in time
    estimated_cost_usd numeric(10, 4) DEFAULT 0.0000, 
    
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    
    -- Ensure we only have one row per provider, per day
    UNIQUE(rollup_date, provider_name)
);

-- SaaS Security Standard
ALTER TABLE public.proxy_daily_rollups ENABLE ROW LEVEL SECURITY;
