import type { CallOutcome } from "@shared/schema";

const ATTIO_API_KEY = process.env.ATTIO_API_KEY;
const ATTIO_API_BASE_URL = "https://api.attio.com/v2";

// Map our internal outcomes to Attio's call_outcome select options
const OUTCOME_TO_ATTIO: Record<CallOutcome, string> = {
  "Booked": "Booked",
  "Interested": "Answered_Interested",
  "Not Interested": "Answered_Not_Interested",
  "No Answer": "No_Answer",
  "Voicemail": "Voicemail_Left",
  "Needs Review": "Needs_Review",
};

// Attio attribute IDs for custom fields
const ATTIO_FIELD_IDS = {
  call_summary: "53e00f37-a9ba-45e2-8027-44457df8fc3c",
  call_recording: "29d90c9e-b1a1-4229-8738-561fbeec184e",
};

export async function findAttioRecordByPhone(phoneNumber: string): Promise<string | null> {
  if (!ATTIO_API_KEY || !phoneNumber || phoneNumber === "Unknown") {
    return null;
  }

  try {
    const normalizedPhone = phoneNumber.startsWith("+") ? phoneNumber : `+${phoneNumber}`;
    
    const response = await fetch(
      `${ATTIO_API_BASE_URL}/objects/people/records/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ATTIO_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filter: {
            phone_numbers: normalizedPhone
          },
          limit: 1
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Attio search error for ${phoneNumber}:`, response.status, errorText);
      return null;
    }

    const data = await response.json();
    
    if (data.data && data.data.length > 0) {
      const recordId = data.data[0]?.id?.record_id;
      console.log(`Found Attio record ${recordId} for phone ${phoneNumber}`);
      return recordId || null;
    }
    
    console.log(`No Attio record found for phone ${phoneNumber}`);
    return null;
  } catch (error) {
    console.error("Failed to search Attio:", error);
    return null;
  }
}

export async function findAttioRecordByEmail(email: string): Promise<string | null> {
  if (!ATTIO_API_KEY || !email) {
    return null;
  }

  try {
    const response = await fetch(
      `${ATTIO_API_BASE_URL}/objects/people/records/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ATTIO_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filter: {
            email_addresses: email.toLowerCase()
          },
          limit: 1
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Attio search error for ${email}:`, response.status, errorText);
      return null;
    }

    const data = await response.json();
    
    if (data.data && data.data.length > 0) {
      const recordId = data.data[0]?.id?.record_id;
      return recordId || null;
    }
    
    return null;
  } catch (error) {
    console.error("Failed to search Attio by email:", error);
    return null;
  }
}

interface AttioUpdateOptions {
  outcome: CallOutcome;
  summary?: string;
  recordingUrl?: string;
}

export async function updateAttioRecord(
  recordId: string,
  options: AttioUpdateOptions
): Promise<boolean> {
  if (!ATTIO_API_KEY) {
    console.warn("Attio API key not configured");
    return false;
  }

  if (!recordId) {
    console.warn("No Attio record ID provided, skipping update");
    return false;
  }

  const attioOutcome = OUTCOME_TO_ATTIO[options.outcome];
  
  const allValues: Record<string, string> = {
    call_outcome: attioOutcome,
  };
  
  if (options.summary) {
    allValues[ATTIO_FIELD_IDS.call_summary] = options.summary;
  }
  
  if (options.recordingUrl) {
    allValues[ATTIO_FIELD_IDS.call_recording] = options.recordingUrl;
  }

  // Try with all fields first, then fall back to just outcome if fields don't exist
  const fieldSets = [
    allValues,
    { call_outcome: attioOutcome, [ATTIO_FIELD_IDS.call_summary]: options.summary || "" },
    { call_outcome: attioOutcome },
  ];

  for (const values of fieldSets) {
    // Skip empty optional fields
    const cleanValues: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      if (value) cleanValues[key] = value;
    }
    
    try {
      const response = await fetch(
        `${ATTIO_API_BASE_URL}/objects/people/records/${recordId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${ATTIO_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            data: {
              values: cleanValues,
            },
          }),
        }
      );

      if (response.ok) {
        return true;
      }
      
      const error = await response.text();
      
      // If field doesn't exist, try with fewer fields
      if (error.includes("value_not_found") || error.includes("Cannot find attribute")) {
        console.log("Some Attio fields missing, trying with fewer fields...");
        continue;
      }
      
      console.error("Attio API error:", response.status, error);
      return false;
    } catch (error) {
      console.error("Failed to update Attio record:", error);
      return false;
    }
  }
  
  return false;
}

interface CreateAttioRecordParams {
  name?: string;
  email?: string;
  phone?: string;
  leadId?: string;
}

export async function createAttioRecord(params: CreateAttioRecordParams): Promise<string | null> {
  if (!ATTIO_API_KEY) {
    console.warn("Attio API key not configured");
    return null;
  }

  const values: Record<string, unknown> = {};
  
  // Parse name into first_name and last_name, or use "Unknown" as fallback
  const fullName = params.name || "Unknown Lead";
  const nameParts = fullName.trim().split(/\s+/);
  const firstName = nameParts[0] || "Unknown";
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "Lead";
  
  values.name = [{
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
  }];
  
  if (params.email) {
    values.email_addresses = [{ email_address: params.email }];
  }
  
  if (params.phone) {
    const normalizedPhone = params.phone.startsWith("+") ? params.phone : `+${params.phone}`;
    values.phone_numbers = [{ original_phone_number: normalizedPhone }];
  }

  // Try creating with lead_status first, then fallback without it if field doesn't exist
  const valueSets = [
    { ...values, lead_status: "New" },
    values, // Fallback without lead_status
  ];

  for (const valueSet of valueSets) {
    try {
      const response = await fetch(
        `${ATTIO_API_BASE_URL}/objects/people/records`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ATTIO_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            data: {
              values: valueSet,
            },
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        const recordId = data.data?.id?.record_id;
        const hasLeadStatus = valueSet.lead_status ? " with lead_status=New" : "";
        console.log(`Created Attio record ${recordId} for ${params.name || params.phone || params.email}${hasLeadStatus}`);
        return recordId || null;
      }

      const error = await response.text();
      // If it's a field validation error and we haven't tried without lead_status yet, continue
      if (error.includes("lead_status") && valueSet.lead_status) {
        console.warn("Attio lead_status field not found, retrying without it");
        continue;
      }
      
      console.error("Attio create record error:", response.status, error);
      return null;
    } catch (error) {
      console.error("Failed to create Attio record:", error);
      return null;
    }
  }
  
  return null;
}
