CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TABLE public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  code text NOT NULL,
  name text NOT NULL,
  market text NOT NULL,
  status text NOT NULL DEFAULT 'RESEARCH' CHECK (status IN ('RESEARCH','SHADOW','PROBATION','LIVE','HALTED')),
  budget_pct numeric(6,4) NOT NULL DEFAULT 0.25,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text NOT NULL DEFAULT '',
  edge_source text NOT NULL DEFAULT '',
  book_sources text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, code)
);

CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  broker text NOT NULL DEFAULT 'SIM',
  currency text NOT NULL DEFAULT 'USD',
  starting_equity numeric(18,8) NOT NULL,
  equity numeric(18,8) NOT NULL,
  high_water_mark numeric(18,8) NOT NULL,
  floor numeric(18,8) NOT NULL,
  cushion numeric(18,8) NOT NULL,
  realized_pnl numeric(18,8) NOT NULL DEFAULT 0,
  unrealized_pnl numeric(18,8) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  side text NOT NULL CHECK (side IN ('LONG','SHORT')),
  qty numeric(18,8) NOT NULL,
  entry_px numeric(18,8) NOT NULL,
  stop_px numeric(18,8) NOT NULL,
  target_px numeric(18,8),
  risk_at_stop numeric(18,8) NOT NULL,
  opened_at timestamptz NOT NULL,
  time_stop_at timestamptz,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  client_order_id text NOT NULL,
  symbol text NOT NULL,
  side text NOT NULL,
  type text NOT NULL,
  qty numeric(18,8) NOT NULL,
  limit_px numeric(18,8),
  stop_px numeric(18,8),
  target_px numeric(18,8),
  tif text NOT NULL DEFAULT 'GTD',
  expires_at timestamptz,
  decision_px numeric(18,8),
  arrival_mid numeric(18,8),
  submitted_at timestamptz NOT NULL,
  state text NOT NULL,
  reject_reason text,
  fill_px numeric(18,8),
  filled_qty numeric(18,8),
  filled_at timestamptz,
  horizon_px numeric(18,8),
  spread_at_submit numeric(12,8),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, client_order_id)
);

