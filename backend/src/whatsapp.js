import { Conversation, Contact, Message, Property, ViewingRequest } from './models.js';
const apiBase = () => `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || 'v23.0'}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
export async function sendWhatsApp(to, body) {
  if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) { console.warn('WhatsApp is not configured; reply was saved only.'); return null; }
  const r = await fetch(apiBase(), { method: 'POST', headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body } }) });
  const data = await r.json(); if (!r.ok) throw new Error(data.error?.message || 'WhatsApp send failed'); return data;
}
function extractText(msg) { return msg.type === 'text' ? msg.text?.body : msg.type === 'interactive' ? msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title : msg.type === 'button' ? msg.button?.text : ''; }
function price(v) { if (!v) return ''; return /^\d/.test(v) ? `KSh ${Number(v).toLocaleString('en-KE')}` : v; }
async function intelligentReply(text, conversation) {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const [history, listings] = await Promise.all([
      Message.find({ conversationId: conversation._id }).sort({ createdAt: -1 }).limit(8).lean(),
      Property.find().limit(50).lean()
    ]);
    const propertyContext = listings.map(p => `${p.title} | ${p.location || 'Kenya'} | ${p.price || 'price on request'} | ${p.url || ''}`).join('\n');
    const messages = [
      { role: 'system', content: `You are Citiscape Valuers & Estate Agents' WhatsApp assistant in Kenya. Be warm, concise, and helpful. Help with property searches, buying, rentals, viewings, residential/commercial/land/fixed asset/industrial valuations, and property management. Only state listing details present in this data; never invent availability, legal advice, prices, or confirmed appointments. Viewing requests require a human agent to confirm. Ask one clear follow-up question when needed. Website: ${process.env.WORDPRESS_URL}. Available listings:\n${propertyContext || 'No synced listings are currently available.'}` },
      ...history.reverse().map(m => ({ role: m.direction === 'inbound' ? 'user' : 'assistant', content: m.text }))
    ];
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(12000),
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', messages, max_tokens: 220 })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || 'AI response unavailable');
    return result.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) { console.warn('AI assistant fallback:', error.message); return null; }
}
async function respond(text, c) {
  const s = text.toLowerCase();
  if (c.flow === 'viewing_details') {
    const request = await ViewingRequest.findOne({ conversationId: c._id, status: 'pending' }).sort({ createdAt: -1 });
    if (request) { request.name = c.contactName; request.preferredDate = text; request.notes = `Client preference: ${text}`; await request.save(); }
    c.flow = ''; await c.save();
    return 'Thanks, I’ve sent your viewing request and preferred timing to our team. A Citiscape agent will confirm availability with you shortly.';
  }
  if (/^(hi|hello|hey|habari|start)\b/.test(s)) return `Hello${c.contactName ? ` ${c.contactName}` : ''}! Welcome to Citiscape Valuers & Estate Agents. I can help you buy, rent, find a property, request a viewing, get a valuation or ask about property management. What are you looking for?`;
  if (/view|visit|tour|see it/.test(s)) { await ViewingRequest.create({ conversationId: c._id, phone: c.phone, propertyTitle: text.replace(/.*(?:view|visit|tour|see it)\s*/i, '').trim() || 'To be confirmed' }); c.flow = 'viewing_details'; c.intent = 'Viewing'; await c.save(); return 'I can arrange that. Please share your preferred date and time for the viewing, plus your name if it is different from your WhatsApp profile. A Citiscape agent will confirm availability shortly.'; }
  if (/valuation|value my|value of|appraisal/.test(s)) return 'We offer residential, commercial, land, fixed asset and industrial property valuations. Please share the property location, type and your preferred contact details, and our valuations team will follow up with a quote.';
  if (/manage|management|landlord/.test(s)) return 'Citiscape provides property management services. Tell me whether the property is residential or commercial, its location and the best number to reach you, and our team will assist.';
  if (/rent|lease|tenant/.test(s)) return 'I can help you find a rental. What area, monthly budget and number of bedrooms do you have in mind?';
  if (/buy|purchase|plot|land|commercial|apartment|house|property|bedroom|budget|ksh|million/.test(s)) {
    const listings = await Property.find().limit(100).lean(); const area = s.match(/(?:in|at|around)\s+([a-z ]{3,25})/i)?.[1]?.trim();
    const matches = listings.filter(p => (!area || (p.location || p.title).toLowerCase().includes(area)) && (!/rent|lease/.test(s) || /rent/i.test(`${p.status} ${p.type}`))).slice(0, 4);
    if (matches.length) return `Here are a few options${area ? ` around ${area}` : ''}:\n${matches.map(p => `• ${p.title}${p.location ? ` — ${p.location}` : ''}${p.price ? ` — ${price(p.price)}` : ''}${p.url ? `\n${p.url}` : ''}`).join('\n')}\n\nWould you like details or to request a viewing?`;
    return `I can help find a match. Please tell me the area, your budget, and whether you want to buy or rent (plus bedrooms if relevant). You can also browse our listings at ${process.env.WORDPRESS_URL || 'https://citiscapevaluers.com'}.`;
  }
  if (/human|agent|person|call me|speak to/.test(s)) { c.humanTakeover = true; c.assignedTo = 'Team'; await c.save(); return 'I’ve flagged this for our team. A Citiscape agent will follow up with you as soon as possible.'; }
  return await intelligentReply(text, c) || 'I can help with buying, renting, property searches, viewing requests, valuations and property management. Tell me what you need, and I’ll guide you or bring in a Citiscape agent.';
}
export async function handleInbound(msg, profile) {
  const phone = msg.from; if (!phone) return; const text = extractText(msg) || `[${msg.type} message received]`;
  const name = profile?.profile?.name || 'WhatsApp client';
  await Contact.findOneAndUpdate({ phone }, { phone, waId: phone, name }, { upsert: true });
  let c = await Conversation.findOne({ phone }); if (!c) c = await Conversation.create({ phone, contactName: name });
  c.contactName = name; c.lastMessage = text; c.lastMessageAt = new Date(); c.unread = (c.unread || 0) + 1;
  const lower = text.toLowerCase();
  if (/valuation|appraisal/.test(lower)) c.intent = 'Valuation'; else if (/rent|lease/.test(lower)) c.intent = 'Renting'; else if (/view|visit|tour/.test(lower)) c.intent = 'Viewing'; else if (/buy|purchase|house|property|plot|land/.test(lower)) c.intent = 'Buying';
  await c.save();
  await Message.create({ conversationId: c._id, direction: 'inbound', text, sender: name, externalId: msg.id });
  if (!c.humanTakeover) {
    const reply = await respond(text, c); const sent = await sendWhatsApp(phone, reply);
    await Message.create({ conversationId: c._id, direction: 'outbound', text: reply, sender: 'bot', externalId: sent?.messages?.[0]?.id });
    c.lastMessage = reply; c.lastMessageAt = new Date(); await c.save();
  }
}
