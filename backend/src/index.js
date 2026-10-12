import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Conversation, Message, Contact, Property, ViewingRequest } from './models.js';
import { sendWhatsApp, handleInbound } from './whatsapp.js';
import { syncWordPressProperties } from './wordpress.js';

const app = express();
app.use(cors({ origin: process.env.FRONTEND_ORIGIN?.split(',') || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
const port = process.env.PORT || 4000;

function auth(req, res, next) {
  try { req.user = jwt.verify((req.headers.authorization || '').replace(/^Bearer\s+/i, ''), process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Please sign in again.' }); }
}
app.get('/api/health', (_req, res) => res.json({ ok: true, database: mongoose.connection.readyState === 1 }));
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!process.env.ADMIN_PASSWORD || email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Email or password is incorrect.' });
  const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user: { email, name: 'Citiscape Team' } });
});
app.get('/api/conversations', auth, async (req, res) => {
  const rows = await Conversation.find().sort({ lastMessageAt: -1 }).limit(100).lean();
  res.json(rows);
});
app.get('/api/conversations/:id', auth, async (req, res) => {
  const [conversation, messages] = await Promise.all([Conversation.findByIdAndUpdate(req.params.id, { unread: 0 }, { new: true }).lean(), Message.find({ conversationId: req.params.id }).sort({ createdAt: 1 }).lean()]);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found.' });
  res.json({ conversation, messages });
});
app.post('/api/conversations/:id/reply', auth, async (req, res) => {
  const { text } = req.body || {}; if (!text?.trim()) return res.status(400).json({ error: 'Message is required.' });
  const c = await Conversation.findById(req.params.id); if (!c) return res.status(404).json({ error: 'Conversation not found.' });
  const result = await sendWhatsApp(c.phone, text.trim());
  await Message.create({ conversationId: c.id, direction: 'outbound', text: text.trim(), sender: 'agent', externalId: result?.messages?.[0]?.id });
  c.lastMessage = text.trim(); c.lastMessageAt = new Date(); await c.save(); res.json({ ok: true });
});
app.patch('/api/conversations/:id/takeover', auth, async (req, res) => {
  const c = await Conversation.findByIdAndUpdate(req.params.id, { humanTakeover: Boolean(req.body?.active), assignedTo: req.body?.active ? req.user.email : null }, { new: true });
  if (!c) return res.status(404).json({ error: 'Conversation not found.' }); res.json(c);
});
app.post('/api/conversations/:id/notes', auth, async (req, res) => {
  const note = String(req.body?.text || '').trim(); if (!note) return res.status(400).json({ error: 'Note is required.' });
  const m = await Message.create({ conversationId: req.params.id, direction: 'internal', text: note, sender: req.user.email }); res.json(m);
});
app.get('/api/properties', auth, async (_req, res) => res.json(await Property.find().sort({ updatedAt: -1 }).limit(200).lean()));
app.post('/api/properties/sync', auth, async (_req, res) => { try { res.json(await syncWordPressProperties()); } catch (e) { res.status(502).json({ error: e.message }); } });
app.get('/api/viewings', auth, async (_req, res) => res.json(await ViewingRequest.find().sort({ createdAt: -1 }).limit(200).lean()));
app.patch('/api/viewings/:id', auth, async (req, res) => {
  const status = ['pending', 'confirmed', 'declined', 'completed'].includes(req.body?.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'Choose a valid viewing status.' });
  const viewing = await ViewingRequest.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!viewing) return res.status(404).json({ error: 'Viewing request not found.' });
  res.json(viewing);
});

app.get('/api/whatsapp/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']);
  res.sendStatus(403);
});
app.post('/api/whatsapp/webhook', async (req, res) => {
  if (process.env.META_APP_SECRET) {
    const signature = (req.get('x-hub-signature-256') || '').replace(/^sha256=/, '');
    const expected = createHmac('sha256', process.env.META_APP_SECRET).update(req.rawBody || '').digest();
    let received; try { received = Buffer.from(signature, 'hex'); } catch { received = Buffer.alloc(0); }
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return res.sendStatus(401);
  }
  res.sendStatus(200);
  try { for (const entry of req.body?.entry || []) for (const change of entry.changes || []) for (const msg of change.value?.messages || []) await handleInbound(msg, change.value.contacts?.[0]); }
  catch (e) { console.error('WhatsApp webhook processing failed:', e.message); }
});

app.use((err, _req, res, _next) => { console.error(err.message); res.status(500).json({ error: 'Something went wrong.' }); });
mongoose.connect(process.env.MONGODB_URI).then(async () => {
  app.listen(port, () => console.log(`Citiscape API listening on ${port}`));
  if (process.env.WORDPRESS_URL) try { const out = await syncWordPressProperties(); console.log(`Imported ${out.count} website properties`); } catch (e) { console.warn('WordPress sync skipped:', e.message); }
}).catch((e) => { console.error('MongoDB connection failed:', e.message); process.exit(1); });
