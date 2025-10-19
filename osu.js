import axios from "axios";
import fs from "fs";
import path from "path";
import os from "os";
import dotenv from "dotenv";

dotenv.config();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

// Caminho fixo para a pasta do osu! Songs
const OSU_SONGS_PATH = path.join(os.homedir(), "AppData", "Local", "osu!", "Songs");

// Caminho do arquivo que guarda os IDs baixados
const DOWNLOADED_FILE = path.join(process.cwd(), "downloaded_maps.json");

// Carregar ou criar arquivo de músicas baixadas
function loadDownloaded() {
    if (!fs.existsSync(DOWNLOADED_FILE)) {
        fs.writeFileSync(DOWNLOADED_FILE, JSON.stringify([]));
    }
    const data = fs.readFileSync(DOWNLOADED_FILE, "utf8");
    try {
        return new Set(JSON.parse(data));
    } catch {
        fs.writeFileSync(DOWNLOADED_FILE, JSON.stringify([]));
        return new Set();
    }
}

// Salvar lista atualizada de músicas baixadas
function saveDownloaded(downloadedSet) {
    fs.writeFileSync(DOWNLOADED_FILE, JSON.stringify([...downloadedSet], null, 2));
}

// 1️⃣ Obter token de acesso
async function getAccessToken() {
    const res = await axios.post("https://osu.ppy.sh/oauth/token", {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "client_credentials",
        scope: "public",
    });
    return res.data.access_token;
}

// Embaralhar array
function shuffle(array) {
    return array.sort(() => Math.random() - 0.5);
}

// 2️⃣ Buscar beatmaps (evitando repetidos)
async function searchBeatmaps(token, userMin = 4.0, userMax = 5.0, limit = 5, downloadedSet) {
    let beatmaps = [];

    for (let i = 0; i < 10; i++) {
        const minStars = (Math.random() * (userMax - userMin) + userMin).toFixed(2);
        const maxStars = (Math.random() * (userMax - minStars) + parseFloat(minStars)).toFixed(2);

        const res = await axios.get("https://osu.ppy.sh/api/v2/beatmapsets/search", {
            headers: { Authorization: `Bearer ${token}` },
            params: {
                q: `stars>=${minStars} stars<=${maxStars} mode=osu`,
                sort: "plays_desc",
            },
        });

        // Filtra os que não foram baixados ainda
        const newBeatmaps = res.data.beatmapsets.filter(
            (b) => !downloadedSet.has(b.id)
        );

        beatmaps.push(...newBeatmaps);

        if (beatmaps.length >= limit) break;
    }

    if (beatmaps.length === 0) {
        console.log("⚠️ Nenhum mapa novo encontrado dentro do intervalo de dificuldade.");
    }

    return shuffle(beatmaps).slice(0, limit);
}

// 3️⃣ Baixar beatmap (.osz) com fallback automático
async function downloadBeatmap(beatmapId, title) {
    const primaryUrl = `https://osu.direct/api/d/${beatmapId}`;
    const fallbackUrl = `https://api.nerinyan.moe/d/${beatmapId}`;
    const fileName = `${title.replace(/[<>:"/\\|?*]/g, "_")}.osz`;
    const filePath = path.join(OSU_SONGS_PATH, fileName);

    if (!fs.existsSync(OSU_SONGS_PATH)) fs.mkdirSync(OSU_SONGS_PATH, { recursive: true });

    async function tryDownload(url, sourceName) {
        return new Promise(async (resolve, reject) => {
            try {
                const res = await axios.get(url, { responseType: "stream" });
                const writer = fs.createWriteStream(filePath);
                res.data.pipe(writer);

                let lastProgress = Date.now();

                // Timeout de 3s se não houver progresso
                const interval = setInterval(() => {
                    if (Date.now() - lastProgress > 3000) {
                        clearInterval(interval);
                        writer.destroy();
                        reject(new Error(`Sem progresso em ${sourceName} (timeout de 3s)`));
                    }
                }, 1000);

                res.data.on("data", () => {
                    lastProgress = Date.now();
                });

                writer.on("finish", () => {
                    clearInterval(interval);
                    resolve();
                });

                writer.on("error", (err) => {
                    clearInterval(interval);
                    reject(err);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    try {
        console.log(`⬇️ Baixando de osu.direct: ${title}`);
        await tryDownload(primaryUrl, "osu.direct");
        console.log(`✅ Download concluído: ${fileName}`);
        return true;
    } catch (err1) {
        console.warn(`⚠️ Falha no osu.direct (${err1.message}), tentando Nerinyan...`);
        try {
            await tryDownload(fallbackUrl, "Nerinyan");
            console.log(`✅ Download concluído via Nerinyan: ${fileName}`);
            return true;
        } catch (err2) {
            console.error(`❌ Falha ao baixar ${title} em ambas as fontes: ${err2.message}`);
            return false;
        }
    }
}

// 4️⃣ Mostrar e baixar recomendações
async function showRecommendations(beatmaps, downloadedSet) {
    console.log("\n🎵 Recomendações de mapas para você:\n");

    for (const beatmap of beatmaps) {
        const difficulty = beatmap.beatmaps[0]?.difficulty_rating ?? 0;
        const title = beatmap.title;
        console.log(`${title} [${difficulty.toFixed(2)}★]`);
        console.log(`   🔗 https://osu.ppy.sh/beatmapsets/${beatmap.id}`);

        const success = await downloadBeatmap(beatmap.id, title);
        if (success) {
            downloadedSet.add(beatmap.id);
            saveDownloaded(downloadedSet);
        }
    }
}

// 5️⃣ Fluxo principal
async function main() {
    console.log("🎵 Gerando recomendações e baixando mapas...");

    const downloadedSet = loadDownloaded();
    const token = await getAccessToken();
    const beatmaps = await searchBeatmaps(token, 4.0, 5.0, 5, downloadedSet);

    if (!beatmaps.length) {
        console.log("⚠️ Nenhum beatmap novo encontrado. Tente novamente.");
        return;
    }

    await showRecommendations(beatmaps, downloadedSet);
}



main().catch(console.error);
