const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const fetch = require('node-fetch');

// --- KONFIGURACJA ---
const BOT_TOKEN = 'MTQxMTI2OTA5NDUyNjY4MTExOQ.GAm4XJ.SHd5jT-asoNCercwro4piMurLB30WEOHQe1uy0';
const API_BASE_URL = 'https://RANDOM_STRING.ngrok-free.app'; // ZASTĄP TĘ LINIĘ!

// --- ID KANAŁÓW I RÓL ---
const GUILD_ID = '1202645184735613029'; // <--- ZMIEŃ TO ID!
const ADMIN_ROLE_ID = '1253430966194540564'; // <--- ZMIEŃ TO ID!
const INSPECTION_CHANNEL_ID = '1412119165208363068'; // <--- ZMIEŃ NA ID KANAŁU BADAŃ TECHNICZNYCH!

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log(`Zalogowano jako ${client.user.tag}! Bot jest gotowy do pracy.`);
});

// Parser dla wiadomości z badania technicznego
function parseInspection(content) {
    const data = {};
    const lines = content.split('\n').map(line => line.trim()).filter(line => line);

    lines.forEach(line => {
        const lowerLine = line.toLowerCase();
        if (lowerLine.startsWith('właściciel pojazdu:')) data.owner = line.substring(line.indexOf(':') + 1).trim();
        if (lowerLine.startsWith('rodzaj nadwozia:')) data.bodyType = line.substring(line.indexOf(':') + 1).trim();
        if (lowerLine.startsWith('marka:')) data.make = line.substring(line.indexOf(':') + 1).trim();
        if (lowerLine.startsWith('model:')) data.model = line.substring(line.indexOf(':') + 1).trim();
        if (lowerLine.startsWith('trim:')) data.trim = line.substring(line.indexOf(':') + 1).trim();
        if (lowerLine.startsWith('rok produkcji:')) data.year = line.substring(line.indexOf(':') + 1).trim();
        if (lowerLine.startsWith('numery rejestracyjne, stan:')) {
            const plateAndState = line.substring(line.indexOf(':') + 1).trim().split(',');
            data.plate = plateAndState[0]?.trim();
            data.state = plateAndState[1]?.trim();
        }
        if (lowerLine.startsWith('historia pojazdu:')) data.history = line.substring(line.indexOf(':') + 1).trim();
        if (lowerLine.startsWith('data następnego badania technicznego:')) data.nextInspectionDate = line.split('**')[1]?.trim();
        if (lowerLine.startsWith('wynik badania:')) data.result = line.includes('Pozytywny') ? 'Pozytywny' : 'Negatywny';
        if (lowerLine.startsWith('powód:')) data.reason = line.substring(line.indexOf(':') + 1).trim();
        if (lowerLine.startsWith('numer skp:')) data.station = line.split('**')[1]?.trim();
    });
    
    const ownerIdMatch = data.owner?.match(/<@(\d+)>/);
    data.ownerId = ownerIdMatch ? ownerIdMatch[1] : null;

    if (!data.ownerId || !data.plate || !data.make || !data.model || !data.result) {
        return null;
    }
    return data;
}


async function handleMessage(message) {
    console.log(`[DEBUG] Otrzymano wiadomość na kanale badań. Sprawdzanie...`);
    
    const inspectionData = parseInspection(message.content);
    
    if (!inspectionData) {
        console.log(`[DEBUG] Parser zwrócił null. Wiadomość nie pasuje do wzoru.`);
        console.log(`[DEBUG] Treść wiadomości: ${message.content.replace(/\n/g, "\\n")}`);
        message.react('❓').catch(console.error);
        return;
    }

    console.log('[DEBUG] Dane po parsowaniu:', inspectionData);

    try {
        console.log(`[DEBUG] Próba wysłania danych do API: ${API_BASE_URL}/api/vehicle-inspection`);
        const response = await fetch(`${API_BASE_URL}/api/vehicle-inspection`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...inspectionData, rawMessage: message.content })
        });

        console.log(`[DEBUG] Serwer odpowiedział ze statusem: ${response.status}`);
        
        if (response.ok) {
            const result = await response.json();
            console.log('[DEBUG] SUKCES! Odpowiedź serwera:', result);
            message.react('✅').catch(console.error);
        } else {
            const errorText = await response.text();
            console.error(`[DEBUG] BŁĄD! Odpowiedź serwera: ${errorText}`);
            message.react('❌').catch(console.error);
        }
    } catch (error) {
        console.error('[DEBUG] KRYTYCZNY BŁĄD POŁĄCZENIA Z API:', error);
        message.react('🔥').catch(console.error);
    }
}

