import { PracticeModeResponse, ModeItem } from "../types/practice.types";

// 🔧 BIẾN CẤU HÌNH CỨNG - Chỉ cần sửa chỗ này khi thay đổi tính năng
const PRACTICE_MODES_CONFIG: ModeItem[] = [
    { id: "smart_review",       isComingSoon: false },
    { id: "vocabulary_quiz",    isComingSoon: true },
    { id: "listening_challenge",isComingSoon: true },
    { id: "writing_practice",   isComingSoon: true }
];

/**
 * Trả về danh sách chế độ luyện tập (Hardcoded config)
 */
export async function getPracticeModes(userId: string): Promise<PracticeModeResponse> {
    return {
        id: userId,               // Lấy từ JWT token để khớp luồng app
        practiceModes: PRACTICE_MODES_CONFIG // Trả nguyên mảng config
    };
}