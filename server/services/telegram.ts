import type { CallOutcome } from "@shared/schema";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function formatPhoneForWhatsApp(phone: string): string {
  // Remove + and any spaces/dashes
  return phone.replace(/[+\s-]/g, "");
}

function buildTelegramMessage(
  outcome: CallOutcome,
  phone: string,
  duration: number,
  summary: string,
  endedReason: string
): string {
  const whatsAppNumber = formatPhoneForWhatsApp(phone);
  
  switch (outcome) {
    case "Booked":
      return `🎉 BOOKING CONFIRMED!

📞 ${phone}
⏱ Duration: ${duration}s

📝 Summary: ${summary || "No summary available"}

💬 WhatsApp: https://wa.me/${whatsAppNumber}?text=Hi,%20thank%20you%20for%20booking!`;

    case "Interested":
      return `🔥 INTERESTED LEAD!

📞 ${phone}
⏱ Duration: ${duration}s

📝 Summary: ${summary || "No summary available"}

💬 WhatsApp: https://wa.me/${whatsAppNumber}?text=Hi,%20thanks%20for%20your%20interest!`;

    case "Not Interested":
      return `❌ Not Interested

📞 ${phone}
⏱ Duration: ${duration}s

📝 Summary: ${summary || "No summary available"}`;

    case "No Answer":
      return `📵 No Answer

📞 ${phone}

💬 WhatsApp: https://wa.me/${whatsAppNumber}?text=Hi,%20we%20tried%20calling%20you.`;

    case "Voicemail":
      return `📫 Voicemail Left

📞 ${phone}

💬 WhatsApp: https://wa.me/${whatsAppNumber}?text=Hi,%20we%20left%20you%20a%20voicemail.`;

    case "Needs Review":
      return `⚠️ Call Completed - Review Needed

📞 ${phone}
⏱ Duration: ${duration}s
📊 Ended: ${endedReason}

📝 Summary: ${summary || "No summary available"}`;

    default:
      return `📞 Call Processed

📞 ${phone}
⏱ Duration: ${duration}s
📊 Outcome: ${outcome}

📝 Summary: ${summary || "No summary available"}`;
  }
}

export async function sendTelegramNotification(
  outcome: CallOutcome,
  phone: string,
  duration: number,
  summary: string,
  endedReason: string
): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn("Telegram credentials not configured");
    return false;
  }

  const message = buildTelegramMessage(outcome, phone, duration, summary, endedReason);
  
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Telegram API error:", error);
      return false;
    }

    const result = await response.json();
    return result.ok === true;
  } catch (error) {
    console.error("Failed to send Telegram notification:", error);
    return false;
  }
}
