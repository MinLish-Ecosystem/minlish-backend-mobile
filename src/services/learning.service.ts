import mongoose, { Types } from "mongoose";
import { LearningProgress } from "../models/LearningProgress";
import { VocabularySet } from "../models/VocabularySet";
import { Word } from "../models/Word";
import { UserProfile } from "../models/UserProfile";
import { DailyStats } from "../models/DailyStats";
import { applyReview } from "../utils/sm2";
import { AppError } from "../utils/AppError";
import { HttpStatus } from "../constants/httpStatus";
import { ErrorCodes } from "../constants/errorCodes";
import { dispatch } from './notification-dispatcher.service';
import {
  LearningQueueFilters,
  LearningQueueResponse,
  DueSummaryResponse,
  SubmitReviewDTO,
  SubmitReviewResponse,
  SetProgressSummary,
  WordSRSProgress,
  LearningCard,
  QueueSummary, FlashcardQuery, FlashcardContent, BatchSubmitReviewDTO, BatchSubmitReviewResponse
} from "../types/learning.types";

/**
 * 1. Lấy nhanh tóm tắt số từ đến hạn học và ôn tập hôm nay (Badge count)
 */
export async function getDueSummary(userId: string): Promise<DueSummaryResponse> {
  const userObjectId = new Types.ObjectId(userId);
  const now = new Date();

  // Đọc User Profile cấu hình để lấy chỉ tiêu
  const profile = await UserProfile.findOne({ userId: userObjectId }).lean();
  const dailyGoal = profile?.dailyGoal ?? 10;
  const reviewPerDay = (profile as any)?.reviewPerDay ?? 20;

  // 1. Đếm từ cần ôn tập đến hạn
  const dueReviewsCount = await LearningProgress.countDocuments({
    userId: userObjectId,
    status: { $ne: "new" },
    nextReviewDate: { $lte: now }
  });

  // 2. Đếm từ mới chưa từng học (thuộc các bộ từ trong library của user)
  const userSetIds = await VocabularySet.find({
    userId: userObjectId,
    isDeleted: { $ne: true }
  }).distinct("_id");

  const newWordsCountResult = await Word.aggregate([
    { $match: { setId: { $in: userSetIds }, isDeleted: { $ne: true } } },
    {
      $lookup: {
        from: "learningprogresses",
        let: { wordId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$wordId", "$$wordId"] },
                  { $eq: ["$userId", userObjectId] }
                ]
              }
            }
          }
        ],
        as: "progress"
      }
    },
    { $match: { "progress.0": { $exists: false } } }, // Words chưa có tiến trình học
    { $count: "count" }
  ]);

  const rawNewWordsCount = newWordsCountResult[0]?.count ?? 0;

  // Áp dụng giới hạn hàng ngày để ra badge thực tế hiển thị
  const actualNew = Math.min(dailyGoal, rawNewWordsCount);
  const actualReview = Math.min(reviewPerDay, dueReviewsCount);

  return {
    newWordsCount: actualNew,
    dueReviewsCount: actualReview,
    totalDueCount: actualNew + actualReview
  };
}

/**
 * 2. Lấy hàng đợi từ vựng học và ôn tập hôm nay (Global queue)
 * Tối ưu hóa JOIN qua $lookup để tránh N+1 và loại bỏ hoàn toàn dùng $nin với mảng lớn.
 */
