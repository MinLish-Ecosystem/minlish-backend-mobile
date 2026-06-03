// src/routes/practice.routes.ts
import { Router } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { getPracticeModesController } from "../controllers/practice.controller";

const router = Router();

// Áp dụng verifyToken cho tất cả route trong file này
router.use(verifyToken);

/**
 * @swagger
 * /api/v1/practice/practice-modes:
 *   get:
 *     summary: Lấy danh sách chế độ luyện tập
 *     tags: [Practice]
 *     responses:
 *       200:
 *         description: Practice modes list
 */
router.get("/practice-modes", getPracticeModesController);

export default router;