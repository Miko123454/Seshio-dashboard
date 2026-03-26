require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
const PORT = process.env.PORT || 3000;

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

// --- MONGODB MODELIS ---
const settingsSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    pingRole: String,
    startImage: String,
    startText: String,
    embedTitle: String,
    embedCode: String,
    serverLink: String,
    language: { type: String, default: 'lv' }
});
const Settings = mongoose.model('Settings', settingsSchema);

// --- DISCORD KLIENSTS (TIKAI LAI LASĪTU LOMAS LAPAI) ---
// Šis vairs nav pilnvērtīgs bots. Šis tikai nolasa informāciju no serveriem, ko parādīt panelī.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- WEB API (Ko izsauc Vercel lapa) ---
app.post('/api/save-settings', async (req, res) => {
    const { guildId, pingRole, startImage, startText, embedTitle, embedCode, serverLink, language } = req.body;
    if (!guildId) return res.status(400).json({ error: "Trūkst Guild ID" });
    try {
        await Settings.findOneAndUpdate(
            { guildId }, 
            { pingRole, startImage, startText, embedTitle, embedCode, serverLink, language }, 
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/settings/:guildId', async (req, res) => {
    try {
        const data = await Settings.findOne({ guildId: req.params.guildId });
        res.json(data || {}); 
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
        console.log('✅ DB savienota (Render API Tilts)');
        app.listen(PORT, '0.0.0.0', () => console.log(`✅ Web Backend: Port ${PORT}`));
        
        client.login(process.env.DISCORD_TOKEN).then(() => {
            console.log(`✅ Tilts pieslēdzās Discordam, lai lasītu lomas!`);
        });
    })
    .catch(err => console.error("❌ Kļūda savienojoties ar DB:", err));
