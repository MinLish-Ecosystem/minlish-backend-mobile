import { Router } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { validate } from "../middlewares/validate.middleware";
import { body, param, query } from "express-validator";
import {
  getDueSummaryController,
  getLearningQueueController,
  submitReviewController,
  getSetLearningQueueController,
  getSetProgressSummaryController,
  getWordSRSProgressController,
  batchSyncController, getHomeDashboardController, getFlashcardTestController, batchReviewController
} from "../controllers/learning.controller";

/**
 * @swagger
 * tags:
 *   - name: Learning
 *     description: Hệ thống học tập Spaced Repetition (SRS) bằng thuật toán SM-2
 */

const router = Router();

// Tất cả các route bên dưới đều bắt buộc xác thực Token
router.use(verifyToken);

/**
 * @swagger
 * /api/v1/learning/due-summary:
 *   get:
 *     summary: Lấy nhanh số từ đến hạn học và ôn tập hôm nay (Badge count)
 *     tags: [Learning]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Trả về số từ mới và số từ cần ôn đến hạn
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Due summary fetched successfully" }
 *                 data:
 *                   type: object
 *                   properties:
 *                     newWordsCount: { type: number, example: 10 }
 *                     dueReviewsCount: { type: number, example: 15 }
 *                     totalDueCount: { type: number, example: 25 }
 */
router.get("/due-summary", getDueSummaryController);

/**
 * @swagger
 * /api/v1/learning/queue:
 *   get:
 *     summary: Lấy hàng đợi từ vựng học mới và ôn tập hôm nay (Global queue)
 *     tags: [Learning]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: previewOnly
 *         schema:
 *           type: boolean
 *         description: Nếu là true chỉ trả về số lượng tóm tắt, không trả về chi tiết từ
 *       - in: query
 *         name: timezone
 *         schema:
 *           type: string
 *           default: "Asia/Ho_Chi_Minh"
 *     responses:
 *       200:
 *         description: Trả về hàng đợi học tập chi tiết phân loại New và Review
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     newCards:
 *                       type: array
 *                       items:
 *                         type: object
 *                     reviewCards:
 *                       type: array
 *                       items:
 *                         type: object
 *                     summary:
 *                       type: object
 */
router.get(
  "/queue",
  [
    query("previewOnly").optional().isBoolean().toBoolean(),
    query("timezone").optional().isString()
  ],
  validate,
  getLearningQueueController
);

/**
 * @swagger
 * /api/v1/learning/words/{wordId}/review:
 *   post:
 *     summary: Nộp kết quả ôn tập/học từ vựng (SRS SM-2)
 *     tags: [Learning]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: wordId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - setId
 *               - rating
 *             properties:
 *               setId:
 *                 type: string
 *                 example: "660c1abf8c0288219..."
 *               rating:
 *                 type: string
 *                 enum: [again, hard, good, easy]
 *                 example: "good"
 *               timeSpent:
 *                 type: number
 *                 description: Số giây dùng để học từ này
 *                 example: 7
 *               reviewedAt:
 *                 type: string
 *                 format: date-time
 *                 description: Mốc thời gian thực hiện (hỗ trợ offline sync)
 *     responses:
 *       200:
 *         description: Trả về kết quả SRS mới của từ vựng vừa đánh giá
 */
router.post(
  "/words/:wordId/review",
  [
    param("wordId").isMongoId().withMessage("Invalid wordId"),
    body("setId").isMongoId().withMessage("Invalid setId"),
    body("rating").isIn(["again", "hard", "good", "easy"]).withMessage("Invalid rating value"),
    body("timeSpent").optional().isInt({ min: 0 }).toInt(),
    body("reviewedAt").optional().isISO8601().withMessage("reviewedAt must be ISO8601 date format")
  ],
  validate,
  submitReviewController
);

/**
 * @swagger
 * /api/v1/learning/sets/{id}/queue:
 *   get:
 *     summary: Lấy hàng đợi ôn tập/học từ riêng cho một bộ từ vựng cụ thể
 *     tags: [Learning]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Trả về hàng đợi học tập chi tiết thuộc bộ từ vựng
 */
router.get(
  "/sets/:id/queue",
  [param("id").isMongoId().withMessage("Invalid setId")],
  validate,
  getSetLearningQueueController
);

/**
 * @swagger
 * /api/v1/learning/sets/{id}/progress:
 *   get:
 *     summary: Lấy tóm tắt tiến trình học của 1 bộ từ vựng
 *     tags: [Learning]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Trả về tóm tắt thống kê các số từ theo status
 */
router.get(
  "/sets/:id/progress",
  [param("id").isMongoId().withMessage("Invalid setId")],
  validate,
  getSetProgressSummaryController
);