export async function getLearningQueue(
  userId: string,
  filters: LearningQueueFilters
): Promise<LearningQueueResponse> {
  const userObjectId = new Types.ObjectId(userId);
  const now = new Date();

  // Đọc chỉ tiêu hàng ngày của User
  const profile = await UserProfile.findOne({ userId: userObjectId }).lean();
  const dailyGoal = profile?.dailyGoal ?? 10;
  const reviewPerDay = (profile as any)?.reviewPerDay ?? 20;

  // Lấy các SetId trong thư viện để chỉ học các từ thuộc thư viện cá nhân
  const userSetIds = await VocabularySet.find({
    userId: userObjectId,
    isDeleted: { $ne: true }
  }).distinct("_id");

  // ─── PHẦN 1: QUÂN BÀI CẦN ÔN (REVIEW CARDS) ───
  const reviewProgress = await LearningProgress.find({
    userId: userObjectId,
    setId: { $in: userSetIds },
    status: { $ne: "new" },
    nextReviewDate: { $lte: now }
  })
    .sort({ nextReviewDate: 1 })
    .limit(reviewPerDay)
    .populate("wordId")
    .populate("setId", "name colorTheme")
    .lean();

  // ─── PHẦN 2: QUÂN BÀI MỚI (NEW CARDS) ───
  // Dùng $lookup loại trừ tiến trình đã học, cực kỳ nhanh chóng và an toàn hiệu năng
  const newWords = await Word.aggregate([
    { $match: { setId: { $in: userSetIds }, isDeleted: { $ne: true } } },
    {
      $lookup: {
        from: "learningprogresses",
        let: { wordId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$wordId", "$$wordId"] },
                  { $eq: ["$userId", userObjectId] }
                ]
              }
            }
          }
        ],
        as: "progress"
      }
    },
    { $match: { "progress.0": { $exists: false } } }, // Chỉ lấy từ chưa học
    { $limit: dailyGoal }
  ]);

  const summary: QueueSummary = {
    newCount: newWords.length,
    reviewCount: reviewProgress.length,
    totalToday: newWords.length + reviewProgress.length,
    estimatedMinutes: Math.ceil(newWords.length * 2 + reviewProgress.length * 1.2)
  };

  if (filters.previewOnly) {
    return { newCards: [], reviewCards: [], summary };
  }

  // Lấy map bối cảnh bộ từ vựng
  const setMap = new Map(
    (await VocabularySet.find({ _id: { $in: userSetIds } }).select("name colorTheme").lean())
      .map((s) => [s._id.toString(), s])
  );

  const newCards: LearningCard[] = newWords.map((w) => ({
    id: w._id.toString(),
    word: w.word,
    pronunciation: w.pronunciation,
    partOfSpeech: w.partOfSpeech,
    meaning: w.meaning,
    examples: w.examples ?? [],
    audioUrl: w.audioUrl,
    status: "new",
    setContext: {
      setId: w.setId.toString(),
      setName: setMap.get(w.setId.toString())?.name,
      colorTheme: setMap.get(w.setId.toString())?.colorTheme
    }
  }));

  const reviewCards: LearningCard[] = reviewProgress.map((p: any) => {
    const word = p.wordId;
    const set = p.setId;
    return {
      id: word._id.toString(),
      word: word.word,
      pronunciation: word.pronunciation,
      partOfSpeech: word.partOfSpeech,
      meaning: word.meaning,
      examples: word.examples ?? [],
      audioUrl: word.audioUrl,
      status: p.status,
      easeFactor: p.easeFactor,
      interval: p.interval,
      nextReviewDate: p.nextReviewDate.toISOString(),
      setContext: {
        setId: set._id.toString(),
        setName: set.name,
        colorTheme: set.colorTheme
      }
    };
  });

  return { newCards, reviewCards, summary };
}

/**
 * 3. Nộp kết quả ôn tập/học từ vựng (Spaced Repetition SM-2 Submit)
 */
