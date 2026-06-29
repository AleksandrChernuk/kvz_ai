import type { UserRole } from "./roles"

export type TaskStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "done"
  | "failed"
  | "cancelled"
export type AgentType =
  | "codex"
  | "search"
  | "drive"
  | "bitrix"
  | "email"
  | "kb"
  | "orchestrated"
export type MessageRole = "user" | "assistant" | "system"
export type AgentState =
  | "booting"
  | "working"
  | "between_turns"
  | "stalled"
  | "completed"
  | "zombie"
export type RunStatus = "active" | "completed" | "failed"
export type MailType =
  | "worker_done"
  | "worker_died"
  | "escalation"
  | "health_check"
  | "dispatch"
  | "info"

export interface Profile {
  id: string
  user_id: string
  full_name: string | null
  role: UserRole
  webhook_url: string | null
  created_at: string
}

export interface Thread {
  id: string
  user_id: string
  title: string | null
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  thread_id: string
  role: MessageRole
  content: string
  task_id: string | null
  created_at: string
}

export interface TaskPayload {
  user_message: string
  user_role: UserRole
  preferred_agent?: AgentType
  preferred_knowledge_base?: KnowledgeBaseRef
  thread_context?: Message[]
  available_agents?: Pick<AgentCatalogItem, "key" | "name" | "description">[]
  available_knowledge_bases?: KnowledgeBaseRef[]
  metadata?: Record<string, unknown>
}

export interface TaskResult {
  answer: string
  agent_used: AgentType
  steps?: string[]
  tokens?: { input: number; output: number }
  requires_approval?: boolean
  validation?: {
    kind: "weight" | "selection" | "ilogic" | "dxf" | "json"
    [key: string]: unknown
  }
  raw_result?: unknown
}

export interface TaskCheckpoint {
  progress_summary: string
  pending_work: string
  agent_session_id: string | null
  saved_at: string
  metadata?: Record<string, unknown>
}

export interface Task {
  id: string
  thread_id: string
  message_id: string | null
  user_id: string
  run_id: string | null
  status: TaskStatus
  priority: number
  agent: AgentType | null
  payload: TaskPayload
  result: TaskResult | null
  error: string | null
  retry_count: number
  max_retries: number
  checkpoint: TaskCheckpoint | null
  locked_at: string | null
  locked_by: string | null
  approval_required: boolean
  approved_at: string | null
  approved_by: string | null
  created_at: string
  updated_at: string
}

export interface Run {
  id: string
  started_at: string
  completed_at: string | null
  status: RunStatus
  agent_count: number
  coordinator_session_id: string | null
  metadata: Record<string, unknown>
}

export interface AgentSession {
  id: string
  agent_name: string
  capability: AgentType | null
  state: AgentState
  task_id: string | null
  run_id: string | null
  parent_session_id: string | null
  depth: number
  worker_id: string
  escalation_level: number
  checkpoint: TaskCheckpoint | null
  stalled_since: string | null
  last_activity: string
  started_at: string
  completed_at: string | null
}

export interface AgentMail {
  id: string
  from_agent: string
  to_agent: string
  subject: string
  body: string
  type: MailType
  priority: number
  task_id: string | null
  run_id: string | null
  read_at: string | null
  created_at: string
}

// База знань: MCP-конектор (NotebookLM-подібні та інші), доступ за ролями
export interface KnowledgeBase {
  id: string
  name: string
  description: string | null
  mcp_server: string
  mcp_config: Record<string, unknown>
  allowed_roles: UserRole[]
  enabled: boolean
  created_at: string
}

export type KnowledgeBaseRef = Pick<
  KnowledgeBase,
  "id" | "name" | "description" | "mcp_server"
> & {
  library?: string | null
}

export interface AgentCatalogItem {
  key: AgentType
  name: string
  description: string | null
  enabled: boolean
  created_at: string
}

export interface RoleAgentAccess {
  role: UserRole
  agent: AgentType
  enabled: boolean
  created_at: string
}

export interface KnowledgeBaseRoleAccess {
  knowledge_base_id: string
  role: UserRole
  created_at: string
}

// Рольова фіча: який функціонал доступний якій ролі
export interface RoleFeature {
  role: UserRole
  feature: string
  enabled: boolean
}

export type Database = {
  public: {
    Tables: {
      profiles: { Row: Profile }
      threads: { Row: Thread }
      messages: { Row: Message }
      tasks: { Row: Task }
      runs: { Row: Run }
      agent_sessions: { Row: AgentSession }
      agent_mail: { Row: AgentMail }
      agents: { Row: AgentCatalogItem }
      role_agent_access: { Row: RoleAgentAccess }
      knowledge_bases: { Row: KnowledgeBase }
      knowledge_base_role_access: { Row: KnowledgeBaseRoleAccess }
      role_features: { Row: RoleFeature }
    }
  }
}
