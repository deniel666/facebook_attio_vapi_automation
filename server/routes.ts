import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { vapiWebhookPayloadSchema, type WebhookResponse, type CallOutcome, type InsertActivityLog } from "@shared/schema";
import { determineCallOutcome } from "./services/outcome";
import { sendTelegramNotification } from "./services/telegram";
import { updateAttioRecord, findAttioRecordByPhone, findAttioRecordByEmail, createAttioRecord } from "./services/attio";
import { fetchAndProcessHistoricalCalls } from "./services/vapi";
import { sendConversionEvent, verifyFacebookWebhook, fetchLeadDetails, fetchAllLeadsFromPage } from "./services/facebook";

const FACEBOOK_PAGE_ID = process.env.FACEBOOK_PAGE_ID;

async function logActivity(activity: InsertActivityLog): Promise<void> {
  try {
    await storage.createActivityLog(activity);
  } catch (error) {
    console.error("Failed to log activity:", error);
  }
}

const FACEBOOK_VERIFY_TOKEN = process.env.FACEBOOK_VERIFY_TOKEN || "erzycall_webhook_verify";

const startTime = Date.now();

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Health check endpoint
  app.get("/api/status", (_req, res) => {
    res.json({
      status: "ErzyCall Webhook Handler running!",
      version: "1.0.0",
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  });

  // Get call logs
  app.get("/api/logs", async (_req, res) => {
    try {
      const logs = await storage.getCallLogs();
      res.json(logs);
    } catch (error) {
      console.error("Error fetching logs:", error);
      res.status(500).json({ error: "Failed to fetch logs" });
    }
  });

  // Get activity logs
  app.get("/api/activity", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = await storage.getActivityLogs(limit);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching activity logs:", error);
      res.status(500).json({ error: "Failed to fetch activity logs" });
    }
  });

  // Get activity statistics
  app.get("/api/activity/stats", async (_req, res) => {
    try {
      const stats = await storage.getActivityStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching activity stats:", error);
      res.status(500).json({ error: "Failed to fetch activity stats" });
    }
  });

  // Main Vapi webhook endpoint
  app.post("/webhook/vapi", async (req, res) => {
    try {
      // Validate webhook payload
      const parseResult = vapiWebhookPayloadSchema.safeParse(req.body);
      
      if (!parseResult.success) {
        console.error("Invalid webhook payload:", parseResult.error);
        res.status(200).json({ 
          status: "ignored", 
          reason: "Invalid payload format" 
        } as WebhookResponse);
        return;
      }

      const payload = parseResult.data;
      const message = payload.message;

      // Only process end-of-call-report
      if (message.type !== "end-of-call-report") {
        console.log(`Ignoring webhook type: ${message.type}`);
        res.status(200).json({ 
          status: "ignored", 
          reason: `Webhook type ${message.type} not processed` 
        } as WebhookResponse);
        return;
      }

      // Extract call data
      const call = message.call;
      const callId = call?.id || "unknown";
      const customerPhone = call?.customer?.number || "Unknown";
      const duration = call?.duration || 0;
      const endedReason = message.endedReason || "unknown";
      const transcript = message.artifact?.transcript || "";
      const summary = message.analysis?.summary || "";
      const attioRecordId = call?.metadata?.attio_record_id;

      console.log(`Processing call ${callId}:`, {
        phone: customerPhone,
        duration,
        endedReason,
        hasTranscript: !!transcript,
        hasSummary: !!summary,
        attioRecordId: attioRecordId || "none",
      });

      // Log Vapi webhook received
      await logActivity({
        type: "vapi_webhook_received",
        status: "success",
        service: "Vapi",
        direction: "incoming",
        summary: `Call from ${customerPhone} (${duration}s)`,
        details: { callId, duration, endedReason },
      });

      // Determine outcome
      const outcome: CallOutcome = determineCallOutcome(
        endedReason,
        transcript,
        summary,
        duration
      );

      console.log(`Call ${callId} outcome: ${outcome}`);

      // Send Telegram notification
      const telegramSent = await sendTelegramNotification(
        outcome,
        customerPhone,
        duration,
        summary,
        endedReason
      );

      if (telegramSent) {
        console.log(`Telegram notification sent for call ${callId}`);
        await logActivity({
          type: "telegram_notification_sent",
          status: "success",
          service: "Telegram",
          direction: "outgoing",
          summary: `${outcome} notification for ${customerPhone}`,
          details: { callId, outcome, phone: customerPhone },
        });
      } else {
        console.warn(`Failed to send Telegram notification for call ${callId}`);
        await logActivity({
          type: "telegram_notification_sent",
          status: "failed",
          service: "Telegram",
          direction: "outgoing",
          summary: `Failed: ${outcome} notification for ${customerPhone}`,
          details: { callId, outcome, phone: customerPhone },
        });
      }

      // Update Attio CRM
      let attioUpdated = false;
      if (attioRecordId) {
        attioUpdated = await updateAttioRecord(attioRecordId, {
          outcome,
          summary,
        });
        if (attioUpdated) {
          console.log(`Attio record ${attioRecordId} updated to ${outcome}`);
          await logActivity({
            type: "attio_record_updated",
            status: "success",
            service: "Attio",
            direction: "outgoing",
            summary: `Updated record to "${outcome}"`,
            details: { recordId: attioRecordId, outcome, phone: customerPhone },
          });
        } else {
          console.warn(`Failed to update Attio record ${attioRecordId}`);
          await logActivity({
            type: "attio_record_updated",
            status: "failed",
            service: "Attio",
            direction: "outgoing",
            summary: `Failed to update record`,
            details: { recordId: attioRecordId, outcome, phone: customerPhone },
          });
        }
      } else {
        console.log("No Attio record ID provided, skipping CRM update");
      }

      // Send Facebook conversion event
      const facebookSent = await sendConversionEvent({
        outcome,
        phoneNumber: customerPhone,
      });
      
      if (facebookSent) {
        console.log(`Facebook conversion event sent for call ${callId}`);
        await logActivity({
          type: "facebook_conversion_sent",
          status: "success",
          service: "Facebook",
          direction: "outgoing",
          summary: `Sent "${outcome}" conversion event`,
          details: { callId, outcome, phone: customerPhone },
        });
      } else {
        await logActivity({
          type: "facebook_conversion_sent",
          status: "failed",
          service: "Facebook",
          direction: "outgoing",
          summary: `Failed to send "${outcome}" conversion event`,
          details: { callId, outcome, phone: customerPhone },
        });
      }

      // Store call log
      await storage.createCallLog({
        callId,
        customerPhone,
        duration,
        outcome,
        summary,
        endedReason,
        telegramSent,
        attioUpdated,
      });

      // Return success response
      const response: WebhookResponse = {
        status: "success",
        outcome,
        telegramSent,
        attioUpdated,
      };

      res.status(200).json(response);
    } catch (error) {
      console.error("Error processing webhook:", error);
      res.status(200).json({
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      } as WebhookResponse);
    }
  });

  // Import historical calls from Vapi
  app.post("/api/import-historical", async (req, res) => {
    try {
      const hoursBack = req.body.hoursBack || 48;
      
      console.log(`Starting historical import for last ${hoursBack} hours...`);
      
      const processedCalls = await fetchAndProcessHistoricalCalls(hoursBack);
      
      console.log(`Found ${processedCalls.length} calls to process`);
      
      const results = {
        total: processedCalls.length,
        processed: 0,
        attioUpdated: 0,
        errors: [] as string[],
        calls: [] as Array<{
          callId: string;
          phoneNumber: string;
          outcome: string;
          attioUpdated: boolean;
          duration: number;
          createdAt: string;
        }>,
      };
      
      for (const call of processedCalls) {
        try {
          let attioUpdated = false;
          let recordId = call.attioRecordId;
          
          if (!recordId && call.phoneNumber && call.phoneNumber !== "Unknown") {
            recordId = await findAttioRecordByPhone(call.phoneNumber) || undefined;
          }
          
          if (recordId) {
            attioUpdated = await updateAttioRecord(recordId, {
              outcome: call.outcome as CallOutcome,
              summary: call.summary,
              recordingUrl: call.recordingUrl,
            });
            if (attioUpdated) {
              results.attioUpdated++;
            }
          }
          
          await storage.createCallLog({
            callId: call.callId,
            customerPhone: call.phoneNumber,
            duration: call.duration,
            outcome: call.outcome as CallOutcome,
            summary: call.summary,
            endedReason: call.endedReason,
            telegramSent: false,
            attioUpdated,
          });
          
          results.processed++;
          results.calls.push({
            callId: call.callId,
            phoneNumber: call.phoneNumber,
            outcome: call.outcome,
            attioUpdated,
            duration: call.duration,
            createdAt: call.createdAt,
          });
          
          console.log(`Processed call ${call.callId}: ${call.outcome} (Attio: ${attioUpdated})`);
        } catch (error) {
          const errorMsg = `Error processing call ${call.callId}: ${error instanceof Error ? error.message : "Unknown error"}`;
          console.error(errorMsg);
          results.errors.push(errorMsg);
        }
      }
      
      console.log(`Import complete: ${results.processed}/${results.total} calls, ${results.attioUpdated} Attio updates`);
      
      res.json({
        status: "success",
        ...results,
      });
    } catch (error) {
      console.error("Error during historical import:", error);
      res.status(500).json({
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Import Facebook leads to Attio
  app.post("/api/import-facebook-leads", async (req, res) => {
    try {
      const pageId = req.body.pageId || FACEBOOK_PAGE_ID;
      
      if (!pageId) {
        res.status(400).json({
          status: "error",
          error: "Facebook Page ID is required. Set FACEBOOK_PAGE_ID environment variable or provide pageId in request body.",
        });
        return;
      }
      
      console.log(`Starting Facebook leads import from page ${pageId}...`);
      
      await logActivity({
        type: "facebook_lead_received",
        status: "pending",
        service: "Facebook",
        direction: "incoming",
        summary: `Starting leads import from page ${pageId}`,
        details: { pageId },
      });
      
      const leads = await fetchAllLeadsFromPage(pageId);
      
      const results = {
        total: leads.length,
        created: 0,
        skipped: 0,
        errors: [] as string[],
        leads: [] as Array<{
          leadId: string;
          name?: string;
          email?: string;
          phone?: string;
          status: "created" | "skipped" | "error";
          attioRecordId?: string;
        }>,
      };
      
      for (const lead of leads) {
        try {
          // Check if lead already exists in Attio by phone or email
          let existingRecordId: string | null = null;
          
          if (lead.phone) {
            existingRecordId = await findAttioRecordByPhone(lead.phone);
          }
          
          if (!existingRecordId && lead.email) {
            existingRecordId = await findAttioRecordByEmail(lead.email);
          }
          
          if (existingRecordId) {
            results.skipped++;
            results.leads.push({
              leadId: lead.leadId,
              name: lead.name,
              email: lead.email,
              phone: lead.phone,
              status: "skipped",
              attioRecordId: existingRecordId,
            });
            continue;
          }
          
          // Create new Attio record
          const recordId = await createAttioRecord({
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
          });
          
          if (recordId) {
            results.created++;
            results.leads.push({
              leadId: lead.leadId,
              name: lead.name,
              email: lead.email,
              phone: lead.phone,
              status: "created",
              attioRecordId: recordId,
            });
            
            await logActivity({
              type: "attio_record_created",
              status: "success",
              service: "Attio",
              direction: "outgoing",
              summary: `Created record for ${lead.name || lead.email || lead.phone}`,
              details: { recordId, leadId: lead.leadId },
            });
          } else {
            results.errors.push(`Failed to create record for lead ${lead.leadId}`);
            results.leads.push({
              leadId: lead.leadId,
              name: lead.name,
              email: lead.email,
              phone: lead.phone,
              status: "error",
            });
          }
        } catch (error) {
          const errorMsg = `Error processing lead ${lead.leadId}: ${error instanceof Error ? error.message : "Unknown error"}`;
          console.error(errorMsg);
          results.errors.push(errorMsg);
        }
      }
      
      console.log(`Facebook import complete: ${results.created} created, ${results.skipped} skipped, ${results.errors.length} errors`);
      
      await logActivity({
        type: "facebook_lead_received",
        status: results.errors.length === 0 ? "success" : "failed",
        service: "Facebook",
        direction: "incoming",
        summary: `Imported ${results.created} leads, ${results.skipped} skipped`,
        details: { pageId, total: results.total, created: results.created, skipped: results.skipped },
      });
      
      res.json({
        status: "success",
        ...results,
      });
    } catch (error) {
      console.error("Error during Facebook leads import:", error);
      res.status(500).json({
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Facebook webhook verification (GET)
  app.get("/webhook/facebook", (req, res) => {
    const mode = req.query["hub.mode"] as string;
    const token = req.query["hub.verify_token"] as string;
    const challenge = req.query["hub.challenge"] as string;

    const result = verifyFacebookWebhook(mode, token, challenge, FACEBOOK_VERIFY_TOKEN);
    
    if (result) {
      console.log("Facebook webhook verified successfully");
      res.status(200).send(result);
    } else {
      console.warn("Facebook webhook verification failed");
      res.status(403).send("Verification failed");
    }
  });

  // Facebook webhook for receiving leads (POST)
  app.post("/webhook/facebook", async (req, res) => {
    try {
      const body = req.body;
      
      console.log("Facebook webhook received:", JSON.stringify({ object: body.object, entryCount: body.entry?.length }, null, 2));

      if (body.object === "page") {
        for (const entry of body.entry || []) {
          for (const change of entry.changes || []) {
            if (change.field === "leadgen") {
              const leadgenData = change.value;
              const leadId = leadgenData.leadgen_id;
              const formId = leadgenData.form_id;
              
              console.log(`New Facebook lead received: ${leadId} from form ${formId}`);
              
              // Fetch full lead details from Facebook Graph API
              const leadDetails = await fetchLeadDetails(leadId);
              
              // Log Facebook lead received
              await logActivity({
                type: "facebook_lead_received",
                status: "success",
                service: "Facebook",
                direction: "incoming",
                summary: `Lead received from form ${formId}`,
                details: { leadId, formId },
              });

              if (leadDetails) {
                // Create Attio record with actual lead data
                const recordId = await createAttioRecord({
                  name: leadDetails.name,
                  email: leadDetails.email,
                  phone: leadDetails.phone,
                });
                
                if (recordId) {
                  console.log(`Created Attio record ${recordId} for Facebook lead ${leadId} (${leadDetails.name || leadDetails.email || leadDetails.phone})`);
                  await logActivity({
                    type: "attio_record_created",
                    status: "success",
                    service: "Attio",
                    direction: "outgoing",
                    summary: `Created record for ${leadDetails.name || leadDetails.email || "lead"}`,
                    details: { recordId, leadId, name: leadDetails.name, email: leadDetails.email, phone: leadDetails.phone },
                  });
                } else {
                  await logActivity({
                    type: "attio_record_created",
                    status: "failed",
                    service: "Attio",
                    direction: "outgoing",
                    summary: `Failed to create record for lead ${leadId}`,
                    details: { leadId, name: leadDetails.name },
                  });
                }
              } else {
                // Fallback: create basic record with lead ID reference
                console.warn(`Could not fetch lead details for ${leadId}, creating placeholder record`);
                const recordId = await createAttioRecord({
                  name: `Facebook Lead ${leadId}`,
                });
                
                if (recordId) {
                  console.log(`Created placeholder Attio record ${recordId} for Facebook lead ${leadId}`);
                  await logActivity({
                    type: "attio_record_created",
                    status: "success",
                    service: "Attio",
                    direction: "outgoing",
                    summary: `Created placeholder record for lead ${leadId}`,
                    details: { recordId, leadId },
                  });
                }
              }
            }
          }
        }
      }

      res.status(200).send("EVENT_RECEIVED");
    } catch (error) {
      console.error("Error processing Facebook webhook:", error);
      res.status(200).send("EVENT_RECEIVED");
    }
  });

  return httpServer;
}
