require('dotenv').config();
const { Client, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// --- MONGODB MODELIS (Bez requiredVotes) ---
const settingsSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    pingRole: String,
    startImage: String,
    startText: String
});
const Settings = mongoose.model('Settings', settingsSchema);

// --- DISCORD BOTA SAGATAVOŠANA ---
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.DirectMessages 
    ] 
});

const activeSessions = new Map();

// --- WEB API 1: SAGLABĀT IESTATĪJUMUS ---
app.post('/api/save-settings', async (req, res) => {
    const { guildId, pingRole, startImage, startText } = req.body;
    if (!guildId) return res.status(400).json({ error: "Trūkst Guild ID" });

    try {
        await Settings.findOneAndUpdate(
            { guildId: guildId },
            { pingRole, startImage, startText },
            { upsert: true, new: true }
        );
        res.json({ success: true, message: "Iestatījumi saglabāti!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- WEB API 2: IEGŪT SERVERA LOMAS PRIEKŠ DROPDOWN ---
app.get('/api/roles/:guildId', async (req, res) => {
    try {
        // Mēģinām atrast serveri, kurā bots ir iekšā
        const guild = await client.guilds.fetch(req.params.guildId).catch(() => null);
        if (!guild) return res.status(404).json({ error: "Bots nav šajā serverī!" });

        // Izvelkam visas lomas, izņemot @everyone (kuras ID sakrīt ar servera ID)
        const roles = guild.roles.cache
            .filter(role => role.id !== guild.id)
            .map(role => ({ id: role.id, name: role.name }));
            
        res.json(roles);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- DISCORD INTERAKCIJAS ---
client.on(Events.InteractionCreate, async interaction => {
    
    // 1. KOMANDA
    if (interaction.isChatInputCommand()) {
        // Pārbaudām, vai komanda ir session vai session-manager
        if (interaction.commandName === 'session' || interaction.commandName === 'session-manager') {
            const dbData = await Settings.findOne({ guildId: interaction.guildId });
            
            if (!dbData) {
                return interaction.reply({ content: "⚠️ Lūdzu, vispirms iestati datus Dashboardā!", ephemeral: true });
            }

            // Šeit ņemam balsis no tavas komandas (ja nav norādīts, tad defoltā 1)
            const requiredVotes = interaction.options.getInteger('balsis') || 1;
            const sessionId = interaction.id;

            activeSessions.set(sessionId, {
                ...dbData._doc,
                requiredVotes: requiredVotes,
                votedUsers: [],
                currentVotes: 0,
                authorId: interaction.user.id,
                channelId: interaction.channelId
            });

            const voteEmbed = new EmbedBuilder()
                .setTitle('Session start-up vote')
                .setDescription(`Vajadzīgas **${requiredVotes}** balsis!\n\n${dbData.startText || "Sesijas balsošana ir sākusies!"}`)
                .setColor('#00f2fe')
                .setFooter({ text: `Balsis: 0/${requiredVotes}` });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`vote_${sessionId}`).setLabel('VOTE').setStyle(ButtonStyle.Success)
            );

            await interaction.reply({ embeds: [voteEmbed], components: [row] });
        }
    }

    // 2. POGU LOĢIKA (Balsošana un palaišana)
    if (interaction.isButton()) {
        const [action, sessionId] = interaction.customId.split('_');
        const sessionData = activeSessions.get(sessionId);
        if (!sessionData) return;

        if (action === 'vote') {
            if (sessionData.votedUsers.includes(interaction.user.id)) {
                return interaction.reply({ content: 'Tu jau esi nobalsojis!', ephemeral: true });
            }

            sessionData.currentVotes += 1;
            sessionData.votedUsers.push(interaction.user.id);
            activeSessions.set(sessionId, sessionData);

            const oldEmbed = interaction.message.embeds[0];
            const newEmbed = EmbedBuilder.from(oldEmbed).setFooter({ text: `Balsis: ${sessionData.currentVotes}/${sessionData.requiredVotes}` });
            
            await interaction.update({ embeds: [newEmbed] });

            if (sessionData.currentVotes >= sessionData.requiredVotes) {
                try {
                    const author = await client.users.fetch(sessionData.authorId);
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('Balsis savāktas!')
                        .setDescription(`Tavā serverī ir savākts nepieciešamais balsu skaits (${sessionData.requiredVotes}).\nVai vēlies sākt sesiju?`)
                        .setColor('#00ff00');

                    const dmRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`start_${sessionId}`).setLabel('Sākt Sesiju').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`cancel_${sessionId}`).setLabel('Atcelt').setStyle(ButtonStyle.Danger)
                    );

                    await author.send({ embeds: [dmEmbed], components: [dmRow] });
                } catch (e) {
                    console.log("Nevarēja nosūtīt DM autoram.");
                }
            }
        }

        if (action === 'start') {
            await interaction.deferUpdate();
            const channel = await client.channels.fetch(sessionData.channelId);
            
            const startEmbed = new EmbedBuilder()
                .setTitle('LVRPL | Server start up')
                .setDescription(`KODS: LVRPL\n\n📋 **Nobalsoja:**\n${sessionData.votedUsers.map(id => `<@${id}>`).join(', ')}`)
                .setColor('#00f2fe');

            if (sessionData.startImage) startEmbed.setImage(sessionData.startImage);

            await channel.send({ 
                content: sessionData.pingRole ? `<@&${sessionData.pingRole}>` : "@here", 
                embeds: [startEmbed] 
            });

            await interaction.editReply({ content: '✅ Sesija palaista!', embeds: [], components: [] });
            activeSessions.delete(sessionId);
        }

        if (action === 'cancel') {
            await interaction.update({ content: '❌ Atcelts.', embeds: [], components: [] });
            activeSessions.delete(sessionId);
        }
    }
});

// --- PALAIŠANA ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        console.log('✅ DB savienota');
        app.listen(PORT, () => console.log(`✅ Web Dashboard: Port ${PORT}`));
        client.login(process.env.DISCORD_TOKEN).then(() => console.log(`✅ Bots tiešsaistē: ${client.user.tag}`));
    })
    .catch(err => console.error("Kļūda startējot:", err));
