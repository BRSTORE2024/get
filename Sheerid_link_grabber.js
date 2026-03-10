const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const readline = require('readline');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

const IS_HEADLESS = process.argv.includes('--headless');

const TELEGRAM_TOKEN = '8796052869:AAFAiyxqIZGdCXY2b3zCe4cTVCLmxE6qcBg';
const TELEGRAM_CHAT_ID = '7676651391';

const LINK_FILE = path.join(__dirname, 'link.txt');

let TELEGRAM_MODE = false;
let TELEGRAM_THREAD = 0;
let lastUpdateId = 0;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/* =========================
   TELEGRAM SEND
========================= */

const kirimTelegram = async (pesan) => {

  try {

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: pesan,
      parse_mode: 'Markdown'
    });

  } catch (err) {

    console.log('Telegram error:', err.message);

  }

};

const kirimFileTelegram = async (filePath) => {

  try {

    if (!fs.existsSync(filePath)) return;

    const formData = new FormData();

    formData.append('chat_id', TELEGRAM_CHAT_ID);
    formData.append('document', fs.createReadStream(filePath));

    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`,
      formData,
      { headers: formData.getHeaders() }
    );

  } catch (err) {

    console.log('Telegram file error:', err.message);

  }

};

/* =========================
   TELEGRAM LISTENER
========================= */

const startTelegramListener = () => {

  console.log("🤖 Telegram listener aktif");

  setInterval(async () => {

    try {

      const res = await axios.get(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${lastUpdateId + 1}`
      );

      const updates = res.data.result;

      for (const update of updates) {

        lastUpdateId = update.update_id;

        if (!update.message) continue;

        const text = update.message.text || "";

        if (text.startsWith("/run")) {

          const parts = text.split(" ");
          const thread = parseInt(parts[1]) || 3;

          TELEGRAM_MODE = true;
          TELEGRAM_THREAD = thread;

          await kirimTelegram(`🚀 Bot dijalankan dengan ${thread} thread`);

          runMain();

        }

        if (text === "/status") {

          await kirimTelegram("🤖 Bot aktif dan menunggu perintah");

        }

        if (text === "/result") {

          await kirimFileTelegram(LINK_FILE);

        }

      }

    } catch (err) {

      console.log("Telegram polling error:", err.message);

    }

  }, 3000);

};

/* =========================
   SAVE LINK
========================= */

const saveSheerIDUrl = async (email, url) => {

  try {

    let existingEntries = [];

    if (fs.existsSync(LINK_FILE)) {

      existingEntries = fs.readFileSync(LINK_FILE, 'utf-8')
        .split('\n')
        .filter(line => line.trim());

    }

    const newEntry = `${email}:${url}`;

    const isEmailExists = existingEntries.some(entry => entry.startsWith(`${email}:`));

    if (!isEmailExists) {

      existingEntries.push(newEntry);

      fs.writeFileSync(LINK_FILE, existingEntries.join('\n'));

      console.log(`URL SheerID disimpan untuk ${email}`);

      await kirimTelegram(`🔗 SheerID\n${email}\n${url}`);

    }

  } catch (err) {

    console.error('Gagal menyimpan URL:', err.message);

  }

};

/* =========================
   THREAD INPUT
========================= */

const askThreadCount = () => {

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {

    rl.question('🧵 Mau pakai berapa thread (1-20)? ', answer => {

      rl.close();

      const num = parseInt(answer);

      if (isNaN(num) || num < 1 || num > 20) {

        console.log('Input tidak valid');
        process.exit(1);

      }

      resolve(num);

    });

  });

};

/* =========================
   DISPLAY RESULT
========================= */

const displayResults = async () => {

  if (fs.existsSync(LINK_FILE)) {

    const content = fs.readFileSync(LINK_FILE, 'utf-8');

    const entries = content.split('\n').filter(Boolean);

    await kirimFileTelegram(LINK_FILE);

    return entries.length;

  }

  return 0;

};

/* =========================
   PROCESS ACCOUNT
========================= */

const processSingleAccount = async ({ email, pass }, browserIndex, failedAccounts) => {

  console.log(`🚀 Browser ${browserIndex} memproses ${email}`);

  const browser = await puppeteer.launch({
    headless: IS_HEADLESS,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--blink-settings=imagesEnabled=false'
    ]
  });

  const page = await browser.newPage();

  try {

    await page.goto('https://accounts.google.com/servicelogin?hl=id');

    await page.type('input[type="email"]', email, { delay: 100 });

    await page.keyboard.press('Enter');

    await page.waitForSelector('input[type="password"]');

    await page.type('input[type="password"]', pass, { delay: 100 });

    await page.keyboard.press('Enter');

    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    console.log(`Login berhasil: ${email}`);

    await page.goto('https://music.youtube.com/youtube_premium/student');

    await delay(5000);

    const sheerIDUrl = page.url();

    if (sheerIDUrl.includes('sheerid.com')) {

      await saveSheerIDUrl(email, sheerIDUrl);

    } else {

      failedAccounts.push({ email, pass });

    }

  } catch (err) {

    console.log(`Error akun ${email}`);

    failedAccounts.push({ email, pass });

  }

  await browser.close();

};

/* =========================
   BATCH PROCESS
========================= */

const processAccountsInBatches = async (akunList, threadCount) => {

  const failedAccounts = [];

  while (akunList.length > 0) {

    const currentBatch = akunList.splice(0, threadCount);

    const browserPromises = currentBatch.map((akun, index) => {

      return new Promise(resolve => {

        setTimeout(async () => {

          await processSingleAccount(akun, index + 1, failedAccounts);

          resolve();

        }, index * 2000);

      });

    });

    await Promise.all(browserPromises);

  }

  if (failedAccounts.length > 0) {

    const failed = failedAccounts.map(acc => `${acc.email} ${acc.pass}`).join('\n');

    fs.writeFileSync('akun_gagal.txt', failed);

    await kirimFileTelegram('akun_gagal.txt');

  }

  const totalLinks = await displayResults();

  await kirimTelegram(`📊 Selesai\nTotal URL: ${totalLinks}`);

};

/* =========================
   MAIN
========================= */

const runMain = async () => {

  if (!fs.existsSync(LINK_FILE)) {
    fs.writeFileSync(LINK_FILE, '');
  }

  const akunList = fs.readFileSync('akun.txt', 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => {

      const [email, pass] = line.trim().split(' ');

      return { email, pass };

    });

  if (akunList.length === 0) {

    console.log('Tidak ada akun');

    await kirimTelegram('akun.txt kosong');

    return;

  }

  console.log(`Total akun: ${akunList.length}`);

  let threadCount;

  if (TELEGRAM_MODE) {
    threadCount = TELEGRAM_THREAD;
  } else {
    threadCount = await askThreadCount();
  }

  await processAccountsInBatches(akunList, threadCount);

};

/* =========================
   START MODE
========================= */

if (process.argv.includes("--telegram")) {

  console.log("Mode Telegram aktif");

  startTelegramListener();

} else {

  runMain();

                }
