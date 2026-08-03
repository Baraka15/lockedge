-- 1. Roles infrastructure
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','operator','user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own roles" ON public.user_roles;
CREATE POLICY "Users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_operator()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('admin','operator')
  );
$$;

-- Bootstrap the existing owner account as operator/admin
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users
ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'operator'::public.app_role FROM auth.users
ON CONFLICT (user_id, role) DO NOTHING;

-- 2. arbs: remove anonymous access
DROP POLICY IF EXISTS "Anon read arbs" ON public.arbs;
DROP POLICY IF EXISTS "Anon ack arbs" ON public.arbs;
DROP POLICY IF EXISTS "Authenticated read arbs" ON public.arbs;
DROP POLICY IF EXISTS "Authenticated ack arbs" ON public.arbs;
REVOKE ALL ON public.arbs FROM anon;
CREATE POLICY "Operators read arbs" ON public.arbs
  FOR SELECT TO authenticated USING (public.is_operator());
CREATE POLICY "Operators ack arbs" ON public.arbs
  FOR UPDATE TO authenticated
  USING (public.is_operator() AND is_acknowledged = false)
  WITH CHECK (public.is_operator() AND is_acknowledged = true);

-- 3. agent_commands: operators only
DROP POLICY IF EXISTS insert_agent_commands ON public.agent_commands;
DROP POLICY IF EXISTS read_agent_commands ON public.agent_commands;
CREATE POLICY "Operators insert agent commands" ON public.agent_commands
  FOR INSERT TO authenticated WITH CHECK (public.is_operator() AND created_by = auth.uid());
CREATE POLICY "Operators read agent commands" ON public.agent_commands
  FOR SELECT TO authenticated USING (public.is_operator());

-- 4. agent_status
DROP POLICY IF EXISTS read_agent_status ON public.agent_status;
CREATE POLICY "Operators read agent status" ON public.agent_status
  FOR SELECT TO authenticated USING (public.is_operator());

-- 5. Financial / operational tables: operators only
DROP POLICY IF EXISTS read_balances ON public.balances;
CREATE POLICY "Operators read balances" ON public.balances
  FOR SELECT TO authenticated USING (public.is_operator());

DROP POLICY IF EXISTS read_bet_logs ON public.bet_logs;
CREATE POLICY "Operators read bet logs" ON public.bet_logs
  FOR SELECT TO authenticated USING (public.is_operator());

DROP POLICY IF EXISTS "auth users read bet_sessions" ON public.bet_sessions;
DROP POLICY IF EXISTS "auth users write bet_sessions" ON public.bet_sessions;
CREATE POLICY "Operators manage bet sessions" ON public.bet_sessions
  FOR ALL TO authenticated USING (public.is_operator()) WITH CHECK (public.is_operator());

DROP POLICY IF EXISTS "auth read risk_settings" ON public.risk_settings;
DROP POLICY IF EXISTS "auth write risk_settings" ON public.risk_settings;
CREATE POLICY "Operators manage risk settings" ON public.risk_settings
  FOR ALL TO authenticated USING (public.is_operator()) WITH CHECK (public.is_operator());

DROP POLICY IF EXISTS "auth users read settlements" ON public.settlements;
DROP POLICY IF EXISTS "auth users write settlements" ON public.settlements;
CREATE POLICY "Operators manage settlements" ON public.settlements
  FOR ALL TO authenticated USING (public.is_operator()) WITH CHECK (public.is_operator());

DROP POLICY IF EXISTS "auth users read notifications" ON public.notifications;
DROP POLICY IF EXISTS "auth users write notifications" ON public.notifications;
CREATE POLICY "Operators manage notifications" ON public.notifications
  FOR ALL TO authenticated USING (public.is_operator()) WITH CHECK (public.is_operator());

DROP POLICY IF EXISTS "Authenticated read bookmakers" ON public.bookmaker_accounts;
CREATE POLICY "Operators read bookmakers" ON public.bookmaker_accounts
  FOR SELECT TO authenticated USING (public.is_operator());

-- 6. Internal diagnostics tables
DROP POLICY IF EXISTS "Authenticated read runs" ON public.engine_runs;
CREATE POLICY "Operators read engine runs" ON public.engine_runs
  FOR SELECT TO authenticated USING (public.is_operator());

DROP POLICY IF EXISTS "Authenticated read live events" ON public.live_events;
CREATE POLICY "Operators read live events" ON public.live_events
  FOR SELECT TO authenticated USING (public.is_operator());

DROP POLICY IF EXISTS "Authenticated read fixtures" ON public.master_fixtures;
CREATE POLICY "Operators read fixtures" ON public.master_fixtures
  FOR SELECT TO authenticated USING (public.is_operator());
