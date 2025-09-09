require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
} = require("@discordjs/voice");
const ytdl = require("@distube/ytdl-core");
const util = require("util");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

const prefix = "!";
let connection;
let player;

// ID owner untuk exec
const OWNER_ID = "1328544268620664863"; // ganti sesuai ID kamu

client.once("ready", () => {
    console.log(`✅ Bot online sebagai ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (!message.content.startsWith(prefix) || message.author.bot) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const text = message.content;

    // =====================
    // 🎶 COMMAND MUSIK
    // =====================
    if (command === "join") {
        if (!message.member.voice.channel) {
            return message.reply("❌ Kamu harus join voice channel dulu!");
        }
        connection = joinVoiceChannel({
            channelId: message.member.voice.channel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
        });
        message.reply("✅ Bot berhasil join voice channel!");
    }

    if (command === "play") {
        if (!args[0]) return message.reply("❌ Masukkan link YouTube!");
        if (!message.member.voice.channel)
            return message.reply("❌ Kamu harus join voice channel dulu!");

        if (!connection) {
            connection = joinVoiceChannel({
                channelId: message.member.voice.channel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });
        }

        const stream = ytdl(args[0], { filter: "audioonly" });
        const resource = createAudioResource(stream);
        player = createAudioPlayer();

        player.play(resource);
        connection.subscribe(player);

        message.reply(`🎶 Memutar musik: ${args[0]}`);

        player.on(AudioPlayerStatus.Idle, () => {
            message.channel.send("✅ Musik selesai, keluar otomatis.");
            connection.destroy();
            connection = null;
        });
    }

    if (command === "leave") {
        if (!connection) return message.reply("❌ Bot tidak sedang di voice channel!");
        connection.destroy();
        connection = null;
        message.reply("👋 Bot keluar dari voice channel.");
    }

    // =====================
    // 🖥️ EXEC MULTILINE
    // =====================
    else if (command.startsWith("exec")) {
        // Ambil baris kode setelah perintah !exec
        const sep = message.content.split("\n");
        let exc = message.content.replace(sep[0] + "\n", "");

        // Definisi fungsi print untuk output ke Discord
        const print = function (text) {
            let a = JSON.stringify(text, null, 2);
            message.reply(util.format(JSON.parse(a)));
        };

        // Definisi fungsi j4p untuk JSON pretty-print
        const j4p = function (tx) {
            message.reply(JSON.stringify(tx, null, 4));;
        };

        console.log("[EXEC INPUT]\n" + exc);

        try {
            eval(`(async () => {
    try {
        ${exc}
    } catch(e) {
        message.reply("❌ Error: \n" + e.toString() + "\n");
    }
})()`);
        } catch (err) {
            message.reply("❌ Global Error:\n```js\n" + err.toString() + "\n```");
        }
    }
});

client.login(process.env.TOKEN);
