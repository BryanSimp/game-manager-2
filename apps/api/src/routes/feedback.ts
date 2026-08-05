import type { FastifyInstance } from "fastify";
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  FEEDBACK_AREAS,
  FEEDBACK_KINDS,
  FEEDBACK_SORTS,
  FEEDBACK_STATUSES,
  feedbackSubmissionSchema,
  feedbackTriageSchema,
  type AdminFeedbackPage,
  type FeedbackArea,
  type FeedbackItem,
  type FeedbackKind,
  type FeedbackSort,
  type FeedbackStatus,
} from "@gm/shared";
import { db, schema } from "../db/index.js";
import { requireAdmin, requireUser } from "../plugins/auth.js";
import { logEvent } from "../services/analytics.js";
import { feedbackRateLimit } from "../plugins/rate-limits.js";

/**
 * In-app feedback: users file it, the admin triages it.
 *
 * Deliberately not run through `services/content-filter.ts`. That filter
 * exists for text that ends up in front of *other users* — list and
 * collection names. Feedback is a private channel to the operator, exactly
 * like the contact form, and a bug report often has to quote the thing that
 * went wrong. Rejecting a report for its wording would lose the report.
 */

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  kind: z.enum(FEEDBACK_KINDS).optional(),
  area: z.enum(FEEDBACK_AREAS).optional(),
  status: z.enum(FEEDBACK_STATUSES).optional(),
  sort: z.enum(FEEDBACK_SORTS).default("newest"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

type FeedbackRow = typeof schema.feedback.$inferSelect;

/**
 * Triage order, not alphabetical order: sorting statuses by their stored text
 * would put "declined" first and "new" fourth, which is the opposite of what
 * a queue is for.
 */
const STATUS_RANK = sql`CASE ${schema.feedback.status}
  WHEN 'new' THEN 0 WHEN 'planned' THEN 1 WHEN 'in_progress' THEN 2
  WHEN 'done' THEN 3 WHEN 'declined' THEN 4 ELSE 5 END`;

/** Broken things before wishes before opinions. */
const KIND_RANK = sql`CASE ${schema.feedback.kind}
  WHEN 'bug' THEN 0 WHEN 'feature_request' THEN 1 ELSE 2 END`;

function orderFor(sort: FeedbackSort): SQL[] {
  const newest = desc(schema.feedback.createdAt);
  if (sort === "oldest") return [asc(schema.feedback.createdAt)];
  if (sort === "kind") return [asc(KIND_RANK), newest];
  if (sort === "area") return [asc(schema.feedback.area), newest];
  if (sort === "status") return [asc(STATUS_RANK), newest];
  return [newest];
}

function filtersFor(query: z.infer<typeof listQuerySchema>): SQL | undefined {
  const clauses: SQL[] = [];
  if (query.kind) clauses.push(eq(schema.feedback.kind, query.kind));
  if (query.area) clauses.push(eq(schema.feedback.area, query.area));
  if (query.status) clauses.push(eq(schema.feedback.status, query.status));
  if (query.q) {
    const needle = `%${query.q}%`;
    clauses.push(
      or(ilike(schema.feedback.subject, needle), ilike(schema.feedback.message, needle))!,
    );
  }
  return clauses.length > 0 ? and(...clauses) : undefined;
}

function toItem(
  row: FeedbackRow,
  author: { name: string | null; email: string | null } | null,
  includeAdminFields: boolean,
): FeedbackItem {
  return {
    id: row.id,
    kind: row.kind as FeedbackKind,
    area: row.area as FeedbackArea,
    subject: row.subject,
    message: row.message,
    status: row.status as FeedbackStatus,
    adminNote: includeAdminFields ? row.adminNote : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    authorName: includeAdminFields ? (author?.name ?? null) : null,
    authorEmail: includeAdminFields ? (author?.email ?? null) : null,
  };
}

/** Admin list + the author join, shared by the JSON list and the CSV export. */
async function queryFeedback(query: z.infer<typeof listQuerySchema>) {
  const where = filtersFor(query);
  const rows = await db
    .select({
      row: schema.feedback,
      authorName: schema.user.name,
      authorEmail: schema.user.email,
    })
    .from(schema.feedback)
    .leftJoin(schema.user, eq(schema.feedback.userId, schema.user.id))
    .where(where)
    .orderBy(...orderFor(query.sort))
    .limit(query.limit)
    .offset(query.offset);
  return rows.map((r) =>
    toItem(r.row, { name: r.authorName, email: r.authorEmail }, true),
  );
}

/** RFC 4180: quote everything, double the quotes inside. */
function csvCell(value: string | null): string {
  return `"${(value ?? "").replace(/"/g, '""')}"`;
}

export function registerFeedbackRoutes(app: FastifyInstance): void {
  /** File a report. Signed in, so who sent it is never in the payload. */
  app.post("/api/feedback", { config: feedbackRateLimit }, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = feedbackSubmissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const [created] = await db
      .insert(schema.feedback)
      .values({
        userId: user.id,
        kind: parsed.data.kind,
        area: parsed.data.area,
        subject: parsed.data.subject,
        message: parsed.data.message,
      })
      .returning({ id: schema.feedback.id });
    logEvent("feedback_submitted", user.id, {
      kind: parsed.data.kind,
      area: parsed.data.area,
    });
    reply.status(201);
    return { id: created!.id };
  });

  /**
   * Your own reports, so filing one isn't shouting into a void — you can see
   * it was received and whether it's been picked up. Admin notes stay admin's.
   */
  app.get("/api/feedback/mine", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const rows = await db
      .select()
      .from(schema.feedback)
      .where(eq(schema.feedback.userId, user.id))
      .orderBy(desc(schema.feedback.createdAt))
      .limit(50);
    return rows.map((row) => toItem(row, null, false));
  });

  // ---- admin ----

  app.get("/api/admin/feedback", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ message: "Invalid filters" });

    const items = await queryFeedback(parsed.data);
    const [matching] = await db
      .select({ n: count() })
      .from(schema.feedback)
      .where(filtersFor(parsed.data));

    // the tiles above the table count everything, not the filtered slice —
    // "3 new" has to stay true while you're reading the done ones
    const statusRows = await db
      .select({ status: schema.feedback.status, n: count() })
      .from(schema.feedback)
      .groupBy(schema.feedback.status);
    const kindRows = await db
      .select({ kind: schema.feedback.kind, n: count() })
      .from(schema.feedback)
      .groupBy(schema.feedback.kind);

    const byStatus = Object.fromEntries(
      FEEDBACK_STATUSES.map((s) => [s, statusRows.find((r) => r.status === s)?.n ?? 0]),
    ) as Record<FeedbackStatus, number>;
    const byKind = Object.fromEntries(
      FEEDBACK_KINDS.map((k) => [k, kindRows.find((r) => r.kind === k)?.n ?? 0]),
    ) as Record<FeedbackKind, number>;

    const page: AdminFeedbackPage = {
      items,
      total: matching?.n ?? 0,
      totals: {
        all: statusRows.reduce((sum, r) => sum + r.n, 0),
        byStatus,
        byKind,
      },
    };
    return page;
  });

  /**
   * The filtered queue as a spreadsheet.
   *
   * A static path, so Fastify matches it ahead of `/:id` regardless of
   * registration order. It answers with a file rather than JSON so the web
   * page can be a plain link — same-origin cookies come along on their own.
   */
  app.get("/api/admin/feedback/export.csv", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ message: "Invalid filters" });
    // an export is the whole matching set, not one screen of it
    const items = await queryFeedback({ ...parsed.data, limit: 5000, offset: 0 });

    const header = [
      "Submitted",
      "Kind",
      "Area",
      "Status",
      "Subject",
      "Message",
      "From",
      "Email",
      "Admin note",
    ];
    const lines = [
      header.map(csvCell).join(","),
      ...items.map((i) =>
        [
          i.createdAt,
          i.kind,
          i.area,
          i.status,
          i.subject,
          i.message,
          i.authorName,
          i.authorEmail,
          i.adminNote,
        ]
          .map((v) => csvCell(v ?? null))
          .join(","),
      ),
    ];
    const stamp = new Date().toISOString().slice(0, 10);
    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="feedback-${stamp}.csv"`);
    // Excel reads a bare UTF-8 CSV as the system codepage and mangles anything
    // non-ASCII; a BOM is what makes it guess right.
    return `﻿${lines.join("\r\n")}\r\n`;
  });

  app.patch<{ Params: { id: string } }>("/api/admin/feedback/:id", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const parsed = feedbackTriageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const [updated] = await db
      .update(schema.feedback)
      .set({
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
        ...(parsed.data.adminNote !== undefined
          ? { adminNote: parsed.data.adminNote || null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.feedback.id, request.params.id))
      .returning({ id: schema.feedback.id });
    if (!updated) return reply.status(404).send({ message: "Feedback not found" });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/admin/feedback/:id", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const [removed] = await db
      .delete(schema.feedback)
      .where(eq(schema.feedback.id, request.params.id))
      .returning({ id: schema.feedback.id });
    if (!removed) return reply.status(404).send({ message: "Feedback not found" });
    return { ok: true };
  });
}
