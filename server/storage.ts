import { type CallLog, type InsertCallLog, type ActivityLog, type InsertActivityLog, type ActivityStats, callLogs, activityLogs } from "@shared/schema";
import { db } from "./db";
import { desc, eq, sql } from "drizzle-orm";

export interface IStorage {
  createCallLog(log: InsertCallLog): Promise<CallLog>;
  getCallLogs(): Promise<CallLog[]>;
  getCallLogByCallId(callId: string): Promise<CallLog | undefined>;
  createActivityLog(log: InsertActivityLog): Promise<ActivityLog>;
  getActivityLogs(limit?: number): Promise<ActivityLog[]>;
  getActivityStats(): Promise<ActivityStats>;
}

export class DatabaseStorage implements IStorage {
  async createCallLog(insertLog: InsertCallLog): Promise<CallLog> {
    const [log] = await db.insert(callLogs).values(insertLog).returning();
    return log;
  }

  async getCallLogs(): Promise<CallLog[]> {
    return db.select().from(callLogs).orderBy(desc(callLogs.timestamp));
  }

  async getCallLogByCallId(callId: string): Promise<CallLog | undefined> {
    const [log] = await db.select().from(callLogs).where(eq(callLogs.callId, callId));
    return log;
  }

  async createActivityLog(insertLog: InsertActivityLog): Promise<ActivityLog> {
    const [log] = await db.insert(activityLogs).values(insertLog).returning();
    return log;
  }

  async getActivityLogs(limit = 50): Promise<ActivityLog[]> {
    return db.select().from(activityLogs).orderBy(desc(activityLogs.timestamp)).limit(limit);
  }

  async getActivityStats(): Promise<ActivityStats> {
    const logs = await db.select().from(activityLogs);
    
    const stats: ActivityStats = {
      total: logs.length,
      successful: logs.filter(l => l.status === "success").length,
      failed: logs.filter(l => l.status === "failed").length,
      byService: {},
      byType: {},
    };

    for (const log of logs) {
      if (!stats.byService[log.service]) {
        stats.byService[log.service] = { total: 0, successful: 0, failed: 0 };
      }
      stats.byService[log.service].total++;
      if (log.status === "success") stats.byService[log.service].successful++;
      if (log.status === "failed") stats.byService[log.service].failed++;

      stats.byType[log.type] = (stats.byType[log.type] || 0) + 1;
    }

    return stats;
  }
}

export const storage = new DatabaseStorage();
