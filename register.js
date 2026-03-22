require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

// Izveidojam /session-manager komandu ar opcijām
const commands = [
    new SlashCommandBuilder()
        .setName('session-manager')
        .setDescription('Sāk sesijas balsošanu')
        .addIntegerOption(option => 
            option.setName('balsis')
            .setDescription('Cik balsis vajag, lai sāktu? (Piemēram, 1)')
            .setRequired(true))
        .addRoleOption(option => 
            option.setName('loma')
            .setDescription('Kura loma jāpingo, kad sākas sesija?')
            .setRequired(true))
        .addStringOption(option => 
            option.setName('bilde')
            .setDescription('Ielīmē bildes URL (saiti) sesijas sākumam')
            .setRequired(true))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Sāku reģistrēt komandas...');
        // Atrodi sava bota ID (Client ID) no Discord Developer Portal un ievadi te!
        // Ja gribi reģistrēt komandu ātri vienā serverī, izmanto šo rindiņu (norādot GUILD ID):
        // await rest.put(Routes.applicationGuildCommands('TAVA_BOTA_ID', 'TAVA_SERVERA_ID'), { body: commands });
        
        // Globālā reģistrācija (var aizņemt līdz 1h, kamēr parādās visos serveros)
        // IERAKSTI SAVA BOTA ID ŠEIT ZEMĀK:
        const BOTA_ID = '1485224120047108237'; 
        
        await rest.put(Routes.applicationCommands(BOTA_ID), { body: commands });
        
        console.log('✅ Komanda /session-manager ir veiksmīgi reģistrēta!');
    } catch (error) {
        console.error('Kļūda reģistrējot komandu:', error);
    }
})();