import type { CallOutcome } from "@shared/schema";

export function determineCallOutcome(
  endedReason: string,
  transcript: string,
  summary: string,
  duration: number
): CallOutcome {
  const transcriptLower = transcript.toLowerCase();
  const summaryLower = summary.toLowerCase();
  const combined = `${transcriptLower} ${summaryLower}`;

  // 1. No Answer Cases
  const noAnswerReasons = [
    "customer-did-not-answer",
    "no-answer",
    "busy",
    "failed",
  ];
  if (noAnswerReasons.includes(endedReason.toLowerCase())) {
    return "No Answer";
  }

  // 2. Voicemail
  if (
    endedReason.toLowerCase() === "voicemail" ||
    combined.includes("voicemail")
  ) {
    return "Voicemail";
  }

  // 3. Check for negative indicators FIRST (before booking check)
  const negativeIndicators = [
    "not interested",
    "no thank",
    "no, thank",
    "not for me",
    "don't call",
    "dont call",
    "do not call",
    "stop calling",
    "remove me",
    "not looking",
    "i'm busy",
    "im busy",
    "i am busy",
    "too busy",
    "call back later",
    "not now",
    "bad time",
    "wrong time",
    "can't talk",
    "cant talk",
    "cannot talk",
    "hang up",
    "hanging up",
    "goodbye",
    "no no no",
  ];
  
  if (negativeIndicators.some(phrase => combined.includes(phrase))) {
    return "Not Interested";
  }

  // 4. Booked - More strict detection
  // Must have booking keyword AND a specific time/confirmation (not just "am")
  const bookingKeywords = ["book", "appointment", "schedule", "scheduled", "booking", "confirmed"];
  const timeConfirmations = [
    "pm", "o'clock", "oclock", 
    "tomorrow", "today", 
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "next week", "this week",
    "morning", "afternoon", "evening",
    "at 1", "at 2", "at 3", "at 4", "at 5", "at 6", "at 7", "at 8", "at 9", "at 10", "at 11", "at 12",
  ];
  const positiveConfirmations = ["yes", "sure", "okay", "ok", "perfect", "great", "sounds good", "that works"];
  
  const hasBookingKeyword = bookingKeywords.some(kw => combined.includes(kw));
  const hasTimeConfirmation = timeConfirmations.some(kw => combined.includes(kw));
  const hasPositiveConfirmation = positiveConfirmations.some(kw => combined.includes(kw));
  
  // Require booking keyword + (time confirmation OR positive confirmation from customer)
  // Also check summary specifically mentions booking was confirmed
  const summaryIndicatesBooked = summaryLower.includes("booked") || 
    summaryLower.includes("confirmed") || 
    summaryLower.includes("scheduled") ||
    (summaryLower.includes("appointment") && hasPositiveConfirmation);
  
  if (hasBookingKeyword && (hasTimeConfirmation || summaryIndicatesBooked)) {
    return "Booked";
  }

  // 5. Interested - customer showed positive interest
  const interestIndicators = [
    "interested",
    "tell me more",
    "how much",
    "what's the price",
    "pricing",
    "sounds interesting",
    "want to know more",
    "send me info",
    "send information",
    "email me",
    "call me back",
  ];
  
  if (interestIndicators.some(phrase => combined.includes(phrase)) && 
      !combined.includes("not interested")) {
    return "Interested";
  }

  // 6. Duration-Based Fallback
  if (duration > 120) {
    // Very long call likely means engagement
    return "Interested";
  }
  if (duration > 60) {
    return "Needs Review";
  }
  if (duration > 30) {
    return "Needs Review";
  }
  
  // Short call with no clear signals
  return "Not Interested";
}
