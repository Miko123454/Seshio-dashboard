require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { Client, GatewayIntentBits } = require('discord.js');
const Stripe = require('stripe');

const app = express();
const PORT = process.env.PORT || 3000;

// STRIPE API PIESLĒGŠANA
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

app.use(express.json());

// --- NEREDZAMAIS TILTS (CORS) ---
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use(express.static('public'));

// --- MONGODB MODELIS (Pievienots viss ER:LC un SSD) ---
const settingsSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    language: { type: String, default: 'lv' },
    isPremium: { type: Boolean, default: false },
    botName: { type: String, default: 'Seshio' },
    pingRole: String,
    
    // STARTUP / VOTE Dati
    startImage: String,
    startText: String,
    embedTitle: String,
    embedCode: String,
    serverLink: String,
    
    // SSD / ER:LC Dati
    erlcApiKey: { type: String, default: '' },
    erlcServerId: { type: String, default: '' },
    autoSsdEnabled: { type: Boolean, default: false },
    autoSsdThreshold: { type: Number, default: 5 },
    ssdTitle: { type: String, default: '' },
    ssdImage: { type: String, default: '' },
    ssdText: { type: String, default: '' }
});
const Settings = mongoose.model('Settings', settingsSchema);

// --- DISCORD KLIENSTS ---
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- 👑 STRIPE APMAKSAS SAITES ĢENERĒŠANA ---
app.post('/api/create-checkout-session', async (req, res) => {
    const { guildId } = req.body;
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price: 'price_1TFIfKIGzXSI9sIxgygqhbNZ', // Tavs Stripe Cenas ID
                    quantity: 1,
                },
            ],
            mode: 'subscription',
            success_url: 'https://seshio.lat/?premium=success',
            cancel_url: 'https://seshio.lat/?premium=canceled',
            metadata: { guildId: guildId }
        });
        res.json({ url: session.url });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- 👑 STRIPE WEBHOOK ---
app.post('/api/webhook', async (req, res) => {
    const event = req.body;
    if (event.type === 'checkout.session.completed' || event.type === 'invoice.payment_succeeded') {
        const session = event.data.object;
        const guildId = session.metadata ? session.metadata.guildId : null;
        if (guildId) {
            await Settings.findOneAndUpdate({ guildId }, { isPremium: true }, { upsert: true });
            console.log(`✅ PREMIUM AKTIVIZĒTS: ${guildId}`);
        }
    }
    res.json({received: true});
});

// --- WEB API (Datu saglabāšana un ielāde) ---
app.post('/api/save-settings', async (req, res) => {
    const { 
        guildId, language, botName, pingRole, 
        startImage, startText, embedTitle, embedCode, serverLink,
        erlcApiKey, erlcServerId, autoSsdEnabled, autoSsdThreshold, ssdTitle, ssdImage, ssdText
    } = req.body;
    
    if (!guildId) return res.status(400).json({ error: "Trūkst Guild ID" });
    
    try {
        await Settings.findOneAndUpdate(
            { guildId }, 
            { 
                language, botName, pingRole, 
                startImage, startText, embedTitle, embedCode, serverLink,
                erlcApiKey, erlcServerId, autoSsdEnabled, autoSsdThreshold, ssdTitle, ssdImage, ssdText
            }, 
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/settings/:guildId', async (req, res) => {
    try {
        const data = await Settings.findOne({ guildId: req.params.guildId });
        res.json(data || { isPremium: false }); 
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/bot-guilds', (req, res) => {
    res.json(client.guilds.cache.map(g => g.id));
});

app.get('/api/roles/:guildId', async (req, res) => {
    try {
        const guild = await client.guilds.fetch(req.params.guildId).catch(() => null);
        if (!guild) return res.status(404).json({ error: "Bots nav šajā serverī!" });
        const roles = guild.roles.cache.filter(role => role.id !== guild.id).map(role => ({ id: role.id, name: role.name }));
        res.json(roles);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        console.log('✅ DB savienota');
        app.listen(PORT, '0.0.0.0', () => console.log(`✅ API Port ${PORT}`));
        client.login(process.env.DISCORD_TOKEN).then(() => console.log(`✅ Discord Tilts pieslēdzās!`));
    })
    .catch(err => console.error("❌ Kļūda ar DB:", err));
