import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { NOTIFICATION_TYPES, type NotificationType } from "./constants";
import { renderEmail, sendEmail } from "./email";
import { activeDelegations } from "./leave";

type NotifyInput = {
  userIds: (string | null | undefined)[];
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  /** Unique per (user, event). A repeated key never creates a second notification or email. */
  dedupeKey: string;
  excludeUserId?: string;
  /** Internal: set when this is the delegate's copy of a notification. */
  onBehalfOf?: string;
};

export async function notify(input: NotifyInput) {
  const ids = [...new Set(input.userIds.filter((x): x is string => !!x && x !== input.excludeUserId))];
  if (!ids.length) return;
  // People on leave keep their own copy; their delegate receives one too.
  if (!input.onBehalfOf) {
    const leave = await activeDelegations();
    for (const id of ids) {
      const d = leave.get(id);
      if (d && d.delegateId !== input.excludeUserId)
        await notify({ ...input, userIds: [d.delegateId], title: `${input.title} (covering for ${d.userName})`, dedupeKey: `${input.dedupeKey}:delegate:${id}`, onBehalfOf: id });
    }
  }
  const [users, prefs, settings] = await Promise.all([
    db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, active: schema.users.isActive })
      .from(schema.users).where(inArray(schema.users.id, ids)),
    db.select().from(schema.notificationPreferences)
      .where(and(inArray(schema.notificationPreferences.userId, ids), eq(schema.notificationPreferences.type, input.type))),
    db.select().from(schema.systemSettings).where(eq(schema.systemSettings.key, "email_notifications")),
  ]);
  const globalEmail = settings[0]?.value as { enabled?: boolean; types?: Record<string, boolean> } | undefined;
  const typeAllowedGlobally = globalEmail?.enabled !== false && globalEmail?.types?.[input.type] !== false;

  for (const u of users) {
    if (!u.active) continue;
    const pref = prefs.find((p) => p.userId === u.id);
    const inApp = pref?.inApp ?? true;
    const wantsEmail = (pref?.email ?? true) && typeAllowedGlobally;
    const inserted = await db
      .insert(schema.notifications)
      .values({
        userId: u.id,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        dedupeKey: input.dedupeKey,
        readAt: inApp ? null : sql`now()`,
        emailStatus: wantsEmail ? null : "skipped",
      })
      .onConflictDoNothing()
      .returning({ id: schema.notifications.id });
    if (!inserted.length || !wantsEmail) continue; // duplicate event or email opted out
    const content = renderEmail({ recipientName: u.name, title: input.title, body: input.body ?? NOTIFICATION_TYPES[input.type], link: input.link });
    const status = await sendEmail(u.email, input.title, content, `${u.id}:${input.dedupeKey}`);
    await db
      .update(schema.notifications)
      .set({ emailStatus: status, emailedAt: status === "sent" ? sql`now()` : null })
      .where(eq(schema.notifications.id, inserted[0].id));
  }
}

/** Executives and distribution leads who receive critical escalations. */
export async function escalationRecipients(): Promise<string[]> {
  const res = await db.execute(sql`
    SELECT id FROM users WHERE is_active AND role IN ('ceo','system_owner')
    UNION SELECT u.id FROM users u JOIN user_permissions p ON p.user_id = u.id WHERE u.is_active AND p.permission = 'assign_any'`);
  return res.rows.map((r) => (r as { id: string }).id);
}
