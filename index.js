require('dotenv').config();
const { Client, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Konfigurācija, lai Express saprastu JSON un rādītu HTML no 'public' mapes
app.use(express.json());
app.use(express.static('public'));

// --- MONGODB MODELIS ---
const settingsSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    pingRole: String,
    startImage: String,
    startText: String,
    requiredVotes: { type: Number, default: 1 }
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

// --- WEB API: SAGLABĀT IESTATĪJUMUS NO MĀJASLAPAS ---
app.post('/api/save-settings', async (req, res) => {
    const { guildId, pingRole, startImage, startText, requiredVotes } = req.body;
    
    if (!guildId) return res.status(400).json({ error: "Trūkst Guild ID" });

    try {
        await Settings.findOneAndUpdate(
            { guildId: guildId },
            { pingRole, startImage, startText, requiredVotes: parseInt(requiredVotes) || 1 },
            { upsert: true, new: true }
        );
        res.json({ success: true, message: "Iestatījumi saglabāti!" });
    } catch (err) {
        console.error("DB kļūda:", err);
        res.status(500).json({ error: err.message });
    }
});

// --- DISCORD INTERAKCIJAS ---
client.on(Events.InteractionCreate, async interaction => {
    
    // 1. KOMANDA: /session-manager
    if (interaction.isChatInputCommand() && interaction.commandName === 'session-manager') {
        const dbData = await Settings.findOne({ guildId: interaction.guildId });
        
        if (!dbData) {
            return interaction.reply({ content: "⚠️ Lūdzu, vispirms iestati datus Dashboardā savam serverim!", ephemeral: true });
        }

        const sessionId = interaction.id;
        activeSessions.set(sessionId, {
            ...dbData._doc,
            votedUsers: [],
            currentVotes: 0,
            authorId: interaction.user.id,
            channelId: interaction.channelId
        });

        const voteEmbed = new EmbedBuilder()
            .setTitle('Session start-up vote')
            .setDescription(`Vajadzīgas **${dbData.requiredVotes}** balsis!\n\n${dbData.startText || "Sesijas balsošana ir sākusies!"}`)
            .setColor('#2b2d31')
            .setFooter({ text: `Balsis: 0/${dbData.requiredVotes}` });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vote_${sessionId}`).setLabel('VOTE').setStyle(ButtonStyle.Success)
        );

        await interaction.reply({ embeds: [voteEmbed], components: [row] });
    }

    // 2. POGU LOĢIKA (Vote un Start)
    if (interaction.isButton()) {
        const [action, sessionId] = interaction.customId.split('_');
        const sessionData = activeSessions.get(sessionId);

        if (!sessionData) return;

        // BALSOŠANA
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

            // Ja balsis savāktas -> Sūtam DM autoram
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
                    console.log("Nevarēja nosūtīt DM.");
                }
            }
        }

        // SESIJAS PALAIŠANA NO DM
        if (action === 'start') {
            await interaction.deferUpdate();
            const channel = await client.channels.fetch(sessionData.channelId);
            
            const startEmbed = new EmbedBuilder()
                .setTitle('LVRPL | Server start up')
                .setDescription(`KODS: LVRPL\n\n📋 **Nobalsoja:**\n${sessionData.votedUsers.map(id => `<@${id}>`).join(', ')}`)
                .setColor('#2b2d31');

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