export async function submitReview(
  wordId: string,
  userId: string,
  data: SubmitReviewDTO
): Promise<SubmitReviewResponse> {
  const wordObjectId = new Types.ObjectId(wordId);
  const userObjectId = new Types.ObjectId(userId);
  const setObjectId = new Types.ObjectId(data.setId);

  // 1. Kiểm tra Clock Skew bảo vệ tiến độ (lệch tối đa 30 phút)
  if (data.reviewedAt) {
    const timeDiff = Math.abs(Date.now() - new Date(data.reviewedAt).getTime());
    if (timeDiff > 30 * 60 * 1000) {
      throw new AppError("Clock skew detected (> 30 min)", HttpStatus.BAD_REQUEST, "ERR_CLOCK_SKEW");
    }
  }

  // 2. Xác thực quyền sở hữu bộ từ của User
  const setExists = await VocabularySet.findOne({
    _id: setObjectId,
    userId: userObjectId,
    isDeleted: { $ne: true }
  }).lean();

  if (!setExists) {
    throw new AppError("Set not found or unauthorized", HttpStatus.FORBIDDEN, ErrorCodes.FORBIDDEN);
  }

  // 3. Tìm tiến trình cũ hoặc khởi tạo mặc định cho từ
  const progress = await LearningProgress.findOne({ userId: userObjectId, wordId: wordObjectId });
  const previousStatus = progress?.status ?? "new";

  const sm2Input = {
    easeFactor: progress?.easeFactor ?? 2.5,
    interval: progress?.interval ?? 0,
    repetitions: progress?.repetitions ?? 0
  };

  // 4. Áp dụng thuật toán SM-2 tính khoảng cách ôn tiếp theo
  const sm2Result = applyReview(sm2Input, data.rating);
  const isCorrect = ["good", "easy"].includes(data.rating);

  // 5. Cập nhật cơ sở dữ liệu tiến trình học
  const updatedProgress = await LearningProgress.findOneAndUpdate(
    { userId: userObjectId, wordId: wordObjectId },
    {
      $set: {
        setId: setObjectId,
        easeFactor: sm2Result.easeFactor,
        interval: sm2Result.interval,
        repetitions: sm2Result.repetitions,
        status: sm2Result.status,
        nextReviewDate: sm2Result.nextReviewDate,
        lastReviewDate: data.reviewedAt ? new Date(data.reviewedAt) : new Date(),
        lastRating: data.rating
      },
      $inc: {
        totalReviews: 1,
        correctReviews: isCorrect ? 1 : 0
      }
    },
    { new: true, upsert: true }
  );

  // 6. Ghi nhận số liệu vào DailyStats phục vụ Person B tính Streak
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  await DailyStats.findOneAndUpdate(
    { userId: userObjectId, date: todayMidnight },
    {
      $inc: {
        wordsReviewed: 1,
        correctAnswers: isCorrect ? 1 : 0,
        totalAnswers: 1,
        timeSpent: data.timeSpent ?? 0,
        newWordsLearned: previousStatus === "new" ? 1 : 0
      }
    },
    { upsert: true }
  );

  try {
    const streak = await calculateCurrentStreak(userId);
    if ([7, 14, 30, 60, 100].includes(streak)) {
      await dispatch(
          userId,
          'streak_milestone',
          `🔥 ${streak} ngày học liên tiếp!`,
          `Tuyệt vời! Bạn đã duy trì streak ${streak} ngày. Tiếp tục phát huy nhé!`,
          { data: { screen: 'analytics', streak: streak.toString() } }
          );
      }
    } catch (e) {
      console.error('[Hook] Streak milestone check failed:', e);
    }

  return {
    wordId: updatedProgress.wordId.toString(),
    previousStatus,
    newStatus: updatedProgress.status,
    easeFactor: updatedProgress.easeFactor,
    interval: updatedProgress.interval,
    repetitions: updatedProgress.repetitions,
    nextReviewDate: updatedProgress.nextReviewDate.toISOString(),
    totalReviews: updatedProgress.totalReviews,
    correctReviews: updatedProgress.correctReviews
  };
}

/**
 * 4. Lấy hàng đợi ôn tập theo từng bộ từ vựng cụ thể
 */
