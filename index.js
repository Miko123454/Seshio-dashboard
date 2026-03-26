require('dotenv').config();
const { Client, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// --- NEREDZAMAIS TILTS (CORS) ---
// Šis atļauj tavai Vercel lapai (seshio.lat) sūtīt datus uz šo serveri!
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
    serverLink: String 
});
const Settings = mongoose.model('Settings', settingsSchema);

// --- DISCORD BOTA SAGATAVOŠANA ---
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages] });
const activeSessions = new Map();

// --- WEB API ---
app.post('/api/save-settings', async (req, res) => {
    const { guildId, pingRole, startImage, startText, embedTitle, embedCode, serverLink } = req.body;
    if (!guildId) return res.status(400).json({ error: "Trūkst Guild ID" });
    try {
        await Settings.findOneAndUpdate(
            { guildId }, 
            { pingRole, startImage, startText, embedTitle, embedCode, serverLink }, 
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

// --- DISCORD BOTA LOĢIKA ---
client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isChatInputCommand() && (interaction.commandName === 'session' || interaction.commandName === 'session-manager')) {
        const dbData = await Settings.findOne({ guildId: interaction.guildId });
        if (!dbData) return interaction.reply({ content: "⚠️ Lūdzu, vispirms iestati datus Dashboardā!", ephemeral: true });

        const requiredVotes = interaction.options.getInteger('balsis') || 1;
        const sessionId = interaction.id;
        const displayTitle = dbData.embedTitle || 'Session start-up vote';

        activeSessions.set(sessionId, { ...dbData._doc, requiredVotes, votedUsers: [], currentVotes: 0, authorId: interaction.user.id, channelId: interaction.channelId });

        const voteEmbed = new EmbedBuilder()
            .setTitle(displayTitle)
            .setDescription(`Vajadzīgas **${requiredVotes}** balsis!\n\n${dbData.startText || "Balsošana sākusies!"}`)
            .setColor('#4cebda')
            .setFooter({ text: `Balsis: 0/${requiredVotes}` });

        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`vote_${sessionId}`).setLabel('VOTE').setStyle(ButtonStyle.Success));
        await interaction.reply({ embeds: [voteEmbed], components: [row] });
    }

    if (interaction.isButton()) {
        const [action, sessionId] = interaction.customId.split('_');
        const sessionData = activeSessions.get(sessionId);
        if (!sessionData) return;

        if (action === 'vote') {
            if (sessionData.votedUsers.includes(interaction.user.id)) return interaction.reply({ content: 'Tu jau esi nobalsojis!', ephemeral: true });
            
            sessionData.currentVotes += 1;
            sessionData.votedUsers.push(interaction.user.id);
            activeSessions.set(sessionId, sessionData);

            const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setFooter({ text: `Balsis: ${sessionData.currentVotes}/${sessionData.requiredVotes}` });
            await interaction.update({ embeds: [newEmbed] });

            if (sessionData.currentVotes >= sessionData.requiredVotes) {
                try {
                    const author = await client.users.fetch(sessionData.authorId);
                    const dmEmbed = new EmbedBuilder().setTitle('Balsis savāktas!').setDescription(`Vai vēlies sākt sesiju?`).setColor('#00ff00');
                    const dmRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`start_${sessionId}`).setLabel('Sākt').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`cancel_${sessionId}`).setLabel('Atcelt').setStyle(ButtonStyle.Danger)
                    );
                    await author.send({ embeds: [dmEmbed], components: [dmRow] });
                } catch (e) { console.log("Nevarēja nosūtīt DM."); }
            }
        }

        if (action === 'start') {
            await interaction.deferUpdate();
            const channel = await client.channels.fetch(sessionData.channelId);
            
            const displayTitle = sessionData.embedTitle || 'Server start up';
            const displayCode = sessionData.embedCode ? `${sessionData.embedCode}\n\n` : '';

            const startEmbed = new EmbedBuilder()
                .setTitle(displayTitle)
                .setDescription(`${displayCode}📋 **Nobalsoja:**\n${sessionData.votedUsers.map(id => `<@${id}>`).join(', ')}`)
                .setColor('#4cebda');
            
            if (sessionData.startImage) startEmbed.setImage(sessionData.startImage);

            const components = [];
            if (sessionData.serverLink && sessionData.serverLink.trim() !== '') {
                const linkRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('Join Server')
                        .setStyle(ButtonStyle.Link)
                        .setURL(sessionData.serverLink)
                );
                components.push(linkRow);
            }

            await channel.send({ content: sessionData.pingRole ? `<@&${sessionData.pingRole}>` : "@here", embeds: [startEmbed], components: components });
            await interaction.editReply({ content: '✅ Sesija palaista!', embeds: [], components: [] });
            activeSessions.delete(sessionId);
        }

        if (action === 'cancel') {
            await interaction.update({ content: '❌ Atcelts.', embeds: [], components: [] });
            activeSessions.delete(sessionId);
        }
    }
});

mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        console.log('✅ DB savienota');
        app.listen(PORT, '0.0.0.0', () => console.log(`✅ Web Backend: Port ${PORT}`));
        
        client.login(process.env.DISCORD_TOKEN).then(async () => {
            console.log(`✅ Bots tiešsaistē kā ${client.user.tag}`);
            const commands = [
                new SlashCommandBuilder().setName('session').setDescription('Sākt jaunu sesijas balsojumu').addIntegerOption(opt => opt.setName('balsis').setDescription('Cik balsis vajadzēs?').setRequired(false))
            ].map(cmd => cmd.toJSON());
            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
            try { await rest.put(Routes.applicationCommands(client.user.id), { body: commands }); } 
            catch (err) { console.error('❌ Kļūda atjaunojot komandas:', err); }
        });
    })
    .catch(err => console.error("❌ Kļūda savienojoties ar DB:", err));
