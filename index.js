require('dotenv').config();
const { Client, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const mongoose = require('mongoose');

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] 
});

// Pieslēdzamies datu bāzei
mongoose.connect(process.env.MONGODB_URI).then(() => console.log('✅ MongoDB pieslēgts!'));

// Atmiņa, lai saglabātu aktīvās balsošanas datus
const activeSessions = new Map();

client.once(Events.ClientReady, () => {
    console.log(`✅ Bots ir tiešsaistē kā ${client.user.tag}`);
});

// Klausāmies, ko lietotāji dara (raksta komandas vai spiež pogas)
client.on(Events.InteractionCreate, async interaction => {
    
    // 1. JA KĀDS UZRAKSTA /session-manager
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'session-manager') {
            const balsis = interaction.options.getInteger('balsis');
            const loma = interaction.options.getRole('loma');
            const bilde = interaction.options.getString('bilde');

            // Izveidojam ID šai konkrētajai sesijai
            const sessionId = interaction.id; 
            
            // Saglabājam datus atmiņā, lai vēlāk botam būtu pieeja
            activeSessions.set(sessionId, {
                authorId: interaction.user.id,
                channelId: interaction.channelId,
                requiredVotes: balsis,
                currentVotes: 0,
                roleToPing: loma.id,
                imageUrl: bilde,
                votedUsers: [] // Saraksts ar tiem, kas jau nobalsoja
            });

            // Izveidojam pirmo Embed (Balsošanu)
            const voteEmbed = new EmbedBuilder()
                .setTitle('Session start-up vote ir sācies.')
                .setDescription(`Lai sāktos session vajag **${balsis}** balsis!\nSession Startup iesāka: <@${interaction.user.id}>\n\n**Noteikumi:**\nIzlasi vēlreiz visus noteikumus...\n\n‼️ **Ja gribi lai session sāktos spied VOTE pogu** ‼️`)
                .setColor('#2b2d31')
                .setFooter({ text: `Balsis: 0/${balsis}` });

            const voteButton = new ButtonBuilder()
                .setCustomId(`vote_${sessionId}`) // Unikāls ID pogai
                .setLabel('VOTE')
                .setStyle(ButtonStyle.Success);

            const row = new ActionRowBuilder().addComponents(voteButton);

            await interaction.reply({ embeds: [voteEmbed], components: [row] });
        }
    }

    // 2. JA KĀDS NOSPIEŽ POGU
    if (interaction.isButton()) {
        const customId = interaction.customId;

        // Ja nospiež VOTE pogu
        if (customId.startsWith('vote_')) {
            const sessionId = customId.split('_')[1];
            const sessionData = activeSessions.get(sessionId);

            if (!sessionData) return interaction.reply({ content: 'Šī balsošana vairs nav aktīva!', ephemeral: true });
            
            if (sessionData.votedUsers.includes(interaction.user.id)) {
                return interaction.reply({ content: 'Tu jau esi nobalsojis!', ephemeral: true });
            }

            sessionData.currentVotes += 1;
            sessionData.votedUsers.push(interaction.user.id);

            // Atjaunojam ziņu ar jauno balsu skaitu
            const oldEmbed = interaction.message.embeds[0];
            const newEmbed = EmbedBuilder.from(oldEmbed).setFooter({ text: `Balsis: ${sessionData.currentVotes}/${sessionData.requiredVotes}` });
            await interaction.update({ embeds: [newEmbed] });

            // Pārbaudām, vai ir savākts pietiekami daudz balsu
            if (sessionData.currentVotes >= sessionData.requiredVotes) {
                // Sūtam DM izveidotājam
                try {
                    const author = await client.users.fetch(sessionData.authorId);
                    
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('Balsis savāktas!')
                        .setDescription('Balsošanā ir savākts nepieciešamais balsu skaits. Vai vēlies sākt sesiju?')
                        .setColor('#00ff00');

                    const startBtn = new ButtonBuilder()
                        .setCustomId(`start_${sessionId}`)
                        .setLabel('Sākt Sesiju')
                        .setStyle(ButtonStyle.Success);

                    const cancelBtn = new ButtonBuilder()
                        .setCustomId(`cancel_${sessionId}`)
                        .setLabel('Atcelt')
                        .setStyle(ButtonStyle.Danger);

                    const dmRow = new ActionRowBuilder().addComponents(startBtn, cancelBtn);
                    
                    await author.send({ embeds: [dmEmbed], components: [dmRow] });
                    
                    // Paziņojam kanālā, ka gaida apstiprinājumu
                    await interaction.followUp({ content: `Balsis savāktas! Gaida apstiprinājumu no <@${sessionData.authorId}>.`, ephemeral: false });

                } catch (error) {
                    console.log('Nevarēja nosūtīt DM. Iespējams lietotājam ir slēgti DM.', error);
                }
            }
        }

        // Ja DM nospiež "Sākt Sesiju"
        if (customId.startsWith('start_')) {
            const sessionId = customId.split('_')[1];
            const sessionData = activeSessions.get(sessionId);
            
            if (!sessionData) return interaction.update({ content: 'Sesijas dati nav atrasti.', embeds: [], components: [] });

            const channel = await client.channels.fetch(sessionData.channelId);
            
            const startEmbed = new EmbedBuilder()
                .setTitle('LVRPL | Server start up')
                .setDescription(`KODS: LVRPL | Ja tu esi nobalsojis un neierodies, tu saņemsi brīdinājumu.\n\n📋 **Nobalsoja par ierašanos:**\n${sessionData.votedUsers.map(id => `<@${id}>`).join(', ')}`)
                .setImage(sessionData.imageUrl)
                .setColor('#2b2d31');

            await channel.send({ content: `<@&${sessionData.roleToPing}>`, embeds: [startEmbed] });
            
            await interaction.update({ content: '✅ Sesija veiksmīgi sākta!', embeds: [], components: [] });
            activeSessions.delete(sessionId); // Iztīram no atmiņas
        }

        // Ja DM nospiež "Atcelt"
        if (customId.startsWith('cancel_')) {
            const sessionId = customId.split('_')[1];
            await interaction.update({ content: '❌ Sesija atcelta.', embeds: [], components: [] });
            activeSessions.delete(sessionId);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);