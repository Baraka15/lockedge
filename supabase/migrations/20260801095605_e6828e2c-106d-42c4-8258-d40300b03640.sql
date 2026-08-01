GRANT SELECT, UPDATE ON public.arbs TO anon;
CREATE POLICY "Anon read arbs" ON public.arbs FOR SELECT TO anon USING (true);
CREATE POLICY "Anon ack arbs" ON public.arbs FOR UPDATE TO anon USING (is_acknowledged = false) WITH CHECK (true);