// Komenda do synchronizacji członków
async function handleSyncCommand(message) {
    if (!message.member.roles.cache.has(ADMIN_ROLE_ID)) {
        return message.reply('Nie masz uprawnień do użycia tej komendy.');
    }
    try {
        await message.reply('Rozpoczynam synchronizację członków z MDT...');
        const guild = await client.guilds.fetch(GUILD_ID);
        const members = await guild.members.fetch();
        const membersData = members.map(member => ({
            discordId: member.id,
            name: member.nickname || member.user.username,
            globalName: member.user.globalName || member.user.username,
            joinedTimestamp: member.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null,
        }));
        const response = await fetch(`${API_BASE_URL}/api/sync-citizens`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(membersData)
        });
        if (response.ok) {
            const result = await response.json();
            await message.reply(`Synchronizacja członków zakończona pomyślnie! Zaktualizowano ${result.syncedCount} obywateli w MDT.`);
        } else {
            const errorText = await response.text();
            throw new Error(`Błąd API: ${response.status} - ${errorText}`);
        }
    } catch (error) {
        console.error('Błąd podczas synchronizacji członków:', error);
        await message.reply(`Wystąpił krytyczny błąd podczas synchronizacji członków: ${error.message}`);
    }
}

// NOWA KOMENDA: Synchronizacja wszystkich badań technicznych
async function handleSyncInspectionsCommand(message) {
    if (!message.member.roles.cache.has(ADMIN_ROLE_ID)) {
        return message.reply('Nie masz uprawnień do użycia tej komendy.');
    }
    try {
        await message.reply('Rozpoczynam synchronizację Badań Technicznych... Może to chwilę potrwać.');
        const channel = await client.channels.fetch(INSPECTION_CHANNEL_ID);
        if (!channel) {
            return message.reply('Nie znaleziono kanału badań technicznych. Sprawdź ID w konfiguracji.');
        }

        let allMessages = [];
        let last_id;
        
        while (true) {
            const options = { limit: 100 };
            if (last_id) {
                options.before = last_id;
            }
            const messages = await channel.messages.fetch(options);
            allMessages.push(...messages.values());
            last_id = messages.lastKey();
            if (messages.size != 100) {
                break;
            }
        }

        const totalMessages = allMessages.length;
        let successCount = 0;
        await message.reply(`Znaleziono ${totalMessages} wiadomości do przetworzenia. Rozpoczynam import...`);

        for (const msg of allMessages.reverse()) { // Przetwarzamy od najstarszych
            if (msg.author.bot) continue;
            
            const inspectionData = parseInspection(msg.content);
            if (inspectionData) {
                 const response = await fetch(`${API_BASE_URL}/api/vehicle-inspection`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...inspectionData, rawMessage: msg.content })
                });
                if(response.ok) {
                    successCount++;
                } else {
                    console.log(`[SYNC_INSPECTIONS_FAIL] Błąd API dla wiadomości ${msg.id}: ${await response.text()}`);
                }
            } else {
                console.log(`[SYNC_INSPECTIONS_FAIL] Nie udało się przetworzyć wiadomości: "${msg.content.replace(/\n/g, "\\n")}"`);
            }
        }
        
        await message.reply(`Synchronizacja badań zakończona! Pomyślnie przetworzono i wysłano ${successCount} z ${totalMessages} badań technicznych.`);

    } catch (error) {
        console.error('Błąd podczas synchronizacji badań:', error);
        await message.reply(`Wystąpił krytyczny błąd podczas synchronizacji badań: ${error.message}`);
    }
}

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;
  
  console.log(`[DEBUG] Zarejestrowano wiadomość na serwerze od: ${message.author.tag}`);
  
  const command = message.content.toLowerCase();

  if (command === '!sync') {
      console.log(`[DEBUG] Wykryto komendę !sync`);
      await handleSyncCommand(message);
      return;
  }
  
  if (command === '!syncinspections') {
      console.log(`[DEBUG] Wykryto komendę !syncinspections`);
      await handleSyncInspectionsCommand(message);
      return;
  }
  
  if (message.channel.id === INSPECTION_CHANNEL_ID) {
    console.log(`[DEBUG] Wiadomość jest na właściwym kanale badań. Uruchamiam handleMessage...`);
    await handleMessage(message);
  } else {
      console.log(`[DEBUG] Wiadomość NIE jest na kanale badań. Oczekiwany: ${INSPECTION_CHANNEL_ID}, Aktualny: ${message.channel.id}`);
  }
});

client.login(BOT_TOKEN);