CREATE TABLE public.trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  client_order_id text,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  side text NOT NULL,
  qty numeric(18,8) NOT NULL,
  entry_px numeric(18,8) NOT NULL,
  exit_px numeric(18,8) NOT NULL,
  stop_px numeric(18,8) NOT NULL,
  target_px numeric(18,8),
  opened_at timestamptz NOT NULL,
  closed_at timestamptz NOT NULL,
  hold_seconds int NOT NULL,
  gross_pnl numeric(18,8) NOT NULL,
  spread_cost numeric(18,8) NOT NULL,
  commission_cost numeric(18,8) NOT NULL,
  slippage_cost numeric(18,8) NOT NULL,
  swap_cost numeric(18,8) NOT NULL,
  net_pnl numeric(18,8) NOT NULL,
  r_multiple numeric(10,4) NOT NULL,
  exit_reason text NOT NULL,
  mae_px numeric(18,8),
  mfe_px numeric(18,8),
  decision_px numeric(18,8),
  arrival_mid numeric(18,8),
  horizon_px numeric(18,8),
  delay_cost numeric(18,8) NOT NULL DEFAULT 0,
  execution_cost numeric(18,8) NOT NULL DEFAULT 0,
  missed_fill_cost numeric(18,8) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.gateway_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  client_order_id text NOT NULL,
  agent_code text NOT NULL,
  seq int NOT NULL,
  "check" text NOT NULL,
  result text NOT NULL CHECK (result IN ('PASS','FAIL')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.equity_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL,
  equity numeric(18,8) NOT NULL,
  high_water_mark numeric(18,8) NOT NULL,
  cushion numeric(18,8) NOT NULL,
  open_risk numeric(18,8) NOT NULL,
  gold_exposure numeric(8,4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.report_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  return_pct numeric(10,4), volatility_pct numeric(10,4), pct_positive_months numeric(6,4),
  best_month_pct numeric(10,4), worst_month_pct numeric(10,4), skew numeric(10,4), kurtosis numeric(10,4),
  max_dd_pct numeric(10,4), dd_duration_days int, dd_recovery_days int, var_95_pct numeric(10,4),
  cost_split jsonb NOT NULL DEFAULT '{}'::jsonb,
  alpha_vs_gold numeric(10,6), z_score numeric(10,4), budget_after_pct numeric(6,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.monte_carlo_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  seed bigint NOT NULL,
  n_trades int NOT NULL,
  n_runs int NOT NULL,
  win_rate numeric(6,4) NOT NULL,
  avg_win_pct numeric(10,6) NOT NULL,
  avg_loss_pct numeric(10,6) NOT NULL,
  tail_scenario text NOT NULL,
  median_max_dd_pct numeric(8,4), p95_max_dd_pct numeric(8,4), p99_max_dd_pct numeric(8,4),
  p_losing_month numeric(6,4),
  finished_at timestamptz,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.validation_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  step int NOT NULL CHECK (step BETWEEN 1 AND 10),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'LOCKED' CHECK (status IN ('LOCKED','IN_PROGRESS','PASSED','FAILED')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  artifact_hash text,
  signed_by text,
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, step)
);

CREATE TABLE public.overseer_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  ts timestamptz NOT NULL DEFAULT now(),
  agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  input jsonb NOT NULL,
  decision jsonb NOT NULL,
  model text NOT NULL,
  applied boolean NOT NULL DEFAULT false,
  audit_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  ts timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.price_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  dataset text NOT NULL,
  symbol text NOT NULL DEFAULT 'XAUUSD',
  ts timestamptz NOT NULL,
  bid numeric(18,8) NOT NULL,
  ask numeric(18,8) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX price_data_owner_dataset_ts ON public.price_data(owner_id, dataset, ts);

CREATE TABLE public.operator_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() UNIQUE,
  density text NOT NULL DEFAULT 'comfortable',
  theme text NOT NULL DEFAULT 'dark',
  kill_policy text NOT NULL DEFAULT 'immediate',
  kill_armed boolean NOT NULL DEFAULT false,
  sim_seed bigint NOT NULL DEFAULT 20261109,
  overseer_use_llm boolean NOT NULL DEFAULT false,
  live_adapter jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_limits jsonb NOT NULL DEFAULT '{"floorRatio":0.92,"maxRiskPctEquity":0.015,"cushionDivisorTrade":8,"cushionDivisorOpen":3,"dailyLossPct":0.02,"weeklyLossPct":0.04,"spreadMult":2,"weekendCutoffMin":30}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trades_owner_closed ON public.trades(owner_id, closed_at DESC);
CREATE INDEX orders_owner_submitted ON public.orders(owner_id, submitted_at DESC);
CREATE INDEX gateway_owner_occurred ON public.gateway_events(owner_id, occurred_at DESC);
CREATE INDEX equity_owner_ts ON public.equity_snapshots(owner_id, ts);
CREATE INDEX audit_owner_ts ON public.audit_log(owner_id, ts DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agents','accounts','positions','orders','trades','gateway_events','equity_snapshots','report_cards','monte_carlo_runs','validation_steps','overseer_decisions','audit_log','price_data','operator_settings'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (owner_id = auth.uid())', t || '_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid())', t || '_ins', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid())', t || '_upd', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (owner_id = auth.uid())', t || '_del', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', t || '_touch', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.seed_operator_workspace(_uid uuid, _seed bigint DEFAULT 20261109)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a record; aid uuid; s int;
  step_names text[] := ARRAY['Pre-register','Clean data','One codebase','Out-of-sample','Beat a random baseline','Honest statistics','Robustness','Simulation recovery','Shadow live','Probation'];
BEGIN
  IF EXISTS (SELECT 1 FROM public.agents WHERE owner_id = _uid) THEN RETURN; END IF;
  INSERT INTO public.operator_settings(owner_id, sim_seed) VALUES (_uid, _seed) ON CONFLICT (owner_id) DO UPDATE SET sim_seed = EXCLUDED.sim_seed;
  FOR a IN SELECT * FROM (VALUES
    ('G1','Gold Session-Liquidity Reversion','XAUUSD',
     'Fades clustered liquidity levels (prior-day, Asian session, H1 swings) with passive limits, only when the Lo–MacKinlay variance ratio says the market is ranging.',
     'Paid for supplying liquidity at levels where resting orders cluster, only in range regimes',
     ARRAY['Aldridge Ch6','Aldridge Ch7','Aldridge Ch10','Kissell Ch2','Kissell Ch11','Stefanini Ch6'],
     '{"values":{"q":4,"k":1.0,"targetRatio":0.8,"orderLifeMin":60,"timeStopH":6,"riskPct":0.0025,"zoneMergeAtr":0.25,"entryOffsetAtr":0.1,"vrSessions":10,"slopeMax":0.5,"costMultiple":4,"maxStopsPerSession":3,"spreadMult":2},"grid":{"q":[2,4,8],"k":[0.75,1.0,1.25,1.5],"targetRatio":[0.6,0.8,1.0],"orderLifeMin":[30,60,120],"timeStopH":[3,6,0],"riskPct":[0.001,0.0025,0.005]}}'::jsonb),
    ('G2','Gold Macro-Release Drift','XAUUSD',
     'Trades XAUUSD for up to an hour after US CPI and payrolls in the direction past surprises of the same sign moved gold, entering after the first-minute spike.',
     'Prices absorb scheduled surprises over minutes to hours, not instantly',
     ARRAY['Aldridge Ch12','DeFusco Ch7','Kissell Ch12'],
     '{"values":{"entryDelayMin":3,"minSurprise":1,"stopMult":1.5,"maxHoldMin":60,"riskPct":0.0025,"alpha":0.05,"spreadMult":2},"grid":{"minSurprise":[0.75,1.0,1.5],"stopMult":[1.0,1.5,2.0],"entryDelayMin":[1,3,5],"riskPct":[0.001,0.0025,0.005]}}'::jsonb),
    ('G3','Gold/Silver Spread Reversion','XAUUSD/XAGUSD',
     'Trades the XAU/XAG residual at two standard deviations while an Engle–Granger test says the pair is cointegrated; stands down the moment it fails.',
     'Temporary dislocation in a cointegrated pair',
     ARRAY['Aldridge Ch13','DeFusco Ch10','Stefanini Ch7','Stefanini Ch15'],
     '{"values":{"lookbackDays":500,"zEntry":2.0,"zExit":0.5,"zStop":3.5,"timeStopDays":5,"riskPct":0.005,"dxyR2Max":0.25,"zWindowDays":20},"grid":{"zEntry":[1.5,2.0,2.5],"zExit":[0.0,0.5,1.0],"zStop":[3.0,3.5,4.0],"zWindowDays":[10,20,40]}}'::jsonb),
    ('G4','Vol-Targeted Trend Sleeve','XAUUSD, NAS100, GBPJPY, BTCUSD, EURUSD',
     'Holds each market long or short by three moving-average horizons, sized for equal volatility, targeting 6% annualised portfolio volatility.',
     'Trend premium; long volatility, positive in crises',
     ARRAY['Stefanini Ch13','Stefanini Ch16','Aldridge Ch14'],
     '{"values":{"ma1":20,"ma2":50,"ma3":180,"targetVol":0.06,"band":0.25,"lossHalveMult":3,"universe":["XAUUSD","NAS100","GBPJPY","BTCUSD","EURUSD"]},"grid":{"ma1":[15,20,30],"ma3":[120,180,250],"targetVol":[0.04,0.06,0.08],"band":[0.1,0.25,0.4]}}'::jsonb)
  ) AS t(code,name,market,description,edge,sources,params)
  LOOP
    INSERT INTO public.agents(owner_id,code,name,market,status,budget_pct,params,description,edge_source,book_sources)
    VALUES (_uid,a.code,a.name,a.market,'RESEARCH',0.25,a.params,a.description,a.edge,a.sources) RETURNING id INTO aid;
    INSERT INTO public.accounts(owner_id,agent_id,broker,currency,starting_equity,equity,high_water_mark,floor,cushion)
    VALUES (_uid,aid,'SIM','USD',25000,25000,25000,23000,2000);
    FOR s IN 1..10 LOOP
      INSERT INTO public.validation_steps(owner_id,agent_id,step,name,status)
      VALUES (_uid,aid,s,step_names[s], CASE WHEN s=1 THEN 'IN_PROGRESS' ELSE 'LOCKED' END);
    END LOOP;
  END LOOP;
  INSERT INTO public.audit_log(owner_id,actor,action,entity,after)
  VALUES (_uid,'engine','WORKSPACE_SEEDED','workspace',jsonb_build_object('seed',_seed,'agents',4,'budget_each',0.25));
END $$;
REVOKE ALL ON FUNCTION public.seed_operator_workspace(uuid,bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_operator() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM public.seed_operator_workspace(NEW.id); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.handle_new_operator() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER on_auth_user_created_hermes AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_operator();

CREATE OR REPLACE FUNCTION public.reset_my_workspace(_seed bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  DELETE FROM public.gateway_events WHERE owner_id = uid;
  DELETE FROM public.trades WHERE owner_id = uid;
  DELETE FROM public.orders WHERE owner_id = uid;
  DELETE FROM public.positions WHERE owner_id = uid;
  DELETE FROM public.equity_snapshots WHERE owner_id = uid;
  DELETE FROM public.report_cards WHERE owner_id = uid;
  DELETE FROM public.overseer_decisions WHERE owner_id = uid;
  DELETE FROM public.monte_carlo_runs WHERE owner_id = uid;
  DELETE FROM public.validation_steps WHERE owner_id = uid;
  DELETE FROM public.accounts WHERE owner_id = uid;
  DELETE FROM public.agents WHERE owner_id = uid;
  UPDATE public.operator_settings SET kill_armed = false WHERE owner_id = uid;
  PERFORM public.seed_operator_workspace(uid, _seed);
  UPDATE public.operator_settings SET sim_seed = _seed WHERE owner_id = uid;
  INSERT INTO public.audit_log(owner_id,actor,action,entity,after) VALUES (uid,'operator','WORKSPACE_RESET','workspace',jsonb_build_object('seed',_seed));
END $$;
REVOKE ALL ON FUNCTION public.reset_my_workspace(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_my_workspace(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_my_workspace()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF; PERFORM public.seed_operator_workspace(auth.uid()); END $$;
REVOKE ALL ON FUNCTION public.ensure_my_workspace() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_workspace() TO authenticated;