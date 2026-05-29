
DROP POLICY "Authenticated ack arbs" ON public.arbs;
CREATE POLICY "Authenticated ack arbs" ON public.arbs
  FOR UPDATE TO authenticated
  USING (is_acknowledged = false)
  WITH CHECK (is_acknowledged = true);
