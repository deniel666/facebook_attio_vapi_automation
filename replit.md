# ErzyCall Webhook Handler

## Overview

This is a webhook handler application for ErzyCall, a Malaysian AI phone answering service. The application receives Vapi AI call completion webhooks, analyzes call outcomes based on transcript/summary data, sends formatted Telegram notifications to the sales team, and updates lead records in Attio CRM.

The system serves as the bridge between Vapi's AI voice agent ("Maya") and the company's notification/CRM infrastructure, replacing part of their Make.com automation workflow.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming (supports light/dark mode)
- **Build Tool**: Vite with hot module replacement

The frontend provides a dashboard interface for monitoring call logs and viewing webhook processing results.

### Backend Architecture
- **Framework**: Express.js 5 with TypeScript
- **Runtime**: Node.js with ESM modules
- **API Structure**: RESTful endpoints under `/api/` prefix
- **Webhook Endpoint**: POST `/webhook/vapi` for receiving Vapi call completion events

Key backend services:
1. **Outcome Service** (`server/services/outcome.ts`): Analyzes call transcripts and summaries to determine outcomes (Booked, Interested, Not Interested, No Answer, Voicemail, Needs Review)
2. **Telegram Service** (`server/services/telegram.ts`): Formats and sends notifications with WhatsApp deep links
3. **Attio Service** (`server/services/attio.ts`): Updates CRM records with call outcomes, includes phone number lookup
4. **Vapi Service** (`server/services/vapi.ts`): Fetches historical calls from Vapi API for retroactive processing

### Data Storage
- **Schema Definition**: Drizzle ORM with Zod validation (`shared/schema.ts`)
- **Database**: PostgreSQL (configured via `DATABASE_URL` environment variable)
- **Storage Implementation**: DatabaseStorage class (`server/storage.ts`) persists all data to PostgreSQL
- **Database Tables**:
  - `call_logs`: Stores processed Vapi call records with outcomes
  - `activity_logs`: Tracks all service interactions (Facebook, Attio, Telegram, Vapi)
- **Migrations**: Drizzle Kit for database migrations (use `npm run db:push` to sync schema)

### Validation Layer
- Zod schemas for webhook payload validation
- Type-safe data flow from API to services using inferred types from Drizzle-Zod

### Build System
- Development: TSX for TypeScript execution with Vite dev server
- Production: esbuild for server bundling, Vite for client bundling
- Output: Combined `dist/` directory with server code and static assets

## External Dependencies

### Vapi AI (Voice Agent)
- Sends POST webhooks to `/webhook/vapi` on call completion
- Payload includes: call ID, duration, customer phone, transcript, summary, ended reason
- Assistant ID and phone number configured for the "Maya" agent

**Maya Assistant Configuration:**
- Assistant ID: `7e6aec66-2d12-4279-a1e0-52686ecc65b8`
- Phone ID: `d57c8317-004c-4975-92b5-e553b21ea8d0`

### Telegram Bot API
- Used for real-time sales team notifications
- Requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` environment variables
- Messages include call outcome, phone number, duration, summary, and WhatsApp quick-reply links

### Attio CRM API
- REST API at `https://api.attio.com/v2`
- Requires `ATTIO_API_KEY` environment variable
- Updates `call_outcome` field on people records
- Record lookup by phone number (fallback when no record ID provided)
- Record IDs can also be passed via Vapi webhook metadata (`attio_record_id`)

**Required Attio Configuration:**
The following fields are updated on people records:
1. `call_outcome` (select field) - uses these options:
   - Booked
   - Answered_Interested
   - Answered_Not_Interested
   - No_Answer
   - Voicemail_Left
   - Needs_Review
2. `call_summary` (text field) - AI-generated call summary
3. `call_recording` (URL field) - Link to call recording
4. `lead_status` (select field) - set to "New" when creating records from Facebook leads

### Historical Import Feature
- **Endpoint**: POST `/api/import-historical`
- Fetches completed calls from Vapi API (past 24/48/72 hours)
- Processes each call through outcome determination logic
- Looks up Attio records by phone number and updates `call_outcome`
- Dashboard provides import buttons for easy triggering

### Facebook Conversions API
- Sends call outcome events back to Meta for conversion optimization
- Endpoint: `https://graph.facebook.com/v24.0/{DATASET_ID}/events`
- Dataset ID: `2318502998560800`
- Events sent: Lead Qualified (Booked), Lead Interested, Lead Not Interested, Lead No Answer, Lead Voicemail, Lead Needs Review
- Phone numbers are hashed with SHA256 before sending

### Facebook Lead Ads Webhook
- **Verification Endpoint**: GET `/webhook/facebook` - Facebook webhook verification
- **Lead Webhook**: POST `/webhook/facebook` - Receives new leads from Facebook Lead Ads
- Verify Token: `erzycall_webhook_verify` (or set via `FACEBOOK_VERIFY_TOKEN` env var)
- Creates new Attio CRM records for incoming leads

### PostgreSQL Database
- Connection via `DATABASE_URL` environment variable
- Used for persistent call log storage
- Session storage via `connect-pg-simple` (available but not currently active)

### Environment Variables Required
- `DATABASE_URL`: PostgreSQL connection string
- `TELEGRAM_BOT_TOKEN`: Telegram bot authentication
- `TELEGRAM_CHAT_ID`: Target chat for notifications
- `ATTIO_API_KEY`: Attio CRM API authentication
- `VAPI_API_KEY`: Vapi API key for fetching historical calls
- `FACEBOOK_ACCESS_TOKEN`: Facebook Conversions API access token
- `FACEBOOK_VERIFY_TOKEN`: (Optional) Custom verify token for Facebook webhooks