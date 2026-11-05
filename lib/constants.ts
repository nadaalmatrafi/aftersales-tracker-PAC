export const ROLES = ["system_owner", "ceo", "director", "manager", "employee"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = {
  system_owner: "System Owner",
  ceo: "CEO",
  director: "Director",
  manager: "Manager",
  employee: "Employee",
};

export const PERMISSIONS = {
  view_all_actions: "View all action plans across organizations",
  assign_any: "Assign and reassign any action plan",
  manage_meetings: "Create and manage executive meetings",
  manage_objectives: "Create and manage 30/60/90-day objectives",
  approve_completion: "Approve completions and deadline extensions",
  assign_subtasks: "Create workflow steps on owned actions",
  export_reports: "Export reports to Excel and PDF",
  view_confidential: "View confidential executive items",
} as const;
export type Permission = keyof typeof PERMISSIONS;

export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };

export const STORED_STATUSES = ["not_started", "in_progress", "pending_approval", "on_hold", "completed", "cancelled"] as const;
export type StoredStatus = (typeof STORED_STATUSES)[number];
export const STATUSES = [...STORED_STATUSES, "overdue"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  pending_approval: "Pending Approval",
  on_hold: "On Hold",
  completed: "Completed",
  overdue: "Overdue",
  cancelled: "Cancelled",
};
export const CLOSED_STATUSES: StoredStatus[] = ["completed", "cancelled"];

export const STEP_STATUSES = ["pending", "in_progress", "blocked", "done", "skipped"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];
export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done",
  skipped: "Skipped",
};

export const CATEGORIES = [
  "revenue_growth",
  "operational_efficiency",
  "financial_performance",
  "customer_development",
  "employee_performance",
] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = {
  revenue_growth: "Revenue Growth",
  operational_efficiency: "Operational Efficiency",
  financial_performance: "Financial Performance",
  customer_development: "Customer Development",
  employee_performance: "Employee Performance",
};

export const NOTIFICATION_TYPES = {
  assignment: "New task assignment",
  reassignment: "Task reassignment",
  deadline_soon: "Approaching deadline",
  overdue: "Overdue action",
  approval_request: "Approval request",
  rejection: "Task rejection",
  escalation: "Critical escalation",
  meeting: "Upcoming executive meeting",
  step_handoff: "Workflow hand-off to you",
} as const;
export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export const TIME_ZONE = "Asia/Riyadh";
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const STALE_UPDATE_DAYS = 7;
export const DEADLINE_SOON_DAYS = 7;
