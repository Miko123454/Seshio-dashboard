require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { Client, GatewayIntentBits } = require('discord.js');
const Stripe = require('stripe');

const app = express();
const PORT = process.env.PORT || 3000;

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

app.use(express.json());

// --- CORS ---
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// --- DB MODELIS ---
const settingsSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    pingRole: String,
    startImage: String,
    startText: String,
    embedTitle: String,
    embedCode: String,
    serverLink: String,
    language: { type: String, default: 'lv' },
    isPremium: { type: Boolean, default: false }
});
const Settings = mongoose.model('Settings', settingsSchema);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- 👑 STRIPE CHECKOUT ---
app.post('/api/create-checkout-session', async (req, res) => {
    const { guildId } = req.body;
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price: 'price_1TFIfKIGzXSI9sIxgygqhbNZ', 
                quantity: 1,
            }],
            mode: 'subscription',
            success_url: 'https://seshio.lat/?premium=success',
            cancel_url: 'https://seshio.lat/?premium=canceled',
            metadata: { guildId: guildId }
        });
        res.json({ url: session.url });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 👑 STRIPE WEBHOOK ---
app.post('/api/webhook', async (req, res) => {
    const event = req.body;
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const guildId = session.metadata.guildId;
        await Settings.findOneAndUpdate({ guildId }, { isPremium: true }, { upsert: true });
        console.log(`✅ Premium aktivizēts: ${guildId}`);
    }
    res.json({ received: true });
});

// --- API ENDPOINTS ---
app.post('/api/save-settings', async (req, res) => {
    const { guildId, pingRole, startImage, startText, embedTitle, embedCode, serverLink, language } = req.body;
    try {
        await Settings.findOneAndUpdate({ guildId }, { pingRole, startImage, startText, embedTitle, embedCode, serverLink, language }, { upsert: true });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/settings/:guildId', async (req, res) => {
    try {
        const data = await Settings.findOne({ guildId: req.params.guildId });
        res.json(data || { isPremium: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/bot-guilds', (req, res) => { res.json(client.guilds.cache.map(g => g.id)); });

app.get('/api/roles/:guildId', async (req, res) => {
    try {
        const guild = await client.guilds.fetch(req.params.guildId);
        const roles = guild.roles.cache.filter(r => r.id !== guild.id).map(r => ({ id: r.id, name: r.name }));
        res.json(roles);
    } catch (err) { res.status(500).json({ error: "Gļuks ar lomām" }); }
});

mongoose.connect(process.env.MONGODB_URI).then(() => {
    app.listen(PORT, '0.0.0.0');
    client.login(process.env.DISCORD_TOKEN);
});