export async function getSetLearningQueue(
  setId: string,
  userId: string
): Promise<LearningQueueResponse> {
  const userObjectId = new Types.ObjectId(userId);
  const setObjectId = new Types.ObjectId(setId);
  const now = new Date();

  // Xác thực quyền sở hữu bộ từ
  await VocabularySet.findOne({
    _id: setObjectId,
    userId: userObjectId,
    isDeleted: { $ne: true }
  }).lean();

  // Đọc chỉ tiêu
  const profile = await UserProfile.findOne({ userId: userObjectId }).lean();
  const dailyGoal = profile?.dailyGoal ?? 10;
  const reviewPerDay = (profile as any)?.reviewPerDay ?? 20;

  // ─── REVIEW CARDS TRONG SET ───
  const reviewProgress = await LearningProgress.find({
    userId: userObjectId,
    setId: setObjectId,
    status: { $ne: "new" },
    nextReviewDate: { $lte: now }
  })
    .sort({ nextReviewDate: 1 })
    .limit(reviewPerDay)
    .populate("wordId")
    .lean();

  // ─── NEW CARDS TRONG SET ───
  const newWords = await Word.aggregate([
    { $match: { setId: setObjectId, isDeleted: { $ne: true } } },
    {
      $lookup: {
        from: "learningprogresses",
        let: { wordId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$wordId", "$$wordId"] },
                  { $eq: ["$userId", userObjectId] }
                ]
              }
            }
          }
        ],
        as: "progress"
      }
    },
    { $match: { "progress.0": { $exists: false } } },
    { $limit: dailyGoal }
  ]);

  const summary: QueueSummary = {
    newCount: newWords.length,
    reviewCount: reviewProgress.length,
    totalToday: newWords.length + reviewProgress.length,
    estimatedMinutes: Math.ceil(newWords.length * 2 + reviewProgress.length * 1.2)
  };

  const setContextSet = await VocabularySet.findById(setId).select("name colorTheme").lean();

  const newCards: LearningCard[] = newWords.map((w) => ({
    id: w._id.toString(),
    word: w.word,
    pronunciation: w.pronunciation,
    partOfSpeech: w.partOfSpeech,
    meaning: w.meaning,
    examples: w.examples ?? [],
    audioUrl: w.audioUrl,
    status: "new",
    setContext: {
      setId,
      setName: setContextSet?.name,
      colorTheme: setContextSet?.colorTheme
    }
  }));

  const reviewCards: LearningCard[] = reviewProgress.map((p: any) => {
    const word = p.wordId;
    return {
      id: word._id.toString(),
      word: word.word,
      pronunciation: word.pronunciation,
      partOfSpeech: word.partOfSpeech,
      meaning: word.meaning,
      examples: word.examples ?? [],
      audioUrl: word.audioUrl,
      status: p.status,
      easeFactor: p.easeFactor,
      interval: p.interval,
      nextReviewDate: p.nextReviewDate.toISOString(),
      setContext: {
        setId,
        setName: setContextSet?.name,
        colorTheme: setContextSet?.colorTheme
      }
    };
  });

  return { newCards, reviewCards, summary };
}

/**
 * 5. Lấy tóm tắt tiến trình học của 1 bộ từ vựng
 */
export async function getSetProgressSummary(
  setId: string,
  userId: string
): Promise<SetProgressSummary> {
  const userObjectId = new Types.ObjectId(userId);
  const setObjectId = new Types.ObjectId(setId);
  const now = new Date();

  // Đọc set gốc
  const set = await VocabularySet.findOne({
    _id: setObjectId,
    userId: userObjectId,
    isDeleted: { $ne: true }
  }).lean();

  if (!set) {
    throw new AppError("Vocabulary set not found", HttpStatus.NOT_FOUND, ErrorCodes.VALIDATION_FAILED);
  }

  // Đếm tiến độ thực tế
  const progressList = await LearningProgress.find({
    userId: userObjectId,
    setId: setObjectId
  }).lean();

  const progressMap = new Map(progressList.map((p) => [p.status, p]));
  const countByStatus = (status: string) => progressList.filter((p) => p.status === status).length;

  const masteredCount = countByStatus("mastered");
  const learningCount = countByStatus("learning");
  const reviewCount = countByStatus("review");

  // Đếm số từ đến hạn ôn tập
  const dueCount = progressList.filter(
    (p) => p.status !== "new" && p.nextReviewDate.getTime() <= now.getTime()
  ).length;

  const totalWords = set.totalWords ?? 0;
  const newCount = Math.max(0, totalWords - masteredCount - learningCount - reviewCount);

  return {
    setId,
    totalWords,
    masteredCount,
    masteredPct: totalWords > 0 ? Math.round((masteredCount / totalWords) * 100) : 0,
    learningCount,
    reviewCount,
    newCount,
    dueCount
  };
}

