import { determineCallOutcome } from "./outcome";

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_BASE_URL = "https://api.vapi.ai";
const MAYA_ASSISTANT_ID = "7e6aec66-2d12-4279-a1e0-52686ecc65b8";

interface VapiCall {
  id: string;
  createdAt: string;
  updatedAt: string;
  type: string;
  status: string;
  endedReason?: string;
  customer?: {
    number?: string;
  };
  assistantId?: string;
  assistant?: {
    name?: string;
  };
  transcript?: string;
  summary?: string;
  analysis?: {
    summary?: string;
  };
  messages?: Array<{
    role: string;
    message: string;
  }>;
  startedAt?: string;
  endedAt?: string;
  recordingUrl?: string;
  metadata?: {
    attio_record_id?: string;
  };
}

interface ProcessedCall {
  callId: string;
  phoneNumber: string;
  duration: number;
  outcome: string;
  endedReason: string;
  createdAt: string;
  transcript: string;
  summary: string;
  recordingUrl?: string;
  attioRecordId?: string;
}

export async function fetchHistoricalCalls(hoursBack: number = 48): Promise<VapiCall[]> {
  if (!VAPI_API_KEY) {
    throw new Error("VAPI_API_KEY is not configured");
  }

  const sinceDate = new Date();
  sinceDate.setHours(sinceDate.getHours() - hoursBack);
  
  const params = new URLSearchParams({
    limit: "100",
    createdAtGt: sinceDate.toISOString(),
    assistantId: MAYA_ASSISTANT_ID,
  });

  const response = await fetch(`${VAPI_BASE_URL}/call?${params}`, {
    headers: {
      "Authorization": `Bearer ${VAPI_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vapi API error: ${response.status} - ${errorText}`);
  }

  const calls: VapiCall[] = await response.json();
  return calls;
}

export async function fetchCallById(callId: string): Promise<VapiCall> {
  if (!VAPI_API_KEY) {
    throw new Error("VAPI_API_KEY is not configured");
  }

  const response = await fetch(`${VAPI_BASE_URL}/call/${callId}`, {
    headers: {
      "Authorization": `Bearer ${VAPI_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vapi API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

function buildTranscriptFromMessages(messages?: Array<{ role: string; message: string }>): string {
  if (!messages || messages.length === 0) return "";
  
  return messages
    .filter(m => m.role === "assistant" || m.role === "user")
    .map(m => `${m.role === "assistant" ? "AI" : "User"}: ${m.message}`)
    .join(" ");
}

function calculateDuration(startedAt?: string, endedAt?: string): number {
  if (!startedAt || !endedAt) return 0;
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  return Math.floor((end - start) / 1000);
}

export function processVapiCall(call: VapiCall): ProcessedCall {
  const transcript = call.transcript || buildTranscriptFromMessages(call.messages);
  const summary = call.analysis?.summary || call.summary || "";
  const duration = calculateDuration(call.startedAt, call.endedAt);
  const endedReason = call.endedReason || "unknown";
  
  const outcome = determineCallOutcome(endedReason, transcript, summary, duration);
  
  return {
    callId: call.id,
    phoneNumber: call.customer?.number || "Unknown",
    duration,
    outcome,
    endedReason,
    createdAt: call.createdAt,
    transcript,
    summary,
    recordingUrl: call.recordingUrl,
    attioRecordId: call.metadata?.attio_record_id,
  };
}

export async function fetchAndProcessHistoricalCalls(hoursBack: number = 48): Promise<ProcessedCall[]> {
  const calls = await fetchHistoricalCalls(hoursBack);
  
  const endedCalls = calls.filter(call => call.status === "ended");
  
  return endedCalls.map(call => processVapiCall(call));
}
