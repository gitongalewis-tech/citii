# Citiscape WhatsApp Assistant

Two-app starter for a Citiscape property assistant: a React operations dashboard and an Express API. The API includes WhatsApp Cloud API webhook/send-message integration, WordPress property/service sync, MongoDB persistence, human handoff, and a rule-based assistant with optional OpenAI responses for open-ended messages.

## Requirements

- Node.js 20+
- MongoDB Atlas URI
- Meta WhatsApp Cloud API phone number ID, access token, and webhook verify token
- WordPress Application Password with read access (create a fresh one after rotating the credential shared in chat)

## Start

1. `cp backend/.env.example backend/.env` and fill in the values.
2. `npm install`
3. `npm run install:all`
4. `npm run dev` (dashboard on `http://localhost:5173`, API on `http://localhost:4000`).

For a public WhatsApp webhook, deploy the backend behind HTTPS and set the Meta callback URL to `/api/whatsapp/webhook`; use the same `WHATSAPP_VERIFY_TOKEN` in Meta. Configure the app's `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` from Meta. Never commit `.env` files.

## Dashboard access

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in backend `.env`. The dashboard signs in through the API and stores its short-lived JWT in session storage. Set a strong unique password before exposing the dashboard publicly. Add a reverse proxy / HTTPS and restrict access in production.

## Features

- Inbox with conversation search, unread counts, human takeover/release, notes, and manual replies.
- Website property listing sync from the WordPress REST API and searchable property cards in the dashboard.
- WhatsApp webhook verification and inbound message handling; bot replies with property matches, valuation, rentals, management, and viewing booking intake.
- Optional OpenAI fallback for open-ended replies, grounded in synced property data and constrained to hand appointment confirmation to staff.
- MongoDB-backed contacts, conversations, messages, listings, and appointment requests.
- Human takeover pauses automated replies for that conversation until an agent releases it.

Viewing requests are stored as requests for agent confirmation; they are not represented as confirmed bookings. Configure the Meta webhook subscription for `messages` and keep the webhook publicly reachable.

The property sync tries the common WordPress endpoints `/wp-json/wp/v2/property` and `/wp-json/wp/v2/properties`. If this site's custom post type uses a different REST route or field names, set `WORDPRESS_PROPERTY_ENDPOINT` and adjust the field mapping in `backend/src/wordpress.js`. Configure `META_APP_SECRET` to validate webhook signatures.

## API overview

- `GET /api/health`
- `POST /api/auth/login`
- `GET /api/conversations`, `GET /api/conversations/:id`
- `POST /api/conversations/:id/reply`
- `PATCH /api/conversations/:id/takeover`
- `POST /api/conversations/:id/notes`
- `GET /api/properties`, `POST /api/properties/sync`
- `GET /api/viewings`, `PATCH /api/viewings/:id`
- `POST /api/whatsapp/webhook`, `GET /api/whatsapp/webhook`

All dashboard endpoints except health and the WhatsApp webhook require a bearer token.
# citii
# citii
