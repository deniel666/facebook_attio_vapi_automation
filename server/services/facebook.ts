import crypto from "crypto";
import type { CallOutcome } from "@shared/schema";

const FACEBOOK_ACCESS_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN;
const DATASET_ID = "2318502998560800";
const API_VERSION = "v24.0";
const CONVERSIONS_API_URL = `https://graph.facebook.com/${API_VERSION}/${DATASET_ID}/events`;

// Map call outcomes to Facebook event names
const OUTCOME_TO_FB_EVENT: Record<CallOutcome, string> = {
  "Booked": "Lead Qualified",
  "Interested": "Lead Interested",
  "Not Interested": "Lead Not Interested",
  "No Answer": "Lead No Answer",
  "Voicemail": "Lead Voicemail",
  "Needs Review": "Lead Needs Review",
};

function hashSHA256(value: string): string {
  return crypto.createHash("sha256").update(value.toLowerCase().trim()).digest("hex");
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

interface ConversionEventParams {
  outcome: CallOutcome;
  phoneNumber: string;
  email?: string;
  leadId?: string;
}

function isNumericLeadId(leadId: string): boolean {
  return /^\d{15,17}$/.test(leadId);
}

export async function sendConversionEvent(params: ConversionEventParams): Promise<boolean> {
  if (!FACEBOOK_ACCESS_TOKEN) {
    console.warn("Facebook Access Token not configured, skipping conversion event");
    return false;
  }

  const eventName = OUTCOME_TO_FB_EVENT[params.outcome];
  const eventTime = Math.floor(Date.now() / 1000);

  const userData: Record<string, unknown> = {};
  
  if (params.phoneNumber && params.phoneNumber !== "Unknown") {
    userData.ph = [hashSHA256(normalizePhone(params.phoneNumber))];
  }
  
  if (params.email) {
    userData.em = [hashSHA256(params.email)];
  }
  
  // Only include lead_id if it's a valid 15-17 digit numeric ID
  if (params.leadId && isNumericLeadId(params.leadId)) {
    userData.lead_id = parseInt(params.leadId, 10);
  }

  const payload = {
    data: [
      {
        action_source: "system_generated",
        event_name: eventName,
        event_time: eventTime,
        custom_data: {
          event_source: "crm",
          lead_event_source: "ErzyCall",
        },
        user_data: userData,
      },
    ],
  };

  try {
    const response = await fetch(`${CONVERSIONS_API_URL}?access_token=${FACEBOOK_ACCESS_TOKEN}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Facebook Conversions API error:", response.status, error);
      return false;
    }

    const result = await response.json();
    console.log(`Facebook conversion event sent: ${eventName}`, result);
    return true;
  } catch (error) {
    console.error("Failed to send Facebook conversion event:", error);
    return false;
  }
}

// Webhook verification for Facebook Lead Ads
export function verifyFacebookWebhook(
  mode: string,
  token: string,
  challenge: string,
  verifyToken: string
): string | null {
  if (mode === "subscribe" && token === verifyToken) {
    return challenge;
  }
  return null;
}

interface FacebookLeadField {
  name: string;
  values: string[];
}

interface FacebookLeadResponse {
  id: string;
  created_time: string;
  field_data: FacebookLeadField[];
}

export interface ParsedFacebookLead {
  leadId: string;
  name?: string;
  email?: string;
  phone?: string;
  createdTime: string;
  rawData: Record<string, string>;
}

interface FacebookLeadGenForm {
  id: string;
  name: string;
  status: string;
}

interface FacebookLeadsResponse {
  data: Array<{
    id: string;
    created_time: string;
    field_data: FacebookLeadField[];
  }>;
  paging?: {
    cursors?: {
      after?: string;
    };
    next?: string;
  };
}

// Fetch all lead forms from a Facebook page
export async function fetchLeadForms(pageId: string): Promise<FacebookLeadGenForm[]> {
  if (!FACEBOOK_ACCESS_TOKEN) {
    console.warn("Facebook Access Token not configured");
    return [];
  }

  const url = `https://graph.facebook.com/${API_VERSION}/${pageId}/leadgen_forms?access_token=${FACEBOOK_ACCESS_TOKEN}`;
  console.log(`Fetching lead forms from page ${pageId}...`);

  try {
    const response = await fetch(url, { method: "GET" });

    if (!response.ok) {
      const error = await response.text();
      console.error("Facebook Graph API error fetching lead forms:", response.status, error);
      return [];
    }

    const data = await response.json();
    console.log(`Lead forms response:`, JSON.stringify(data, null, 2));
    return data.data || [];
  } catch (error) {
    console.error("Failed to fetch Facebook lead forms:", error);
    return [];
  }
}

// Fetch leads from a specific form
export async function fetchLeadsFromForm(formId: string, limit = 100): Promise<ParsedFacebookLead[]> {
  if (!FACEBOOK_ACCESS_TOKEN) {
    console.warn("Facebook Access Token not configured");
    return [];
  }

  const leads: ParsedFacebookLead[] = [];

  try {
    let url = `https://graph.facebook.com/${API_VERSION}/${formId}/leads?limit=${limit}&access_token=${FACEBOOK_ACCESS_TOKEN}`;
    
    while (url && leads.length < 500) {
      const response = await fetch(url, { method: "GET" });

      if (!response.ok) {
        const error = await response.text();
        console.error("Facebook Graph API error fetching leads:", response.status, error);
        break;
      }

      const data: FacebookLeadsResponse = await response.json();
      
      for (const lead of data.data || []) {
        const rawData: Record<string, string> = {};
        let name: string | undefined;
        let email: string | undefined;
        let phone: string | undefined;

        for (const field of lead.field_data || []) {
          const value = field.values?.[0] || "";
          rawData[field.name] = value;

          const fieldNameLower = field.name.toLowerCase();
          if (fieldNameLower.includes("name") || fieldNameLower === "full_name") {
            name = value;
          } else if (fieldNameLower.includes("email")) {
            email = value;
          } else if (fieldNameLower.includes("phone") || fieldNameLower.includes("tel")) {
            phone = value;
          }
        }

        leads.push({
          leadId: lead.id,
          name,
          email,
          phone,
          createdTime: lead.created_time,
          rawData,
        });
      }

      url = data.paging?.next || "";
    }

    console.log(`Fetched ${leads.length} leads from form ${formId}`);
    return leads;
  } catch (error) {
    console.error("Failed to fetch leads from form:", error);
    return [];
  }
}

// Fetch all leads from all forms on a page
export async function fetchAllLeadsFromPage(pageId: string): Promise<ParsedFacebookLead[]> {
  const forms = await fetchLeadForms(pageId);
  console.log(`Found ${forms.length} lead forms on page ${pageId}`);

  const allLeads: ParsedFacebookLead[] = [];

  for (const form of forms) {
    const leads = await fetchLeadsFromForm(form.id);
    allLeads.push(...leads);
  }

  console.log(`Total leads fetched from page: ${allLeads.length}`);
  return allLeads;
}

// Fetch lead details from Facebook Graph API
export async function fetchLeadDetails(leadId: string): Promise<ParsedFacebookLead | null> {
  if (!FACEBOOK_ACCESS_TOKEN) {
    console.warn("Facebook Access Token not configured, cannot fetch lead details");
    return null;
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${leadId}?access_token=${FACEBOOK_ACCESS_TOKEN}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Facebook Graph API error fetching lead:", response.status, error);
      return null;
    }

    const data: FacebookLeadResponse = await response.json();
    
    // Parse field data
    const rawData: Record<string, string> = {};
    let name: string | undefined;
    let email: string | undefined;
    let phone: string | undefined;

    for (const field of data.field_data || []) {
      const value = field.values?.[0] || "";
      rawData[field.name] = value;

      const fieldNameLower = field.name.toLowerCase();
      if (fieldNameLower.includes("name") || fieldNameLower === "full_name") {
        name = value;
      } else if (fieldNameLower.includes("email")) {
        email = value;
      } else if (fieldNameLower.includes("phone") || fieldNameLower.includes("tel")) {
        phone = value;
      }
    }

    console.log(`Fetched Facebook lead ${leadId}: name=${name}, email=${email}, phone=${phone}`);

    return {
      leadId: data.id,
      name,
      email,
      phone,
      createdTime: data.created_time,
      rawData,
    };
  } catch (error) {
    console.error("Failed to fetch Facebook lead details:", error);
    return null;
  }
}
