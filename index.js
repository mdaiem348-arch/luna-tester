require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const express = require('express');

const db = new Database('tester.db');
const COOLDOWN_MS = 0;

db.exec(`CREATE TABLE IF NOT EXISTS keys (key TEXT PRIMARY KEY, used INTEGER DEFAULT 0, used_by TEXT, used_at INTEGER, created_by TEXT);
CREATE TABLE IF NOT EXISTS accounts (username TEXT PRIMARY KEY, password TEXT, hwid TEXT, discord_id TEXT, banned INTEGER DEFAULT 0, used_key TEXT, launch_count INTEGER DEFAULT 0, hwid_reset_count INTEGER DEFAULT 0, last_hwid_reset INTEGER, role_given INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS whitelist (discord_id TEXT PRIMARY KEY, role TEXT);
CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, message TEXT, created_at INTEGER);`);

function generateKey() { const c='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; let k=''; for(let i=0;i<32;i++) k+=c[Math.floor(Math.random()*c.length)]; return k; }
function hasPerm(id, role){ const r=db.prepare('SELECT role FROM whitelist WHERE discord_id=?').get(id); return r?.role==='owner'||(role==='mod'&&r?.role==='mod')||(role==='tester'&&r?.role==='tester'); }
function canReset(acc){ return true; }
function getConfig(k){ return db.prepare('SELECT value FROM config WHERE key=?').get(k)?.value; }
function setConfig(k,v){ db.prepare('INSERT OR REPLACE INTO config(key,value) VALUES(?,?)').run(k,v); }

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages] });

