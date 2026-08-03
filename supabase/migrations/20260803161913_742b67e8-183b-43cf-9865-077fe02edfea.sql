REVOKE ALL ON public.agent_commands, public.agent_status, public.balances, public.bet_logs,
  public.bet_sessions, public.bookmaker_accounts, public.engine_runs, public.live_events,
  public.master_fixtures, public.notifications, public.risk_settings, public.settlements,
  public.user_roles, public.arbs FROM anon;

GRANT SELECT ON public.arbs TO authenticated;
GRANT UPDATE ON public.arbs TO authenticated;
GRANT ALL ON public.arbs TO service_role;
