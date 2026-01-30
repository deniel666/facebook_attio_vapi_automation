import { pgTable, text, integer, boolean, timestamp, jsonb, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Database Tables
export const callLogs = pgTable("call_logs", {
  id: serial("id").primaryKey(),
  callId: text("call_id").notNull(),
  customerPhone: text("customer_phone").notNull(),
  duration: integer("duration").notNull(),
  outcome: text("outcome").notNull(),
  summary: text("summary").notNull(),
  endedReason: text("ended_reason").notNull(),
  telegramSent: boolean("telegram_sent").notNull().default(false),
  attioUpdated: boolean("attio_updated").notNull().default(false),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  status: text("status").notNull(),
  service: text("service").notNull(),
  direction: text("direction").notNull(),
  summary: text("summary").notNull(),
  details: jsonb("details"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

// Vapi Webhook Types
export const vapiCustomerSchema = z.object({
  number: z.string().optional(),
});

export const vapiMetadataSchema = z.object({
  attio_record_id: z.string().optional(),
});

export const vapiCallSchema = z.object({
  id: z.string(),
  duration: z.number().optional(),
  customer: vapiCustomerSchema.optional(),
  metadata: vapiMetadataSchema.optional(),
});

export const vapiArtifactSchema = z.object({
  transcript: z.string().optional(),
});

export const vapiAnalysisSchema = z.object({
  summary: z.string().optional(),
});

export const vapiMessageSchema = z.object({
  type: z.string(),
  endedReason: z.string().optional(),
  call: vapiCallSchema.optional(),
  artifact: vapiArtifactSchema.optional(),
  analysis: vapiAnalysisSchema.optional(),
});

export const vapiWebhookPayloadSchema = z.object({
  message: vapiMessageSchema,
});

export type VapiWebhookPayload = z.infer<typeof vapiWebhookPayloadSchema>;
export type VapiMessage = z.infer<typeof vapiMessageSchema>;
export type VapiCall = z.infer<typeof vapiCallSchema>;

// Call Outcome Types
export const callOutcomes = [
  "Booked",
  "Interested",
  "Not Interested",
  "No Answer",
  "Voicemail",
  "Needs Review",
] as const;

export type CallOutcome = typeof callOutcomes[number];

// Webhook Response
export interface WebhookResponse {
  status: "success" | "ignored" | "error";
  outcome?: CallOutcome;
  telegramSent?: boolean;
  attioUpdated?: boolean;
  error?: string;
}

// Call Log types from Drizzle schema
export type CallLog = typeof callLogs.$inferSelect;
export type InsertCallLog = typeof callLogs.$inferInsert;
export const insertCallLogSchema = createInsertSchema(callLogs).omit({ id: true, timestamp: true });

// Activity Log Types for tracking service interactions
export const activityTypes = [
  "facebook_lead_received",
  "facebook_conversion_sent",
  "attio_record_created",
  "attio_record_updated",
  "telegram_notification_sent",
  "vapi_webhook_received",
] as const;

export type ActivityType = typeof activityTypes[number];

export const activityStatuses = ["success", "failed", "pending"] as const;
export type ActivityStatus = typeof activityStatuses[number];

// Activity Log types from Drizzle schema
export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = typeof activityLogs.$inferInsert;
export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({ id: true, timestamp: true });

export interface ActivityStats {
  total: number;
  successful: number;
  failed: number;
  byService: Record<string, { total: number; successful: number; failed: number }>;
  byType: Record<string, number>;
}