client.once('ready', async () => {
    console.log('✅ Tester Bot Online');
    await client.user.setUsername('Luna-Tester');
    client.user.setActivity('/panel | Free', { type: 'PLAYING' });
    
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: [
        new SlashCommandBuilder().setName('ping').setDescription('Test the bot'),
        new SlashCommandBuilder().setName('help').setDescription('Show all commands'),
        new SlashCommandBuilder().setName('setup').setDescription('Setup the bot').addRoleOption(o=>o.setName('role').setDescription('Tester role').setRequired(true)),
        new SlashCommandBuilder().setName('gen').setDescription('Generate tester keys').addIntegerOption(o=>o.setName('amount').setDescription('Number of keys').setRequired(true)).addUserOption(o=>o.setName('user').setDescription('User to send to').setRequired(true)),
        new SlashCommandBuilder().setName('createaccount').setDescription('Create tester account').addStringOption(o=>o.setName('key').setDescription('Tester key').setRequired(true)).addStringOption(o=>o.setName('username').setDescription('Username').setRequired(true)).addStringOption(o=>o.setName('password').setDescription('Password').setRequired(true)),
        new SlashCommandBuilder().setName('stats').setDescription('Bot statistics'),
        new SlashCommandBuilder().setName('panel').setDescription('Control panel'),
        new SlashCommandBuilder().setName('feedback').setDescription('Send feedback').addStringOption(o=>o.setName('message').setDescription('Your feedback').setRequired(true)),
        new SlashCommandBuilder().setName('addtester').setDescription('Add tester role').addUserOption(o=>o.setName('user').setDescription('User to make tester').setRequired(true)),
        new SlashCommandBuilder().setName('removetester').setDescription('Remove tester role').addUserOption(o=>o.setName('user').setDescription('User to remove').setRequired(true)),
        new SlashCommandBuilder().setName('whitelist').setDescription('Whitelist user').addUserOption(o=>o.setName('user').setDescription('User to whitelist').setRequired(true)),
        new SlashCommandBuilder().setName('blacklist').setDescription('Blacklist user').addUserOption(o=>o.setName('user').setDescription('User to blacklist').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason')),
        new SlashCommandBuilder().setName('forcereset').setDescription('Force HWID reset').addUserOption(o=>o.setName('user').setDescription('User to reset').setRequired(true)),
        new SlashCommandBuilder().setName('userinfo').setDescription('User info').addStringOption(o=>o.setName('username').setDescription('Username').setRequired(true)),
        new SlashCommandBuilder().setName('addmod').setDescription('Add moderator').addUserOption(o=>o.setName('user').setDescription('User to promote').setRequired(true)),
        new SlashCommandBuilder().setName('removemod').setDescription('Remove moderator').addUserOption(o=>o.setName('user').setDescription('User to demote').setRequired(true))
    ] });
    console.log('Tester commands registered');
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    
    const { commandName, options, user, guild } = interaction;
    
    if (commandName === 'ping') {
        await interaction.reply({ content: '🏓 Pong! Tester bot is working! (No cooldown)', ephemeral: true });
        return;
    }
    
    if (commandName === 'help') {
        const embed = new EmbedBuilder().setTitle('🧪 Luna Tester Commands').setColor(0x00ff00)
            .addFields(
                { name: 'General', value: '`/ping` `/help` `/stats` `/panel`', inline: true },
                { name: 'Account', value: '`/createaccount` `/userinfo`', inline: true },
                { name: 'Feedback', value: '`/feedback`', inline: true },
                { name: 'Moderation', value: '`/whitelist` `/blacklist` `/forcereset` `/gen`', inline: true },
                { name: 'Admin', value: '`/setup` `/addmod` `/removemod` `/addtester` `/removetester`', inline: true },
                { name: 'Benefit', value: '🧪 **NO HWID COOLDOWN**', inline: false }
            );
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
    }
    
    if (commandName === 'setup') {
        if (!hasPerm(user.id, 'owner')) {
            await interaction.reply({ content: '❌ Owner only', ephemeral: true });
            return;
        }
        const role = options.getRole('role');
        setConfig('guild_id', guild.id);
        setConfig('role_id', role.id);
        await interaction.reply({ content: '✅ Tester bot setup complete!', ephemeral: true });
        return;
    }
    
    if (commandName === 'gen') {
        if (!hasPerm(user.id, 'mod')) {
            await interaction.reply({ content: '❌ Mods only', ephemeral: true });
            return;
        }
        const amount = options.getInteger('amount');
        const target = options.getUser('user');
        const keys = [];
        for (let i = 0; i < amount; i++) {
            const k = generateKey();
            db.prepare('INSERT INTO keys(key, created_by) VALUES(?,?)').run(k, user.id);
            keys.push(k);
        }
        await target.send(`🧪 **Tester Keys** (NO COOLDOWN)\n\`\`\`\n${keys.join('\n')}\n\`\`\``);
        await interaction.reply({ content: `✅ Generated ${amount} tester key(s)`, ephemeral: true });
        return;
    }
    
    if (commandName === 'createaccount') {
        const key = options.getString('key');
        const username = options.getString('username');
        const password = options.getString('password');
        
        const keyRow = db.prepare('SELECT * FROM keys WHERE key=? AND used=0').get(key);
        if (!keyRow) {
            await interaction.reply({ content: '❌ Invalid or used key', ephemeral: true });
            return;
        }
        if (db.prepare('SELECT * FROM accounts WHERE username=?').get(username)) {
            await interaction.reply({ content: '❌ Username already taken', ephemeral: true });
            return;
        }
        const hash = bcrypt.hashSync(password, 10);
        db.prepare('INSERT INTO accounts(username,password,discord_id,used_key) VALUES(?,?,?,?)').run(username, hash, user.id, key);
        db.prepare('UPDATE keys SET used=1, used_by=?, used_at=? WHERE key=?').run(user.id, Date.now(), key);
        await interaction.reply({ content: `✅ Tester account **${username}** created! (NO COOLDOWN)`, ephemeral: true });
        return;
    }
    
    if (commandName === 'stats') {
        const total = db.prepare('SELECT COUNT(*) c FROM keys').get().c;
        const used = db.prepare('SELECT COUNT(*) c FROM keys WHERE used=1').get().c;
        const usersCount = db.prepare('SELECT COUNT(*) c FROM accounts').get().c;
        await interaction.reply({ content: `🧪 **Tester Stats**\nKeys: ${used}/${total}\nTesters: ${usersCount}\n⚡ NO COOLDOWN`, ephemeral: true });
        return;
    }
    
    if (commandName === 'panel') {
        await interaction.reply({ content: '🧪 **Tester Panel**\nUse `/createaccount` to activate.\nUse `/feedback` to send suggestions.\n⚡ **NO HWID COOLDOWN**', ephemeral: true });
        return;
    }
    
    if (commandName === 'feedback') {
        const message = options.getString('message');
        db.prepare('INSERT INTO feedback(username, message, created_at) VALUES(?,?,?)').run(user.tag, message, Date.now());
        await interaction.reply({ content: '✅ Thank you for your feedback!', ephemeral: true });
        return;
    }
    
    if (commandName === 'addtester') {
        if (!hasPerm(user.id, 'owner')) {
            await interaction.reply({ content: '❌ Owner only', ephemeral: true });
            return;
        }
        const target = options.getUser('user');
        db.prepare('INSERT OR REPLACE INTO whitelist(discord_id, role) VALUES(?,?)').run(target.id, 'tester');
        await target.send(`🧪 You are now a **Tester**! No HWID cooldown.`);
        await interaction.reply({ content: `✅ Added ${target.tag} as tester.`, ephemeral: true });
        return;
    }
    
    if (commandName === 'removetester') {
        if (!hasPerm(user.id, 'owner')) {
            await interaction.reply({ content: '❌ Owner only', ephemeral: true });
            return;
        }
        const target = options.getUser('user');
        db.prepare('DELETE FROM whitelist WHERE discord_id=? AND role=?').run(target.id, 'tester');
        await target.send(`🧪 You are no longer a Tester.`);
        await interaction.reply({ content: `✅ Removed ${target.tag} as tester.`, ephemeral: true });
        return;
    }
    
    if (commandName === 'whitelist') {
        if (!hasPerm(user.id, 'mod')) {
            await interaction.reply({ content: '❌ Mods only', ephemeral: true });
            return;
        }
        const target = options.getUser('user');
        const key = generateKey();
        db.prepare('INSERT INTO keys(key, created_by) VALUES(?,?)').run(key, user.id);
        await target.send(`🧪 **Tester Key**: \`${key}\`\nUse /createaccount to activate. NO COOLDOWN.`);
        await interaction.reply({ content: `✅ Whitelisted ${target.tag}`, ephemeral: true });
        return;
    }
    
    if (commandName === 'blacklist') {
        if (!hasPerm(user.id, 'mod')) {
            await interaction.reply({ content: '❌ Mods only', ephemeral: true });
            return;
        }
        const target = options.getUser('user');
        const reason = options.getString('reason') || 'No reason';
        const account = db.prepare('SELECT * FROM accounts WHERE discord_id=?').get(target.id);
        if (account) {
            db.prepare('UPDATE accounts SET banned=1 WHERE discord_id=?').run(target.id);
            await target.send(`❌ **Blacklisted**\nReason: ${reason}`);
            await interaction.reply({ content: `✅ Blacklisted ${target.tag}`, ephemeral: true });
        } else {
            await interaction.reply({ content: `❌ ${target.tag} has no account.`, ephemeral: true });
        }
        return;
    }
    
    if (commandName === 'forcereset') {
        if (!hasPerm(user.id, 'mod')) {
            await interaction.reply({ content: '❌ Mods only', ephemeral: true });
            return;
        }
        const target = options.getUser('user');
        const account = db.prepare('SELECT * FROM accounts WHERE discord_id=?').get(target.id);
        if (account) {
            db.prepare('UPDATE accounts SET hwid=NULL, last_hwid_reset=NULL WHERE discord_id=?').run(target.id);
            await target.send(`🔄 **HWID Reset** (No cooldown applied)`);
            await interaction.reply({ content: `✅ Force reset for ${target.tag}`, ephemeral: true });
        } else {
            await interaction.reply({ content: `❌ ${target.tag} has no account.`, ephemeral: true });
        }
        return;
    }
    
    if (commandName === 'userinfo') {
        if (!hasPerm(user.id, 'mod')) {
            await interaction.reply({ content: '❌ Mods only', ephemeral: true });
            return;
        }
        const identifier = options.getString('username');
        const account = db.prepare('SELECT * FROM accounts WHERE username=? OR discord_id=?').get(identifier, identifier);
        if (account) {
            const embed = new EmbedBuilder().setTitle('🧪 Tester Info').setColor(0x00ff00)
                .addFields(
                    { name: 'Username', value: account.username, inline: true },
                    { name: 'Discord', value: `<@${account.discord_id}>`, inline: true },
                    { name: 'Banned', value: account.banned ? 'Yes' : 'No', inline: true },
                    { name: 'HWID', value: account.hwid || 'Not bound', inline: true },
                    { name: 'Launches', value: String(account.launch_count), inline: true },
                    { name: 'Resets', value: String(account.hwid_reset_count), inline: true },
                    { name: 'Cooldown', value: '⚡ NONE', inline: true },
                    { name: 'Key', value: `||${account.used_key}||`, inline: false }
                );
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } else {
            await interaction.reply({ content: `❌ User ${identifier} not found.`, ephemeral: true });
        }
        return;
    }
    
    if (commandName === 'addmod') {
        if (!hasPerm(user.id, 'owner')) {
            await interaction.reply({ content: '❌ Owner only', ephemeral: true });
            return;
        }
        const target = options.getUser('user');
        db.prepare('INSERT OR REPLACE INTO whitelist(discord_id, role) VALUES(?,?)').run(target.id, 'mod');
        await target.send(`👮 You are now a **Moderator**.`);
        await interaction.reply({ content: `✅ Added ${target.tag} as moderator.`, ephemeral: true });
        return;
    }
    
    if (commandName === 'removemod') {
        if (!hasPerm(user.id, 'owner')) {
            await interaction.reply({ content: '❌ Owner only', ephemeral: true });
            return;
        }
        const target = options.getUser('user');
        db.prepare('DELETE FROM whitelist WHERE discord_id=? AND role=?').run(target.id, 'mod');
        await target.send(`👮 You are no longer a **Moderator**.`);
        await interaction.reply({ content: `✅ Removed ${target.tag} as moderator.`, ephemeral: true });
        return;
    }
    
    await interaction.reply({ content: `Command not implemented.`, ephemeral: true });
});

const app = express();
app.use(express.json());
app.post('/login', (req, res) => {
    const { username, password, hwid } = req.body;
    const acc = db.prepare('SELECT * FROM accounts WHERE username=? COLLATE NOCASE').get(username);
    if (!acc) return res.json({ success: false });
    if (acc.banned) return res.json({ success: false });
    if (!bcrypt.compareSync(password, acc.password)) return res.json({ success: false });
    if (!acc.hwid) { db.prepare('UPDATE accounts SET hwid=?, launch_count=launch_count+1 WHERE username=?').run(hwid, username); return res.json({ success: true }); }
    if (acc.hwid !== hwid) return res.json({ success: false });
    db.prepare('UPDATE accounts SET launch_count=launch_count+1 WHERE username=?').run(username);
    res.json({ success: true });
});
app.listen(3003, () => console.log('🧪 Tester API on 3003'));

client.login(process.env.DISCORD_TOKEN);