/**
 * 6. Lấy chi tiết SRS tiến độ học của một từ vựng cụ thể
 */
export async function getWordSRSProgress(
  wordId: string,
  userId: string
): Promise<WordSRSProgress> {
  const wordObjectId = new Types.ObjectId(wordId);
  const userObjectId = new Types.ObjectId(userId);

  // Tìm từ
  const word = await Word.findOne({ _id: wordObjectId, isDeleted: { $ne: true } }).lean();
  if (!word) {
    throw new AppError("Word not found", HttpStatus.NOT_FOUND, ErrorCodes.VALIDATION_FAILED);
  }

  // Lấy tiến độ SRS
  const progress = await LearningProgress.findOne({ userId: userObjectId, wordId: wordObjectId }).lean();

  return {
    wordId,
    word: word.word,
    status: progress?.status ?? "new",
    easeFactor: progress?.easeFactor ?? 2.5,
    interval: progress?.interval ?? 0,
    repetitions: progress?.repetitions ?? 0,
    totalReviews: progress?.totalReviews ?? 0,
    correctReviews: progress?.correctReviews ?? 0,
    nextReviewDate: progress?.nextReviewDate?.toISOString(),
    lastReviewDate: progress?.lastReviewDate?.toISOString(),
    lastRating: progress?.lastRating
  };
}

export async function getHomeDashboard(userId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Aggregate tính newWords & reviewsDue
  const summary = await LearningProgress.aggregate([
    { $match: { userId: new Types.ObjectId(userId) } },
    { $facet: {
        newWords: [{ $match: { status: "new" } }, { $count: "count" }],
        reviewsDue: [{
          $match: { status: "review", nextReviewDate: { $lt: tomorrow } }
        }, { $count: "count" }]
      }
    }
  ]);

  const newWords = summary[0].newWords[0]?.count || 0;
  const reviewsDue = summary[0].reviewsDue[0]?.count || 0;

  // Lấy danh sách sets của user
  const sets = await VocabularySet.find({
    userId: new Types.ObjectId(userId),
    isDeleted: { $ne: true }
  }).select("_id name colorTheme totalWords").lean();  // ← Chọn đúng field

  // Check set nào có từ cần ôn hôm nay
  const setIds = sets.map(s => s._id.toString());
  const dueSetIds = await LearningProgress.distinct("setId", {
    userId: new Types.ObjectId(userId),
    setId: { $in: setIds },
    nextReviewDate: { $lt: tomorrow },
    status: { $in: ["learning", "review"] }
  });
  const dueSetIdStrings = dueSetIds.map(id => id.toString());
  // Map sang LearningDto - khớp 100%
  const vocabSets = sets.map(s => ({
    id: s._id.toString(),
    title: s.name,
    wordCount: s.totalWords ?? 0,    // ← totalWords từ model
    icon: null,                      // ← FE tự handle default icon
    isDueToday: dueSetIdStrings.includes(s._id.toString())
  }));

  return {
    userId,
    newWords,
    reviewsDue,
    vocabSets
  };
}


/**
 * Lấy danh sách flashcard để làm bài test/luyện tập
 * Map từ Word + LearningProgress + VocabularySet → FlashcardContentDto
 */
