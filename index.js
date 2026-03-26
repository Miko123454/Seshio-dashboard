require('dotenv').config();
const { Client, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// CORS Neredzamais tilts
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use(express.static('public'));

// --- MONGODB MODELIS (Pievienota valoda) ---
const settingsSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    pingRole: String,
    startImage: String,
    startText: String,
    embedTitle: String,
    embedCode: String,
    serverLink: String,
    language: { type: String, default: 'lv' } // JAUNS!
});
const Settings = mongoose.model('Settings', settingsSchema);

// --- DISCORD BOTS ---
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages] });
const activeSessions = new Map();

// --- WEB API ---
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

app.get('/api/bot-guilds', (req, res) => { res.json(client.guilds.cache.map(g => g.id)); });

app.get('/api/roles/:guildId', async (req, res) => {
    try {
        const guild = await client.guilds.fetch(req.params.guildId).catch(() => null);
        if (!guild) return res.status(404).json({ error: "Bots nav šajā serverī!" });
        const roles = guild.roles.cache.filter(role => role.id !== guild.id).map(role => ({ id: role.id, name: role.name }));
        res.json(roles);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- BOTA LOĢIKA (AR VALODĀM) ---
client.on(Events.InteractionCreate, async interaction => {
    // 1. DASHBOARD KOMANDA
    if (interaction.isChatInputCommand() && interaction.commandName === 'dashboard') {
        const dbData = await Settings.findOne({ guildId: interaction.guildId });
        const lang = dbData?.language || 'lv';
        
        const title = lang === 'en' ? '⚙️ Server Dashboard' : '⚙️ Servera Panelis';
        const desc = lang === 'en' ? 'Click the button below to configure your server settings on Seshio.' : 'Spied pogu zemāk, lai konfigurētu sava servera iestatījumus Seshio panelī.';
        const btnText = lang === 'en' ? 'Open Dashboard' : 'Atvērt Paneli';

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel(btnText).setStyle(ButtonStyle.Link).setURL('https://seshio.lat/')
        );
        
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle(title).setDescription(desc).setColor('#4cebda')], components: [row], ephemeral: true });
    }

    // 2. SESSION KOMANDA
    if (interaction.isChatInputCommand() && (interaction.commandName === 'session' || interaction.commandName === 'session-manager')) {
        const dbData = await Settings.findOne({ guildId: interaction.guildId });
        const lang = dbData?.language || 'lv';

        if (!dbData) {
            const err = lang === 'en' ? "⚠️ Please configure data in the Dashboard first! Use `/dashboard`" : "⚠️ Lūdzu, vispirms iestati datus Dashboardā! Lieto `/dashboard`";
            return interaction.reply({ content: err, ephemeral: true });
        }

        const requiredVotes = interaction.options.getInteger('balsis') || 1;
        const sessionId = interaction.id;
        const displayTitle = dbData.embedTitle || (lang === 'en' ? 'Session start-up vote' : 'Sesijas balsojums');

        activeSessions.set(sessionId, { ...dbData._doc, requiredVotes, votedUsers: [], currentVotes: 0, authorId: interaction.user.id, channelId: interaction.channelId, lang });

        const descText = lang === 'en' ? `**${requiredVotes}** votes required!\n\n` : `Vajadzīgas **${requiredVotes}** balsis!\n\n`;
        const footerText = lang === 'en' ? `Votes: 0/${requiredVotes}` : `Balsis: 0/${requiredVotes}`;

        const voteEmbed = new EmbedBuilder()
            .setTitle(displayTitle)
            .setDescription(`${descText}${dbData.startText || (lang === 'en' ? "Voting started!" : "Balsošana sākusies!")}`)
            .setColor('#4cebda')
            .setFooter({ text: footerText });

        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`vote_${sessionId}`).setLabel('VOTE').setStyle(ButtonStyle.Success));
        await interaction.reply({ embeds: [voteEmbed], components: [row] });
    }

    // POGU LOĢIKA
    if (interaction.isButton()) {
        const [action, sessionId] = interaction.customId.split('_');
        const sessionData = activeSessions.get(sessionId);
        if (!sessionData) return;
        const lang = sessionData.lang || 'lv';

        if (action === 'vote') {
            const alreadyVoted = lang === 'en' ? 'You have already voted!' : 'Tu jau esi nobalsojis!';
            if (sessionData.votedUsers.includes(interaction.user.id)) return interaction.reply({ content: alreadyVoted, ephemeral: true });
            
            sessionData.currentVotes += 1;
            sessionData.votedUsers.push(interaction.user.id);
            activeSessions.set(sessionId, sessionData);

            const footerText = lang === 'en' ? `Votes: ${sessionData.currentVotes}/${sessionData.requiredVotes}` : `Balsis: ${sessionData.currentVotes}/${sessionData.requiredVotes}`;
            const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setFooter({ text: footerText });
            await interaction.update({ embeds: [newEmbed] });

            if (sessionData.currentVotes >= sessionData.requiredVotes) {
                try {
                    const author = await client.users.fetch(sessionData.authorId);
                    const dmTitle = lang === 'en' ? 'Votes collected!' : 'Balsis savāktas!';
                    const dmDesc = lang === 'en' ? 'Do you want to start the session?' : 'Vai vēlies sākt sesiju?';
                    const btnStart = lang === 'en' ? 'Start' : 'Sākt';
                    const btnCancel = lang === 'en' ? 'Cancel' : 'Atcelt';

                    const dmEmbed = new EmbedBuilder().setTitle(dmTitle).setDescription(dmDesc).setColor('#00ff00');
                    const dmRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`start_${sessionId}`).setLabel(btnStart).setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`cancel_${sessionId}`).setLabel(btnCancel).setStyle(ButtonStyle.Danger)
                    );
                    await author.send({ embeds: [dmEmbed], components: [dmRow] });
                } catch (e) { console.log("Nevarēja nosūtīt DM."); }
            }
        }

        if (action === 'start') {
            await interaction.deferUpdate();
            const channel = await client.channels.fetch(sessionData.channelId);
            
            const displayTitle = sessionData.embedTitle || 'Server start up';
            let codePrefix = lang === 'en' ? 'CODE' : 'KODS';
            // Ja lietotājs iestatījis savu tekstu, piem, "KODS: 123", tas paliek kā ir
            const displayCode = sessionData.embedCode ? `${sessionData.embedCode}\n\n` : '';
            const votedPrefix = lang === 'en' ? '📋 **Voted:**' : '📋 **Nobalsoja:**';

            const startEmbed = new EmbedBuilder()
                .setTitle(displayTitle)
                .setDescription(`${displayCode}${votedPrefix}\n${sessionData.votedUsers.map(id => `<@${id}>`).join(', ')}`)
                .setColor('#4cebda');
            
            if (sessionData.startImage) startEmbed.setImage(sessionData.startImage);

            const components = [];
            if (sessionData.serverLink && sessionData.serverLink.trim() !== '') {
                components.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setLabel('Join Server').setStyle(ButtonStyle.Link).setURL(sessionData.serverLink)
                ));
            }

            await channel.send({ content: sessionData.pingRole ? `<@&${sessionData.pingRole}>` : "@here", embeds: [startEmbed], components });
            
            const successMsg = lang === 'en' ? '✅ Session started!' : '✅ Sesija palaista!';
            await interaction.editReply({ content: successMsg, embeds: [], components: [] });
            activeSessions.delete(sessionId);
        }

        if (action === 'cancel') {
            const cancelMsg = lang === 'en' ? '❌ Cancelled.' : '❌ Atcelts.';
            await interaction.update({ content: cancelMsg, embeds: [], components: [] });
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
                new SlashCommandBuilder().setName('session').setDescription('Sākt jaunu sesijas balsojumu / Start session vote').addIntegerOption(opt => opt.setName('balsis').setDescription('Cik balsis vajadzēs?').setRequired(false)),
                new SlashCommandBuilder().setName('dashboard').setDescription('Atvērt Seshio paneli / Open Seshio Dashboard') // JAUNA KOMANDA
            ].map(cmd => cmd.toJSON());
            
            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
            try { await rest.put(Routes.applicationCommands(client.user.id), { body: commands }); } 
            catch (err) { console.error('❌ Kļūda atjaunojot komandas:', err); }
        });
    })
    .catch(err => console.error("❌ Kļūda savienojoties ar DB:", err));
