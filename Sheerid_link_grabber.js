const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const readline = require('readline');
const axios = require('axios');
const FormData = require('form-data');

puppeteer.use(StealthPlugin());

const IS_HEADLESS = process.argv.includes('--headless');

const TELEGRAM_TOKEN = "8796052869:AAFAiyxqIZGdCXY2b3zCe4cTVCLmxE6qcBg";
const TELEGRAM_CHAT_ID = "7676651391";

const LINK_FILE = path.join(__dirname, "link.txt");

let TELEGRAM_MODE = false;
let TELEGRAM_THREAD = 5;
let lastUpdateId = 0;

const delay = ms => new Promise(r => setTimeout(r, ms));

/* =========================
   TELEGRAM SEND
========================= */

const kirimTelegram = async (text) => {

  try {

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "Markdown"
    });

  } catch (err) {

    console.log("Telegram error:", err.message);

  }

};

const kirimFileTelegram = async (filePath) => {

  if (!fs.existsSync(filePath)) return;

  const form = new FormData();

  form.append("chat_id", TELEGRAM_CHAT_ID);
  form.append("document", fs.createReadStream(filePath));

  await axios.post(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`,
    form,
    { headers: form.getHeaders() }
  );

};

/* =========================
   TELEGRAM MENU
========================= */

const kirimMenu = async () => {

  await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {

    chat_id: TELEGRAM_CHAT_ID,

    text: "🤖 *SheerID Bot*\nUpload akun.txt lalu tekan RUN",

    parse_mode: "Markdown",

    reply_markup: {
      inline_keyboard: [
        [
          { text: "▶️ RUN", callback_data: "run" },
          { text: "📊 STATUS", callback_data: "status" }
        ],
        [
          { text: "📄 RESULT", callback_data: "result" }
        ]
      ]
    }

  });

};

/* =========================
   DOWNLOAD FILE TELEGRAM
========================= */

const downloadTelegramFile = async (file_id) => {

  const fileInfo = await axios.get(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${file_id}`
  );

  const filePath = fileInfo.data.result.file_path;

  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;

  const response = await axios.get(fileUrl, { responseType: "stream" });

  const writer = fs.createWriteStream("akun.txt");

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {

    writer.on("finish", resolve);
    writer.on("error", reject);

  });

};

/* =========================
   SAVE SHEERID LINK
========================= */

const saveSheerIDUrl = async (email, url) => {

  let existing = [];

  if (fs.existsSync(LINK_FILE)) {

    existing = fs.readFileSync(LINK_FILE, "utf8").split("\n").filter(Boolean);

  }

  const entry = `${email}:${url}`;

  if (!existing.find(e => e.startsWith(email))) {

    existing.push(entry);

    fs.writeFileSync(LINK_FILE, existing.join("\n"));

    await kirimTelegram(`🔗 SheerID\n${email}\n${url}`);

  }

};

/* =========================
   THREAD INPUT CLI
========================= */

const askThreadCount = () => {

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {

    rl.question("Thread (1-20)? ", answer => {

      rl.close();

      resolve(parseInt(answer));

    });

  });

};

/* =========================
   PROCESS ACCOUNT
========================= */

const processSingleAccount = async ({ email, pass }, index, failed) => {

  console.log("Processing", email);

  const browser = await puppeteer.launch({

    headless: IS_HEADLESS,

    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--blink-settings=imagesEnabled=false"
    ]

  });

  const page = await browser.newPage();

  try {

    await page.goto("https://accounts.google.com/servicelogin?hl=id");

    await page.type('input[type="email"]', email);

    await page.keyboard.press("Enter");

    await page.waitForSelector('input[type="password"]');

    await page.type('input[type="password"]', pass);

    await page.keyboard.press("Enter");

    await page.waitForNavigation({ waitUntil: "networkidle2" });

    await page.goto("https://music.youtube.com/youtube_premium/student");

    await delay(5000);

    const url = page.url();

    if (url.includes("sheerid")) {

      await saveSheerIDUrl(email, url);

    } else {

      failed.push({ email, pass });

    }

  } catch (err) {

    failed.push({ email, pass });

  }

  await browser.close();

};

/* =========================
   PROCESS BATCH
========================= */

const processAccountsInBatches = async (accounts, thread) => {

  const failed = [];

  while (accounts.length > 0) {

    const batch = accounts.splice(0, thread);

    const jobs = batch.map((acc, i) => {

      return new Promise(resolve => {

        setTimeout(async () => {

          await processSingleAccount(acc, i + 1, failed);

          resolve();

        }, i * 2000);

      });

    });

    await Promise.all(jobs);

  }

  if (failed.length) {

    const txt = failed.map(a => `${a.email} ${a.pass}`).join("\n");

    fs.writeFileSync("akun_gagal.txt", txt);

    await kirimFileTelegram("akun_gagal.txt");

  }

  await kirimFileTelegram(LINK_FILE);

  await kirimTelegram("✅ Selesai");

};

/* =========================
   MAIN
========================= */

const runMain = async () => {

  if (!fs.existsSync("akun.txt")) {

    await kirimTelegram("⚠️ akun.txt belum ada");

    return;

  }

  const accounts = fs.readFileSync("akun.txt","utf8")
    .split("\n")
    .filter(Boolean)
    .map(v => {

      const [email, pass] = v.split(" ");

      return { email, pass };

    });

  let thread;

  if (TELEGRAM_MODE) {

    thread = TELEGRAM_THREAD;

  } else {

    thread = await askThreadCount();

  }

  await processAccountsInBatches(accounts, thread);

};

/* =========================
   TELEGRAM LISTENER
========================= */

const startTelegram = () => {

  console.log("Telegram listener aktif");

  kirimMenu();

  setInterval(async () => {

    try {

      const res = await axios.get(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${lastUpdateId + 1}`
      );

      for (const update of res.data.result) {

        lastUpdateId = update.update_id;

        /* upload akun.txt */

        if (update.message && update.message.document) {

          const doc = update.message.document;

          if (doc.file_name === "akun.txt") {

            await kirimTelegram("📥 menerima akun.txt...");

            await downloadTelegramFile(doc.file_id);

            await kirimTelegram("✅ akun.txt disimpan");

            await kirimMenu();

          }

        }

        /* tombol */

        if (update.callback_query) {

          const data = update.callback_query.data;

          if (data === "run") {

            TELEGRAM_MODE = true;

            await kirimTelegram("🚀 Memulai bot...");

            runMain();

          }

          if (data === "status") {

            await kirimTelegram("🤖 Bot aktif");

          }

          if (data === "result") {

            await kirimFileTelegram(LINK_FILE);

          }

          await axios.post(
            `https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`,
            { callback_query_id: update.callback_query.id }
          );

        }

      }

    } catch (err) {

      console.log("Polling error:", err.message);

    }

  }, 3000);

};

/* =========================
   START
========================= */

if (process.argv.includes("--telegram")) {

  startTelegram();

} else {

  runMain();

}