export async function getFlashcardTest(
    userId: string,
    query: FlashcardQuery
): Promise<any> {
  const userObjectId = new Types.ObjectId(userId);
  const limit = Math.min(query.limit ?? 20, 100);

  // ✅ FILTER MỚI: Lấy cả từ mới VÀ từ đã học
  const progressFilter: any = {
    userId: userObjectId,
    // ❌ BỎ: status: { $ne: "new" }
    // ✅ THÊM: Lấy tất cả status (bao gồm "new")
  };

  if (query.setId) progressFilter.setId = new Types.ObjectId(query.setId);

  // Lấy các từ đã có LearningProgress
  const progresses = await LearningProgress.find(progressFilter)
      .sort({
        nextReviewDate: 1,  // Ưu tiên từ đến hạn sớm
        easeFactor: 1       // Ưu tiên từ khó
      })
      .limit(limit)
      .populate("wordId")
      .populate("setId", "category")
      .lean();

  // ✅ THÊM: Lấy từ mới chưa có LearningProgress (nếu chưa đủ limit)
  const existingWordIds = progresses.map((p: any) => p.wordId._id.toString());
  const setObjectId = query.setId ? new Types.ObjectId(query.setId) : null;

  const wordFilter: any = {
    _id: { $nin: existingWordIds.map(id => new Types.ObjectId(id)) },
    isDeleted: { $ne: true }
  };

  if (setObjectId) {
    wordFilter.setId = setObjectId;
  } else {
    // Nếu không filter theo setId, lấy từ tất cả sets của user
    const userSetIds = await VocabularySet.find({
      userId: userObjectId,
      isDeleted: { $ne: true }
    }).distinct("_id");
    wordFilter.setId = { $in: userSetIds };
  }

  const remainingLimit = limit - progresses.length;
  const newWords = remainingLimit > 0
      ? await Word.find(wordFilter)
          .limit(remainingLimit)
          .populate("setId", "category")
          .lean()
      : [];

  // ✅ MAP: Kết hợp từ đã học và từ mới
  const learnedCards = progresses
      .filter((p: any) => p.wordId)
      .map((p: any) => ({
        id: p.wordId._id.toString(),
        setId: p.setId?._id.toString() ?? "",
        category: p.setId?.category ?? "general",
        word: p.wordId.word ?? "",
        phonetic: p.wordId.pronunciation ?? "",
        partOfSpeech: p.wordId.partOfSpeech ?? "",
        definition: p.wordId.meaning ?? "",
        example: Array.isArray(p.wordId.examples) && p.wordId.examples.length > 0
            ? p.wordId.examples[0]
            : "",
        audioUrl: p.wordId.audioUrl ?? "",
        status: p.status  // ✅ Thêm field status
      }));

  const newCards = newWords.map((w: any) => ({
    id: w._id.toString(),
    setId: w.setId?.toString() ?? "",
    category: (w.setId as any)?.category ?? "general",
    word: w.word ?? "",
    phonetic: w.pronunciation ?? "",
    partOfSpeech: w.partOfSpeech ?? "",
    definition: w.meaning ?? "",
    example: Array.isArray(w.examples) && w.examples.length > 0
        ? w.examples[0]
        : "",
    audioUrl: w.audioUrl ?? "",
    status: "new"  // ✅ Mark là từ mới
  }));

  const flashCardSets = [...learnedCards, ...newCards];

  // ✅ Tính remainingCount chính xác hơn
  const totalLearned = await LearningProgress.countDocuments({
    userId: userObjectId,
    ...(query.setId ? { setId: new Types.ObjectId(query.setId) } : {}),
    _id: { $nin: progresses.map(p => p._id) }
  });

  const totalNew = await Word.countDocuments({
    ...wordFilter,
    _id: { $nin: newWords.map(w => w._id) }
  });

  return {
    userId: userId,
    flashCardSets: flashCardSets,
    remainingCount: totalLearned + totalNew
  };
}
async function calculateCurrentStreak(userId: string): Promise<number> {
  const stats = await DailyStats.find({ userId: new Types.ObjectId(userId) })
      .sort({ date: -1 })
      .select('date')
      .lean();
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < stats.length; i++) {
    const expected = new Date(today);
    expected.setDate(today.getDate() - i);
    const actual = new Date(stats[i].date);
    actual.setHours(0, 0, 0, 0);
    if (actual.getTime() === expected.getTime()) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

// services/learning.service.ts
export async function submitBatchReview(
    userId: string,
    data: BatchSubmitReviewDTO
): Promise<BatchSubmitReviewResponse> {
  const userObjectId = new Types.ObjectId(userId);
  const results: SubmitReviewResponse[] = [];
  const errors: Array<{ wordId: string; error: string }> = [];

  // 🔥 Dùng session transaction để đảm bảo atomic
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    for (const review of data.reviews) {
      try {
        const result = await submitReviewSingle(
            review.wordId,
            userId,
            {
              setId: review.setId,
              rating: review.rating,
              reviewedAt: review.reviewedAt,
              timeSpent: review.timeSpent
            },
            session
        );
        results.push(result);
      } catch (err: any) {
        errors.push({
          wordId: review.wordId,
          error: err.message || "Unknown error"
        });
      }
    }

    await session.commitTransaction();

    return {
      results,
      successCount: results.length,
      failedCount: errors.length,
      errors: errors.length > 0 ? errors : undefined
    };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

// 🔥 Tách hàm submitReviewSingle để tái sử dụng
async function submitReviewSingle(
    wordId: string,
    userId: string,
    data: SubmitReviewDTO,
    session?: mongoose.ClientSession
): Promise<SubmitReviewResponse> {
  const wordObjectId = new Types.ObjectId(wordId);
  const userObjectId = new Types.ObjectId(userId);
  const setObjectId = new Types.ObjectId(data.setId);

  // Clock skew check
  if (data.reviewedAt) {
    const timeDiff = Math.abs(Date.now() - new Date(data.reviewedAt).getTime());
    if (timeDiff > 30 * 60 * 1000) {
      throw new AppError("Clock skew detected (> 30 min)", HttpStatus.BAD_REQUEST, "ERR_CLOCK_SKEW");
    }
  }

  // Tìm progress cũ
  const progress = await LearningProgress.findOne(
      { userId: userObjectId, wordId: wordObjectId },
      {},
      { session }
  );
  const previousStatus = progress?.status ?? "new";

  const sm2Input = {
    easeFactor: progress?.easeFactor ?? 2.5,
    interval: progress?.interval ?? 0,
    repetitions: progress?.repetitions ?? 0
  };

  const sm2Result = applyReview(sm2Input, data.rating);
  const isCorrect = ["good", "easy"].includes(data.rating);

  const updatedProgress = await LearningProgress.findOneAndUpdate(
      { userId: userObjectId, wordId: wordObjectId },
      {
        $set: {
          setId: setObjectId,
          easeFactor: sm2Result.easeFactor,
          interval: sm2Result.interval,
          repetitions: sm2Result.repetitions,
          status: sm2Result.status,
          nextReviewDate: sm2Result.nextReviewDate,
          lastReviewDate: data.reviewedAt ? new Date(data.reviewedAt) : new Date(),
          lastRating: data.rating
        },
        $inc: {
          totalReviews: 1,
          correctReviews: isCorrect ? 1 : 0
        }
      },
      { new: true, upsert: true, session }
  );

  // DailyStats
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  await DailyStats.findOneAndUpdate(
      { userId: userObjectId, date: todayMidnight },
      {
        $inc: {
          wordsReviewed: 1,
          correctAnswers: isCorrect ? 1 : 0,
          totalAnswers: 1,
          timeSpent: data.timeSpent ?? 0,
          newWordsLearned: previousStatus === "new" ? 1 : 0
        }
      },
      { upsert: true, session }
  );

  return {
    wordId: updatedProgress.wordId.toString(),
    previousStatus,
    newStatus: updatedProgress.status,
    easeFactor: updatedProgress.easeFactor,
    interval: updatedProgress.interval,
    repetitions: updatedProgress.repetitions,
    nextReviewDate: updatedProgress.nextReviewDate.toISOString(),
    totalReviews: updatedProgress.totalReviews,
    correctReviews: updatedProgress.correctReviews
  };
}