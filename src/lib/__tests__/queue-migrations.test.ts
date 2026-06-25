import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const retryAccountingSql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/013_retry_accounting.sql"),
  "utf8"
).replace(/\s+/g, " ")

const approvalBindingSql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/014_approval_result_binding.sql"),
  "utf8"
).replace(/\s+/g, " ")

const safeThreadDeleteSql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/015_safe_thread_delete.sql"),
  "utf8"
).replace(/\s+/g, " ")

const accessEntitiesSql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/016_access_entities.sql"),
  "utf8"
).replace(/\s+/g, " ")

describe("queue retry accounting migration", () => {
  it("requeues stale locks only when another attempt remains", () => {
    expect(retryAccountingSql).toContain("status = 'running'")
    expect(retryAccountingSql).toContain("and retry_count + 1 < max_retries")
    expect(retryAccountingSql).toContain("status = 'failed'")
    expect(retryAccountingSql).toContain("and retry_count + 1 >= max_retries")
  })

  it("does not return exhausted retry failures to pending", () => {
    expect(retryAccountingSql).toContain(
      "if p_retry and v_task.retry_count + 1 < v_task.max_retries then"
    )
    expect(retryAccountingSql).toContain("elsif p_retry then")
    expect(retryAccountingSql).toContain(
      "retry_count = least(retry_count + 1, max_retries)"
    )
  })

  it("repairs pending tasks that already exhausted retries", () => {
    expect(retryAccountingSql).toContain("where status = 'pending'")
    expect(retryAccountingSql).toContain("and retry_count >= max_retries")
  })
})

describe("approval result binding migration", () => {
  it("requires approved tasks to complete the approved result", () => {
    expect(approvalBindingSql).toContain("if v_task.approval_required then")
    expect(approvalBindingSql).toContain("if v_task.approved_at is null then")
    expect(approvalBindingSql).toContain(
      "if v_task.result is null or v_task.result <> p_result then"
    )
    expect(approvalBindingSql).toContain(
      "completion result does not match approved result"
    )
  })
})

describe("safe thread delete migration", () => {
  it("blocks deleting threads with active tasks", () => {
    expect(safeThreadDeleteSql).toContain("delete_thread_safely")
    expect(safeThreadDeleteSql).toContain(
      "status in ('pending', 'running', 'awaiting_approval')"
    )
    expect(safeThreadDeleteSql).toContain("Thread % has active tasks")
  })
})

describe("access entities migration", () => {
  it("stores agents and KB access as normalized entities and joins", () => {
    expect(accessEntitiesSql).toContain("create table if not exists agents")
    expect(accessEntitiesSql).toContain("create table if not exists role_agent_access")
    expect(accessEntitiesSql).toContain(
      "create table if not exists knowledge_base_role_access"
    )
    expect(accessEntitiesSql).toContain("references knowledge_bases(id)")
  })

  it("moves KB visibility policy from array access to join access", () => {
    expect(accessEntitiesSql).toContain(
      "drop policy if exists \"users see allowed kbs\""
    )
    expect(accessEntitiesSql).toContain("from knowledge_base_role_access")
    expect(accessEntitiesSql).toContain("kb_access.role = current_user_role()")
  })

  it("updates KB rows and role joins through atomic security-definer functions", () => {
    expect(accessEntitiesSql).toContain("create_knowledge_base_with_access")
    expect(accessEntitiesSql).toContain("update_knowledge_base_with_access")
    expect(accessEntitiesSql).toContain("if not can_manage_kb() then")
    expect(accessEntitiesSql).toContain("delete from knowledge_base_role_access")
    expect(accessEntitiesSql).toContain("insert into knowledge_base_role_access")
  })

  it("guards task completion by the task owner role and selected agent", () => {
    expect(accessEntitiesSql).toContain("can_role_access_agent")
    expect(accessEntitiesSql).toContain("v_role := coalesce(v_task.payload->>'user_role'")
    expect(accessEntitiesSql).toContain(
      "if v_agent is not null and not can_role_access_agent(v_role, v_agent) then"
    )
    expect(accessEntitiesSql).toContain("is not allowed for role")
  })
})
