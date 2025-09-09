require('dotenv').config();
const fs = require('fs');
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    getVoiceConnection,
} = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const prefix = "!";
const queues = new Map();

// --- Cookie Agent Setup ---
// ytdl-core memerlukan cookies untuk menghindari error "Sign in".
// Buat file `cookies.json` di direktori yang sama.
let ytdlAgent;
if (fs.existsSync('./cookies.json')) {
    try {
        const cookies = JSON.parse(fs.readFileSync('./cookies.json', 'utf8'));
        ytdlAgent = ytdl.createAgent(cookies);
        console.log('✅ Berhasil memuat cookies untuk ytdl-core.');
    } catch (e) {
        console.error('❌ Gagal memuat atau parse cookies.json. ytdl-core mungkin akan dibatasi.', e);
    }
} else {
    console.warn('⚠️ File cookies.json tidak ditemukan. ytdl-core mungkin akan dibatasi oleh YouTube.');
}
// --- End Cookie Agent Setup ---

client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    client.user.setActivity('Music | !help', { type: ActivityType.Playing });
});

client.on('messageCreate', async message => {
    if (!message.content.startsWith(prefix) || message.author.bot || !message.guild) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const serverQueue = queues.get(message.guild.id);

    if (command === 'play' || command === 'p') {
        const voiceChannel = message.member?.voice.channel;
        if (!voiceChannel) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('Red').setDescription("❌ Kamu harus join voice channel dulu!")] });
        }

        const query = args.join(" ");
        if (!query) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('Red').setDescription("❌ Berikan URL atau nama lagu!")] });
        }

        if (!ytdl.validateURL(query)) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('Red').setDescription("❌ URL YouTube tidak valid! Bot ini hanya mendukung URL saat ini.")] });
        }

        let songInfo;
        try {
            songInfo = await ytdl.getInfo(query, { agent: ytdlAgent });
        } catch (error) {
            console.error(error);
            return message.reply({ embeds: [new EmbedBuilder().setColor('Red').setDescription(`❌ Gagal mendapatkan info lagu. Mungkin video ini privat atau dibatasi.\nError: ${error.message}`)] });
        }

        const song = {
            title: songInfo.videoDetails.title,
            url: songInfo.videoDetails.video_url,
            duration: songInfo.videoDetails.lengthSeconds,
            thumbnail: songInfo.videoDetails.thumbnails[0].url,
            requestedBy: message.author,
        };

        if (!serverQueue) {
            const queueContruct = {
                textChannel: message.channel,
                voiceChannel: voiceChannel,
                connection: null,
                player: createAudioPlayer(),
                songs: [],
                volume: 100,
                playing: true,
            };

            queues.set(message.guild.id, queueContruct);
            queueContruct.songs.push(song);

            try {
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator,
                });
                queueContruct.connection = connection;
                connection.subscribe(queueContruct.player);

                queueContruct.player.on(AudioPlayerStatus.Idle, () => {
                    const oldQueue = queues.get(message.guild.id);
                    if (oldQueue) {
                        oldQueue.songs.shift();
                        if (oldQueue.songs.length > 0) {
                            playSong(message.guild, oldQueue.songs[0]);
                        } else {
                            oldQueue.connection.destroy();
                            queues.delete(message.guild.id);
                        }
                    }
                });

                queueContruct.player.on('error', error => {
                    console.error(`Error: ${error.message}`);
                    const oldQueue = queues.get(message.guild.id);
                    if (oldQueue) {
                        oldQueue.songs.shift();
                        if (oldQueue.songs.length > 0) {
                            playSong(message.guild, oldQueue.songs[0]);
                        } else {
                            oldQueue.connection.destroy();
                            queues.delete(message.guild.id);
                        }
                    }
                });

                playSong(message.guild, queueContruct.songs[0]);
            } catch (err) {
                console.error(err);
                queues.delete(message.guild.id);
                return message.reply({ embeds: [new EmbedBuilder().setColor('Red').setDescription(`❌ Gagal join voice channel: ${err.message}`)] });
            }
        } else {
            serverQueue.songs.push(song);
            const embed = new EmbedBuilder()
                .setColor('Blue')
                .setTitle('👍 Lagu Ditambahkan')
                .setDescription(`${song.title} telah ditambahkan ke antrian.`);
            return message.reply({ embeds: [embed] });
        }
    } else if (command === 'skip' || command === 's') {
        if (!serverQueue) return message.reply({ embeds: [new EmbedBuilder().setColor('Red').setDescription("❌ Tidak ada lagu untuk di-skip!")] });
        if (!message.member.voice.channel || message.member.voice.channel.id !== serverQueue.voiceChannel.id) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('Red').setDescription("❌ Kamu harus berada di voice channel yang sama untuk skip lagu!")] });
        }
        if (serverQueue.songs.length <= 1) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('Red').setDescription("❌ Tidak ada lagu selanjutnya di antrian.")] });
        }
        serverQueue.player.stop();
        message.reply({ embeds: [new EmbedBuilder().setColor('Green').setDescription("⏭️ Lagu dilewati!")] });
    } else if (command === 'stop') {
        if (!serverQueue) return message.reply({ embeds: [new EmbedBuilder().setColor('Red').setDescription("❌ Tidak ada musik yang sedang diputar!")] });
        if (!message.member.voice.channel || message.member.voice.channel.id !== serverQueue.voiceChannel.id) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('Red').setDescription("❌ Kamu harus berada di voice channel yang sama untuk menghentikan musik!")] });
        }
        serverQueue.songs = [];
        serverQueue.connection.destroy();
        queues.delete(message.guild.id);
        message.reply({ embeds: [new EmbedBuilder().setColor('Green').setDescription("⏹️ Musik dihentikan dan bot keluar.")] });
    } else if (command === 'leave') {
        const connection = getVoiceConnection(message.guild.id);
        if (connection) {
            connection.destroy();
            queues.delete(message.guild.id);
            message.reply({ embeds: [new EmbedBuilder().setColor('Green').setDescription("👋 Keluar dari voice channel!")] });
        } else {
            message.reply({ embeds: [new EmbedBuilder().setColor('Red').setDescription("❌ Aku tidak berada di voice channel!")] });
        }
    } else if (command === 'queue' || command === 'q') {
        if (!serverQueue) return message.reply({ embeds: [new EmbedBuilder().setColor('Red').setDescription("❌ Tidak ada musik yang sedang diputar!")] });

        const q = serverQueue.songs
            .map((song, i) => `${i === 0 ? 'Sedang Diputar:' : `${i}.`} **${song.title}**`)
            .slice(0, 15)
            .join('\n');

        const embed = new EmbedBuilder()
            .setColor('Blue')
            .setTitle('Antrian Server')
            .setDescription(q || 'Antrian kosong.')
            .setFooter({ text: `Total ${serverQueue.songs.length} lagu dalam antrian.` });
        message.reply({ embeds: [embed] });
    } else if (command === 'help') {
        const embed = new EmbedBuilder()
            .setColor('Gold')
            .setTitle('Bantuan Perintah Bot Musik')
            .setDescription('Berikut adalah daftar perintah yang tersedia:')
            .addFields(
                { name: '`!play <url>`', value: 'Memutar lagu dari URL YouTube.' },
                { name: '`!skip`', value: 'Melewati lagu yang sedang diputar.' },
                { name: '`!stop`', value: 'Menghentikan musik dan membersihkan antrian.' },
                { name: '`!leave`', value: 'Membuat bot keluar dari voice channel.' },
                { name: '`!queue`', value: 'Menampilkan daftar lagu dalam antrian.' },
                { name: '`!help`', value: 'Menampilkan pesan bantuan ini.' }
            );
        message.reply({ embeds: [embed] });
    }
});

async function playSong(guild, song) {
    const serverQueue = queues.get(guild.id);
    if (!song) {
        serverQueue.connection.destroy();
        queues.delete(guild.id);
        return;
    }

    const stream = ytdl(song.url, {
        agent: ytdlAgent,
        filter: 'audioonly',
        quality: 'highestaudio',
        highWaterMark: 1 << 25,
    });

    const resource = createAudioResource(stream);
    serverQueue.player.play(resource);

    const embed = new EmbedBuilder()
        .setColor('Green')
        .setTitle('🎶 Memutar Lagu')
        .setDescription(`${song.title}`)
        .setThumbnail(song.thumbnail)
        .addFields({ name: 'Diminta oleh', value: `${song.requestedBy}` })
        .setTimestamp();
    serverQueue.textChannel.send({ embeds: [embed] });
}

// [!!!] PENTING: Gunakan environment variable untuk token Anda demi keamanan.
client.login(process.env.TOKEN);
