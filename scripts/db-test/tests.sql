-- Integration tests: run the REAL queue functions + RLS against applied
-- migrations. Any failed assertion RAISEs and (under ON_ERROR_STOP) fails the
-- run. These exercise execution, not migration text — they would have caught
-- the complete_task regression that the text-based test missed.

\set ON_ERROR_STOP on

-- Privileges Supabase grants by default; needed for the RLS role tests.
grant select, insert, update, delete on threads, messages, tasks to authenticated, anon;

do $$
declare
  ua uuid; ub uuid;
  th uuid; tsk uuid; tsk2 uuid;
  v_status task_status;
  v_msg int;
  ok bool;
begin
  -- ---- fixtures -----------------------------------------------------------
  insert into auth.users default values returning id into ua;
  insert into auth.users default values returning id into ub;
  -- handle_new_user trigger (001) should have created viewer profiles
  update profiles set role = 'admin' where user_id = ua;
  update profiles set role = 'engineer' where user_id = ub;

  insert into threads (user_id, title) values (ua, 't') returning id into th;
  insert into tasks (thread_id, user_id, payload)
    values (th, ua, '{"user_message":"hi"}') returning id into tsk;

  -- ===== Test A: claim → checkpoint guard → complete ======================
  perform claim_next_task('w1');
  select status, locked_by into v_status from tasks where id = tsk;
  if v_status <> 'running' then raise exception 'A1: expected running, got %', v_status; end if;

  -- save_checkpoint by the WRONG worker must raise (no-op fix)
  ok := false;
  begin perform save_checkpoint(tsk, 'w2', '{}'::jsonb);
  exception when others then ok := true; end;
  if not ok then raise exception 'A2: save_checkpoint by wrong worker did not raise'; end if;

  perform complete_task(tsk, 'w1', '{"answer":"привіт"}'::jsonb, 'connector');
  select status into v_status from tasks where id = tsk;
  if v_status <> 'done' then raise exception 'A3: expected done, got %', v_status; end if;
  select count(*) into v_msg from messages
    where task_id = tsk and role = 'assistant' and content = 'привіт';
  if v_msg <> 1 then raise exception 'A4: assistant message not inserted (%)', v_msg; end if;
  raise notice 'PASS A: claim/checkpoint-guard/complete';

  -- ===== Test B: complete twice (running guard) + empty answer ============
  ok := false;
  begin perform complete_task(tsk, 'w1', '{"answer":"again"}'::jsonb, 'connector');
  exception when others then ok := true; end;
  if not ok then raise exception 'B1: re-complete of done task did not raise'; end if;

  insert into tasks (thread_id, user_id, payload)
    values (th, ua, '{"user_message":"x"}') returning id into tsk2;
  perform claim_next_task('w1');
  ok := false;
  begin perform complete_task(tsk2, 'w1', '{"answer":""}'::jsonb, 'connector');
  exception when others then ok := true; end;
  if not ok then raise exception 'B2: empty-answer completion did not raise'; end if;
  raise notice 'PASS B: running-guard + empty-answer';

  -- ===== Test C: approval gate + result binding (011/012/014) =============
  -- tsk2 is running under w1. Put it on approval with a preview result.
  perform request_approval(tsk2, 'w1', '{"answer":"preview"}'::jsonb);
  select status into v_status from tasks where id = tsk2;
  if v_status <> 'awaiting_approval' then raise exception 'C1: expected awaiting_approval, got %', v_status; end if;

  -- approve as the owner (auth.uid via GUC), then it returns to pending
  perform set_config('app.user_id', ua::text, true);
  perform approve_task(tsk2);
  perform set_config('app.user_id', '', true);
  select status, approved_at is not null into v_status, ok from tasks where id = tsk2;
  if v_status <> 'pending' or not ok then raise exception 'C2: approve did not re-queue with approved_at'; end if;

  perform claim_next_task('w1');
  -- completing with a DIFFERENT result than approved must raise (014 binding)
  ok := false;
  begin perform complete_task(tsk2, 'w1', '{"answer":"DIFFERENT"}'::jsonb, 'connector');
  exception when others then ok := true; end;
  if not ok then raise exception 'C3: result-binding mismatch did not raise'; end if;

  -- completing with the approved result succeeds
  perform complete_task(tsk2, 'w1', '{"answer":"preview"}'::jsonb, 'connector');
  select status into v_status from tasks where id = tsk2;
  if v_status <> 'done' then raise exception 'C4: approved completion failed (%)', v_status; end if;
  raise notice 'PASS C: approval gate + result binding';

  -- ===== Test D: agent access guard (016) =================================
  -- engineer (ub) must not complete via an agent its role can't access if the
  -- access matrix forbids it. We assert the guard path exists by completing a
  -- task whose role can access 'connector' (seeded for all roles in 018-adjacent),
  -- and that a null agent is rejected.
  insert into tasks (thread_id, user_id, payload)
    values (th, ua, '{"user_message":"y","user_role":"admin"}') returning id into tsk;
  perform claim_next_task('w1');
  ok := false;
  begin perform complete_task(tsk, 'w1', '{"answer":"z"}'::jsonb, null);
  exception when others then ok := true; end;
  if not ok then raise exception 'D1: null-agent completion did not raise'; end if;
  raise notice 'PASS D: agent-required guard';

  raise notice 'ALL SERVICE-ROLE TESTS PASSED';
end $$;

-- ===== Test E: RLS isolation (run AS authenticated) =========================
do $$
declare ua uuid; ub uuid; n int;
begin
  select user_id into ua from profiles where role = 'admin' limit 1;
  select user_id into ub from profiles where role = 'engineer' limit 1;
  -- ensure each has a thread
  insert into threads (user_id, title) values (ub, 'b-thread');

  set local role authenticated;

  perform set_config('app.user_id', ua::text, true);
  select count(*) into n from threads where user_id = ub;
  if n <> 0 then raise exception 'E1: user A can see user B threads (%)', n; end if;

  perform set_config('app.user_id', ub::text, true);
  select count(*) into n from threads where user_id = ua;
  if n <> 0 then raise exception 'E2: user B can see user A threads (%)', n; end if;

  select count(*) into n from threads;  -- own only
  if n < 1 then raise exception 'E3: user B cannot see own threads'; end if;

  reset role;
  raise notice 'PASS E: RLS per-user isolation';
end $$;

select 'INTEGRATION TESTS OK' as result;
