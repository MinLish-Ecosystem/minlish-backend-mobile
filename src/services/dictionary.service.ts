import axios from "axios";
import { AppError } from "../utils/AppError";
import { HttpStatus } from "../constants/httpStatus";

// Cache đơn giản (production nên dùng Redis)
const dictionaryCache = new Map<string, any>();
const CACHE_TTL = 1000 * 60 * 60; // 1 giờ

export async function lookupWord(word: string) {
    if (!word || word.trim().length === 0) {
        throw new AppError("Word is required", HttpStatus.BAD_REQUEST);
    }

    const cleanWord = word.trim().toLowerCase();

    // 1. Check cache
    if (dictionaryCache.has(cleanWord)) {
        return dictionaryCache.get(cleanWord).data;
    }

    try {
        // 2. Gọi API thứ 3 (VD: Free Dictionary API)
        const res = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${cleanWord}`, {
            timeout: 5000,
            validateStatus: (status) => status < 500 // Không ném lỗi ở 404
        });

        if (res.status === 404) {
            throw new AppError("Word not found in dictionary", HttpStatus.NOT_FOUND);
        }
        // 3. Chuẩn hóa response (chỉ lấy field cần thiết)
        const data = res.data[0];
        const phonetics = data.phonetics || [];
        const audioPhonetic = phonetics.find((p: any) => p.audio && p.audio !== "") || phonetics[0];
        const normalized = {
            word: data.word,
            phonetic: data.phonetic || data.phonetics?.[0]?.text || "",
            audio: audioPhonetic?.audio || "",
            meanings: data.meanings?.map((m: any) => ({
                partOfSpeech: m.partOfSpeech,
                definitions: m.definitions?.slice(0, 3).map((d: any) => ({
                    definition: d.definition,
                    example: d.example || ""
                })) || []
            })) || [],
            sourceUrl: data.sourceUrls?.[0] || ""
        };

        // 4. Lưu cache
        dictionaryCache.set(cleanWord, { data: normalized, cachedAt: Date.now() });

        // 5. (Optional) Lưu vào DB nếu muốn làm từ điển riêng
        // await VocabularyService.createOrUpdateFromDictionary(normalized);

        return normalized;
    } catch (err: any) {
        if (err instanceof AppError) throw err;
        throw new AppError("Dictionary API failed", HttpStatus.BAD_GATEWAY);
    }
}