/**
 * @swagger
 * /api/v1/learning/words/{wordId}/progress:
 *   get:
 *     summary: Lấy chi tiết SRS tiến độ học của một từ vựng cụ thể
 *     tags: [Learning]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: wordId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Trả về các chỉ số easeFactor, interval, repetitions của từ vựng
 */
router.get(
  "/words/:wordId/progress",
  [param("wordId").isMongoId().withMessage("Invalid wordId")],
  validate,
  getWordSRSProgressController
);

/**
 * @swagger
 * /api/v1/learning/sync:
 *   post:
 *     summary: Đồng bộ hàng loạt lịch sử ôn tập ngoại tuyến (Offline Batch Sync)
 *     tags: [Learning]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reviews
 *             properties:
 *               reviews:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - wordId
 *                     - setId
 *                     - rating
 *                   properties:
 *                     wordId: { type: string }
 *                     setId: { type: string }
 *                     rating: { type: string, enum: [again, hard, good, easy] }
 *                     timeSpent: { type: number }
 *                     reviewedAt: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Trả về danh sách kết quả đồng bộ của từng từ
 */
router.post(
  "/sync",
  [
    body("reviews").isArray().withMessage("reviews must be an array"),
    body("reviews.*.wordId").isMongoId().withMessage("Invalid wordId in reviews"),
    body("reviews.*.setId").isMongoId().withMessage("Invalid setId in reviews"),
    body("reviews.*.rating").isIn(["again", "hard", "good", "easy"]).withMessage("Invalid rating in reviews"),
    body("reviews.*.timeSpent").optional().isInt({ min: 0 }).toInt(),
    body("reviews.*.reviewedAt").optional().isISO8601().withMessage("reviewedAt must be ISO8601 date")
  ],
  validate,
  batchSyncController
);

/**
 * @swagger
 * /api/v1/learning/home:
 *   get:
 *     summary: Lấy dữ liệu tổng quan màn hình Home (Learning Dashboard)
 *     tags: [Learning]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Trả về thông tin tổng quan - số từ mới, số từ cần ôn, và danh sách bộ từ vựng kèm trạng thái học hôm nay
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Home dashboard loaded"
 *                 data:
 *                   type: object
 *                   properties:
 *                     userId:
 *                       type: string
 *                       example: "65f1a2b3c4d5e6f7a8b9c0d1"
 *                     newWords:
 *                       type: integer
 *                       example: 12
 *                     reviewsDue:
 *                       type: integer
 *                       example: 25
 *                     vocabSets:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string, example: "660c1abf8c0288219..." }
 *                           title: { type: string, example: "IELTS Core Vocabulary" }
 *                           wordCount: { type: integer, example: 150 }
 *                           icon: { type: string, example: "📘" }
 *                           isDueToday: { type: boolean, example: true }
 */

router.get("/home", verifyToken, getHomeDashboardController);
/**
 * @swagger
 * /api/v1/learning/flashcard-test:
 *   get:
 *     summary: Lấy danh sách flashcard để làm bài test/luyện tập
 *     tags: [Learning]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: setId
 *         schema: { type: string }
 *         description: Lọc theo ID bộ từ vựng (optional)
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *         description: Số lượng flashcard trả về
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [new, learning, review, mastered] }
 *         description: Lọc theo trạng thái SRS của từ
 *     responses:
 *       200:
 *         description: Trả về danh sách flashcard khớp FlashCardTestDto
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Flashcards fetched successfully" }
 *                 data:
 *                   type: object
 *                   properties:
 *                     userId: { type: string }
 *                     flashCardSets:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           category: { type: string, example: "ielts" }
 *                           word: { type: string, example: "ephemeral" }
 *                           phonetic: { type: string, example: "/ɪˈfem.ər.əl/" }
 *                           partOfSpeech: { type: string, example: "adjective" }
 *                           definition: { type: string, example: "lasting for a very short time" }
 *                           example: { type: string, example: "The ephemeral beauty of cherry blossoms" }
 */

router.get("/flashcard-test", verifyToken, getFlashcardTestController);
router.post(
  "/batch-review",
  verifyToken,
  [
    body("reviews").isArray().withMessage("reviews must be an array"),
    body("reviews.*.wordId").isMongoId().withMessage("Invalid wordId"),
    body("reviews.*.setId").isMongoId().withMessage("Invalid setId"),
    body("reviews.*.rating").isIn(["again", "hard", "good", "easy"]).withMessage("Invalid rating"),
    body("reviews.*.timeSpent").optional().isInt({ min: 0 }).toInt(),
    body("reviews.*.reviewedAt").optional().isISO8601().withMessage("reviewedAt must be ISO8601")
  ],
  validate,
  batchReviewController
);
export default router;
