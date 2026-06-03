import { Request, Response, NextFunction } from "express";
import {sendSuccess} from "../utils/response.util";
import * as practiceService from "../services/practice.service";
/**
 * @swagger
 * /api/v1/learning/practice-modes:
 *   get:
 *     summary: Lấy danh sách chế độ luyện tập & trạng thái Coming Soon
 *     tags: [Learning]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Trả về danh sách practice modes theo PracticeModeDto
 */
export async function getPracticeModesController(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const userId = req.user!.id;
        const data = await practiceService.getPracticeModes(userId);
        sendSuccess(res, "Practice modes fetched successfully", data);
    } catch (err) {
        next(err);
    }
}